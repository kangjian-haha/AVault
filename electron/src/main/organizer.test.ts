import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { LibraryRecord, MovieRecord } from '../shared/contracts'
import { createOrganizePreview, MediaOrganizer } from './organizer'

function library(path: string): LibraryRecord {
  return { id: 'library-1', name: '媒体库', path, lastScannedAt: null, movieCount: 0, availableFileCount: 0, sourcePartition: null }
}

function movie(path: string, options: { actors?: string[]; code?: string | null; normalizedCode?: string | null; id?: string } = {}): MovieRecord {
  const id = options.id ?? 'movie-1'
  return {
    id, code: options.code === undefined ? 'ABP-123' : options.code, normalizedCode: options.normalizedCode === undefined ? 'ABP-123' : options.normalizedCode, title: '测试影片', description: '', releaseDate: null, durationMinutes: null, director: null, studio: null, label: null, series: null, coverUrl: null, metadataSource: null, metadataUpdatedAt: null, sourcePartition: 'censored', sourcePartitionSource: 'filename',
    actors: options.actors ?? ['演员 A'], tags: [], manualFields: [], watchStatus: 'unwatched', progressSeconds: 0, durationSeconds: 0, createdAt: '', updatedAt: '',
    files: [{ id: `${id}-file`, movieId: id, libraryId: 'library-1', path, name: path.split(/[\\/]/).pop()!, relativeDir: '', extension: '.mp4', size: 1, mtimeMs: 0, available: true, codeRecognized: true, partLabel: null, versionLabel: null, mediaInfo: null }]
  }
}

describe('media organizer', () => {
  it('uses the first actor and puts generated variants in the same code directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      const first = movie(join(root, 'ABP-123.mp4'), { actors: ['第一演员', '第二演员'] })
      const variant = movie(join(root, 'ABP-123 [HEVC].mp4'), { actors: ['第一演员', '第二演员'], id: 'movie-2' })
      const preview = createOrganizePreview(library(root), [first, variant])
      expect(preview.movable).toBe(2)
      expect(preview.items.map((item) => item.targetRelativePath)).toEqual(['第一演员\\ABP-123\\ABP-123.mp4', '第一演员\\ABP-123\\ABP-123 [HEVC].mp4'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('uses unknown folders for missing actor or code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      const preview = createOrganizePreview(library(root), [movie(join(root, 'video.mp4'), { actors: [], code: null, normalizedCode: null })])
      expect(preview.unrecognized).toBe(1)
      expect(preview.items[0].targetRelativePath).toBe('未知演员\\未识别番号\\video.mp4')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('skips conflicts and files already in their target directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      await mkdir(join(root, '演员 A', 'ABP-123'), { recursive: true })
      await writeFile(join(root, '演员 A', 'ABP-123', 'conflict.mp4'), '')
      const conflict = movie(join(root, 'conflict.mp4'))
      const alreadyThere = movie(join(root, '演员 A', 'ABP-123', 'done.mp4'), { id: 'movie-2' })
      const preview = createOrganizePreview(library(root), [conflict, alreadyThere])
      expect(preview.items.map((item) => item.reason)).toEqual(['目标目录已有同名文件', '已位于目标目录'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects unsafe Windows directory names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      const preview = createOrganizePreview(library(root), [movie(join(root, 'ABP-123.mp4'), { actors: ['演员/别名'] })])
      expect(preview.movable).toBe(0)
      expect(preview.items[0]).toMatchObject({ action: 'skip', targetPath: null, reason: '演员或番号包含 Windows 非法目录字符' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('moves only after execute is called', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      const source = join(root, 'ABP-123.mp4')
      await writeFile(source, 'video')
      const preview = createOrganizePreview(library(root), [movie(source)])
      expect(existsSync(source)).toBe(true)
      const organizer = new MediaOrganizer()
      await organizer.execute(preview, () => undefined)
      expect(existsSync(source)).toBe(false)
      expect(existsSync(join(root, '演员 A', 'ABP-123', 'ABP-123.mp4'))).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('removes relocated source folders including sidecar files and keeps the media root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      const sourceDirectory = join(root, '待整理', '第一批')
      const source = join(sourceDirectory, 'ABP-123.mp4')
      await mkdir(sourceDirectory, { recursive: true })
      await writeFile(source, 'video')
      await writeFile(join(sourceDirectory, 'ABP-123.nfo'), '<movie />')
      await writeFile(join(sourceDirectory, 'thumb.jpg'), 'cover')
      const preview = createOrganizePreview(library(root), [movie(source)])
      await new MediaOrganizer().execute(preview, () => undefined)
      expect(existsSync(sourceDirectory)).toBe(false)
      expect(existsSync(join(root, '待整理'))).toBe(false)
      expect(existsSync(root)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('keeps an old source folder if a video inside it was skipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-organizer-'))
    try {
      const sourceDirectory = join(root, '待整理')
      const source = join(sourceDirectory, 'ABP-123.mp4')
      const skipped = join(sourceDirectory, 'conflict.mp4')
      await mkdir(sourceDirectory, { recursive: true })
      await writeFile(source, 'video')
      await writeFile(skipped, 'video')
      await mkdir(join(root, '演员 A', 'ABP-123'), { recursive: true })
      await writeFile(join(root, '演员 A', 'ABP-123', 'conflict.mp4'), 'existing')
      const preview = createOrganizePreview(library(root), [movie(source), movie(skipped, { id: 'movie-2' })])
      await new MediaOrganizer().execute(preview, () => undefined)
      expect(existsSync(sourceDirectory)).toBe(true)
      expect(existsSync(skipped)).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
