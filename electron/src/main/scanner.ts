import { readdir, stat } from 'node:fs/promises'
import { extname, join, relative, dirname, basename } from 'node:path'
import type { MediaInfo, ScanProgress, SourcePartition } from '../shared/contracts'
import type { AppDatabase } from './database'
import { readMovieSidecar } from './sidecar'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.ts'])
// FFprobe mostly waits on disk and process startup. A small worker pool makes
// rescans much faster without overwhelming a mechanical drive or network share.
const ANALYSIS_CONCURRENCY = 6

export interface ParsedFilename {
  normalizedCode: string | null
  partLabel: string | null
  versionLabel: string | null
}

export function normalizeMovieCode(input: string): string | null {
  // Download-site watermarks are commonly prepended as "site.com@CODE-123".
  // Prefer the portion after the final @ so a domain such as hhd800.com is not
  // mistaken for the actual movie code.
  const meaningfulInput = input.includes('@') ? input.slice(input.lastIndexOf('@') + 1) : input
  const upper = meaningfulInput.toUpperCase()
  const fc2 = upper.match(/FC2[-_.\s]?(?:PPV[-_.\s]?)?(\d{5,8})/)
  if (fc2) return `FC2-PPV-${fc2[1]}`
  const heyzo = upper.match(/HEYZO[-_.\s]?(\d{3,5})/)
  if (heyzo) return `HEYZO-${heyzo[1]}`
  const uncensoredDate = upper.match(/(?:^|[^0-9])(\d{6})([-_])(\d{3,4})(?:-C)?(?=$|[^A-Z0-9])/)
  if (uncensoredDate) return `${uncensoredDate[1]}${uncensoredDate[2]}${uncensoredDate[3]}`
  // Uncensored catalogues also use one-letter serials (N0659), mixed serials
  // (MKBD-S03), and date-first IDs such as 150123-YUME.
  const uncensoredN = upper.match(/(?:^|[^A-Z0-9])(N\d{3,5})(?=$|[^A-Z0-9])/)
  if (uncensoredN) return uncensoredN[1]
  const uncensoredMixed = upper.match(/(?:^|[^A-Z0-9])(MKBD[-_]S\d{2,6})(?=$|[^A-Z0-9])/)
  if (uncensoredMixed) return uncensoredMixed[1]
  const uncensoredDateSeries = upper.match(/(?:^|[^0-9])(\d{6}[-_](?:YUME))(?=$|[^A-Z0-9])/)
  if (uncensoredDateSeries) return uncensoredDateSeries[1]
  const standard = upper.match(/(?:^|[^A-Z0-9])([A-Z]{2,12})[-_.\s]?(\d{2,6})(?=$|[^A-Z0-9])/)
  if (!standard) return null
  const [, prefix, digits] = standard
  const noise = new Set(['H264', 'H265', 'HEVC', 'X264', 'X265', 'AAC', 'AVC'])
  if (noise.has(`${prefix}${digits}`) || ['CD', 'PART', 'PT'].includes(prefix)) return null
  return `${prefix}-${digits}`
}

export function inferSourcePartition(code: string | null, fileName = ''): SourcePartition {
  if (/(?:^|[-_.\s])(LEAK|UNCENSORED[-_.\s]?LEAK|流出)(?:$|[-_.\s])/i.test(fileName)) return 'leaked'
  const value = code?.toUpperCase() ?? ''
  if (value.startsWith('FC2-PPV-')) return 'fc2'
  if (/^(?:HEYZO-\d+|\d{6}[-_](?:\d{3,4}|YUME)|N\d{3,5}|TH\d+(?:-\d+){2,}|GACHI-\d+|(?:MKBD|SKY|CWP|LAFBD)-[A-Z0-9]+)/.test(value)) return 'uncensored'
  if (/^[A-Z]{2,12}-\d{2,6}$/.test(value)) return 'censored'
  return 'unknown'
}

export function parseVideoFilename(fileName: string, parentName = ''): ParsedFilename {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const normalizedCode = normalizeMovieCode(withoutExtension) ?? normalizeMovieCode(parentName)
  const partMatch = withoutExtension.match(/(?:^|[-_.\s])(?:CD|PART|PT)[-_.\s]?(\d{1,2})(?=$|[-_.\s])/i)
  const resolution = withoutExtension.match(/(?:2160P|1080P|720P|4K|UHD)/i)?.[0]?.toUpperCase()
  const hevc = /(?:\[\s*)?(?:HEVC|H\.265|H265|X265)(?:\s*\])?/i.test(withoutExtension)
  const subtitles = /(?:中字|中文字幕|SUB|SUBBED|(?:^|[-_.\s])-?C$)/i.test(withoutExtension) ? '字幕' : null
  return {
    normalizedCode,
    partLabel: partMatch ? `第 ${Number(partMatch[1])} 部分` : null,
    versionLabel: [hevc ? (resolution === '720P' ? '720p HEVC' : 'HEVC 原分辨率') : resolution, subtitles].filter(Boolean).join(' · ') || null
  }
}

