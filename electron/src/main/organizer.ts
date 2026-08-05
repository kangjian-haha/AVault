import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, join } from 'node:path'
import type { LibraryRecord, MovieRecord } from '../shared/contracts'

export interface OrganizeItem { fileId: string; movieId: string; sourcePath: string; targetPath: string | null; sourceRelativePath: string; targetRelativePath: string | null; action: 'move' | 'skip'; reason?: string }
export interface OrganizePreview { libraryId: string; rootPath: string; directories: string[]; cleanupDirectories: string[]; items: OrganizeItem[]; movable: number; skipped: number; unrecognized: number }

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.ts'])

function safeSegment(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) || /[. ]$/.test(trimmed) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(trimmed)) return null
  return trimmed
}

export function createOrganizePreview(library: LibraryRecord, movies: MovieRecord[]): OrganizePreview {
  const root = resolve(library.path)
  const items: OrganizeItem[] = []
  const directories = new Set<string>()
  let unrecognized = 0
  for (const movie of movies) for (const file of movie.files.filter((candidate) => candidate.libraryId === library.id && candidate.available)) {
    const source = resolve(file.path)
    const sourceRelative = relative(root, source)
    if (sourceRelative.startsWith('..') || sourceRelative === '') { items.push({ fileId: file.id, movieId: movie.id, sourcePath: source, targetPath: null, sourceRelativePath: file.path, targetRelativePath: null, action: 'skip', reason: '文件不属于当前媒体目录' }); continue }
    const actor = safeSegment(movie.actors[0] ?? '未知演员')
    const code = safeSegment(movie.normalizedCode ?? movie.code ?? '未识别番号')
    if (!movie.normalizedCode && !movie.code) unrecognized += 1
    if (!actor || !code) { items.push({ fileId: file.id, movieId: movie.id, sourcePath: source, targetPath: null, sourceRelativePath: sourceRelative, targetRelativePath: null, action: 'skip', reason: '演员或番号包含 Windows 非法目录字符' }); continue }
    const targetDirectory = join(root, actor, code)
    const target = join(targetDirectory, basename(source))
    const targetRelative = relative(root, target)
    if (source.toLowerCase() === target.toLowerCase()) { items.push({ fileId: file.id, movieId: movie.id, sourcePath: source, targetPath: target, sourceRelativePath: sourceRelative, targetRelativePath: targetRelative, action: 'skip', reason: '已位于目标目录' }); continue }
    if (existsSync(target)) { items.push({ fileId: file.id, movieId: movie.id, sourcePath: source, targetPath: target, sourceRelativePath: sourceRelative, targetRelativePath: targetRelative, action: 'skip', reason: '目标目录已有同名文件' }); continue }
    directories.add(targetDirectory)
    items.push({ fileId: file.id, movieId: movie.id, sourcePath: source, targetPath: target, sourceRelativePath: sourceRelative, targetRelativePath: targetRelative, action: 'move' })
  }
  // These are the source directories eligible for removal after every video in
  // them has moved. A skipped video blocks cleanup for that directory.
  const cleanupDirectories = [...new Set(items.filter((item) => item.action === 'move').map((item) => dirname(item.sourcePath)))].filter((directory) =>
    resolve(directory).toLowerCase() !== root.toLowerCase() && !items.some((item) => item.action === 'skip' && isInside(directory, item.sourcePath))
  ).map((directory) => relative(root, directory)).sort((left, right) => left.localeCompare(right))
  return { libraryId: library.id, rootPath: root, directories: [...directories], cleanupDirectories, items, movable: items.filter((item) => item.action === 'move').length, skipped: items.filter((item) => item.action === 'skip').length, unrecognized }
}

async function removeEmptySourceDirectories(sourcePath: string, rootPath: string): Promise<void> {
  const root = resolve(rootPath)
  let current = resolve(dirname(sourcePath))
  while (current.toLowerCase() !== root.toLowerCase()) {
    const currentRelative = relative(root, current)
    if (!currentRelative || currentRelative.startsWith('..') || isAbsolute(currentRelative)) return
    try { await rmdir(current) } catch { return }
    current = dirname(current)
  }
}

function isInside(directory: string, path: string): boolean {
  const value = relative(resolve(directory), resolve(path))
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

async function containsVideoFile(directory: string): Promise<boolean> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return true }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) return true
    if (entry.isDirectory() && await containsVideoFile(path)) return true
  }
  return false
}

async function removeRelocatedSourceDirectory(directory: string, preview: OrganizePreview): Promise<void> {
  const root = resolve(preview.rootPath)
  const source = resolve(directory)
  if (source.toLowerCase() === root.toLowerCase() || !isInside(root, source)) return
  // Never delete a source folder which still contains a video AVault did not move
  // (for example a conflict, a skipped file, or an unrecognized video).
  const hasSkippedFile = preview.items.some((item) => item.action === 'skip' && isInside(source, item.sourcePath))
  if (hasSkippedFile || await containsVideoFile(source)) return
  await rm(source, { recursive: true, force: true })
  await removeEmptySourceDirectories(source, root)
}

export class MediaOrganizer {
  private cancelled = false
  cancel(): void { this.cancelled = true }
  async execute(preview: OrganizePreview, onProgress: (value: { total: number; completed: number; moved: number; skipped: number; currentPath?: string; phase: 'moving' | 'complete' | 'cancelled' }) => void, onMoved?: (item: OrganizeItem) => void | Promise<void>): Promise<void> {
    this.cancelled = false
    let completed = 0; let moved = 0; let skipped = preview.skipped
    const relocatedSourceDirectories = new Set<string>()
    for (const item of preview.items.filter((candidate) => candidate.action === 'move')) {
      if (this.cancelled) { onProgress({ total: preview.movable, completed, moved, skipped, phase: 'cancelled' }); return }
      onProgress({ total: preview.movable, completed, moved, skipped, currentPath: item.sourceRelativePath, phase: 'moving' })
      try {
        if (!item.targetPath || existsSync(item.targetPath)) { skipped += 1 } else {
          await mkdir(dirname(item.targetPath), { recursive: true })
          await rename(item.sourcePath, item.targetPath)
          await onMoved?.(item)
          relocatedSourceDirectories.add(dirname(item.sourcePath))
          moved += 1
        }
      } catch { skipped += 1 }
      completed += 1
      onProgress({ total: preview.movable, completed, moved, skipped, currentPath: item.sourceRelativePath, phase: 'moving' })
    }
    for (const sourceDirectory of [...relocatedSourceDirectories].sort((left, right) => right.length - left.length)) {
      try { await removeRelocatedSourceDirectory(sourceDirectory, preview) } catch { /* Leave the old directory if Windows refuses removal. */ }
    }
    onProgress({ total: preview.movable, completed, moved, skipped, phase: 'complete' })
  }
}
