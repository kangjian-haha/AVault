import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { MovieRecord } from '../shared/contracts'
import { readMovieSidecar, sidecarPath, writeMovieSidecar } from './sidecar'

function movie(path: string): MovieRecord {
  return {
    id: 'movie-1', code: 'ABP-123', normalizedCode: 'ABP-123', title: '可迁移的影片资料', description: '简介', releaseDate: '2025-01-02', durationMinutes: 120,
    director: '导演', studio: '片商', label: null, series: null, coverUrl: null, metadataSource: 'javbus', metadataUpdatedAt: null, sourcePartition: 'leaked', sourcePartitionSource: 'manual',
    actors: ['演员 A'], tags: ['标签 A'], manualFields: ['title'], watchStatus: 'unwatched', progressSeconds: 0, durationSeconds: 0, createdAt: '', updatedAt: '',
    files: [{ id: 'file-1', movieId: 'movie-1', libraryId: 'library-1', path, name: 'ABP-123.mp4', relativeDir: '', extension: 'mp4', size: 1, mtimeMs: 0, available: true, codeRecognized: true, partLabel: null, versionLabel: null, mediaInfo: null }]
  }
}

describe('movie sidecar', () => {
  it('writes portable metadata beside the movie and restores its cover reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-sidecar-'))
    try {
      const video = join(root, 'ABP-123.mp4')
      const cover = join(root, 'ABP-123.avault-cover.jpg')
      await Promise.all([writeFile(video, ''), writeFile(cover, 'image')])
      const source = movie(video)
      await writeMovieSidecar(source, cover)
      expect(sidecarPath(source)).toBe(join(root, 'ABP-123.avault.json'))
      expect(JSON.parse(await readFile(join(root, 'ABP-123.avault.json'), 'utf8'))).toMatchObject({ schemaVersion: 2, sourcePartition: { value: 'leaked', determinedBy: 'manual' } })
      const restored = await readMovieSidecar(video, 'ABP-123')
      expect(restored).toMatchObject({ coverPath: cover, metadataSource: 'javbus', sourcePartition: 'leaked', details: { title: '可迁移的影片资料', actors: ['演员 A'], tags: ['标签 A'] } })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('continues to read schema v1 files without a partition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-sidecar-v1-'))
    try {
      const video = join(root, 'ABP-123.mp4')
      await writeFile(video, '')
      await writeFile(join(root, 'ABP-123.avault.json'), JSON.stringify({ schemaVersion: 1, kind: 'avault-movie', title: '旧版资料', code: 'ABP-123', actors: [], tags: [], manualFields: [], metadataSource: 'local-json' }))
      const restored = await readMovieSidecar(video, 'ABP-123')
      expect(restored).toMatchObject({ sourcePartition: null, details: { code: 'ABP-123', title: '旧版资料' } })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