async function* walk(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walk(fullPath)
    } else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      yield fullPath
    }
  }
}

export class MediaScanner {
  private running = new Map<string, Promise<ScanProgress>>()

  constructor(
    private readonly database: AppDatabase,
    private readonly notify: (progress: ScanProgress) => void,
    private readonly analyze: (path: string) => Promise<MediaInfo | null>
  ) {}

  scan(libraryId: string): Promise<ScanProgress> {
    const existing = this.running.get(libraryId)
    if (existing) return existing
    const task = this.performScan(libraryId).finally(() => this.running.delete(libraryId))
    this.running.set(libraryId, task)
    return task
  }

  private async performScan(libraryId: string): Promise<ScanProgress> {
    const library = this.database.getLibrary(libraryId)
    if (!library) throw new Error('媒体目录不存在')
    const progress: ScanProgress = {
      libraryId,
      phase: 'starting',
      discovered: 0,
      recognized: 0,
      unrecognized: 0,
      errors: 0
    }
    this.notify({ ...progress })
    this.database.beginScan(libraryId)
    try {
      const existingFiles = this.database.getLibraryFileIndex(libraryId)
      const filePaths: string[] = []
      for await (const filePath of walk(library.path)) filePaths.push(filePath)
      progress.discovered = filePaths.length
      progress.phase = 'scanning'
      this.notify({ ...progress })

      let nextIndex = 0
      let completed = 0
      const scanOne = async (filePath: string): Promise<void> => {
        progress.phase = 'scanning'
        progress.currentPath = filePath
        try {
          const info = await stat(filePath)
          const parsed = parseVideoFilename(basename(filePath), basename(dirname(filePath)))
          const previous = existingFiles.get(filePath)
          // A file may have been manually identified or restored from a sidecar
          // even when its original filename itself contains no parseable code.
          // Keep that curated identity recognised on later rescans.
          const previousCode = previous ? this.database.getMovie(previous.movieId)?.normalizedCode : null
          const codeRecognized = Boolean(parsed.normalizedCode || previousCode)
          const partition = library.sourcePartition ?? inferSourcePartition(parsed.normalizedCode ?? previousCode ?? null, basename(filePath, extname(filePath)))
          const partitionSource = library.sourcePartition ? 'folder' : 'filename'
          // Reuse persisted probe data when the exact file has not changed.
          // A regular rescan then only does cheap directory/stat/database work.
          const unchanged = previous?.size === info.size && previous.mtimeMs === info.mtimeMs && previous.mediaInfo != null
          const mediaInfo = unchanged ? previous.mediaInfo : await this.analyze(filePath)
          if (codeRecognized) progress.recognized += 1
          else progress.unrecognized += 1
          const movieId = this.database.upsertScannedFile({
            libraryId,
            path: filePath,
            name: basename(filePath),
            relativeDir: relative(library.path, dirname(filePath)),
            extension: extname(filePath).slice(1).toLowerCase(),
            size: info.size,
            mtimeMs: info.mtimeMs,
            mediaInfo,
            codeRecognized,
            sourcePartition: partition,
            sourcePartitionSource: partitionSource,
            ...parsed
          })
          // A local sidecar makes a movie portable: a newly created database can
          // restore the curated data without requiring another web crawl.
          let movie = this.database.getMovie(movieId)
          const sidecar = await readMovieSidecar(filePath, parsed.normalizedCode)
          if (movie && sidecar) {
            if (!movie.metadataSource) {
              this.database.applyMetadata(movieId, sidecar.details, sidecar.coverPath, 'preserve', sidecar.metadataSource)
              this.database.restoreManualFields(movieId, sidecar.manualFields)
            }
            movie = this.database.getMovie(movieId)
            if (sidecar.sourcePartition && movie?.sourcePartitionSource !== 'manual') this.database.setMovieSourcePartition(movieId, sidecar.sourcePartition, 'local-json')
          }
        } catch {
          progress.errors += 1
        }
        completed += 1
        if (completed % 10 === 0 || completed === filePaths.length) this.notify({ ...progress })
      }
      const worker = async (): Promise<void> => {
        while (true) {
          const index = nextIndex++
          if (index >= filePaths.length) return
          await scanOne(filePaths[index])
        }
      }
      await Promise.all(Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, filePaths.length) }, () => worker()))
      this.database.finishScan(libraryId)
      progress.phase = 'complete'
      delete progress.currentPath
      this.notify({ ...progress })
      return progress
    } catch (error) {
      progress.phase = 'error'
      progress.message = error instanceof Error ? error.message : '扫描失败'
      this.notify({ ...progress })
      throw error
    }
  }
}
