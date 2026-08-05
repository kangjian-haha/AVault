import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from './database'
import type { LanServer } from './lan-server'

let directory = ''
let server: LanServer | null = null
let database: AppDatabase | null = null

afterEach(async () => {
  await server?.stop()
  database?.sqlite.close()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''; server = null; database = null
})

describe.runIf(process.versions.modules === '139')('LAN media API', () => {
  it('requires a token and exposes actor/tag filtering without local paths', async () => {
    const { AppDatabase } = await import('./database')
    const { LanServer } = await import('./lan-server')
    directory = await mkdtemp(join(tmpdir(), 'avault-lan-'))
    const videoPath = join(directory, 'ABC-123.mp4')
    await writeFile(videoPath, 'video')
    database = new AppDatabase(join(directory, 'avault.db'))
    const library = database.addLibrary(directory)
    const movieId = database.upsertScannedFile({ libraryId: library.id, path: videoPath, name: 'ABC-123.mp4', relativeDir: '', extension: 'mp4', size: 5, mtimeMs: 1, codeRecognized: true, sourcePartition: 'censored', sourcePartitionSource: 'filename', normalizedCode: 'ABC-123', partLabel: null, versionLabel: '原画', mediaInfo: { container: 'mp4', videoCodec: 'h264', videoProfile: null, videoEncoder: null, width: 1920, height: 1080, frameRate: 30, videoBitrate: null, pixelFormat: null, hdr: false, audioCodec: 'aac', audioBitrate: null, audioChannels: 2, durationSeconds: 60 } })
    database.updateMovie(movieId, { title: '测试影片', actors: ['测试演员'], tags: ['测试标签'], releaseDate: '2026-01-01' })
    database.saveDevice('Android', 'test-token')
    server = new LanServer(database, () => undefined)
    await server.start()
    const port = server.getStatus().port!
    const base = `http://127.0.0.1:${port}`
    expect((await fetch(`${base}/api/v1/movies`)).status).toBe(401)
    const headers = { Authorization: 'Bearer test-token' }
    const movies = await (await fetch(`${base}/api/v1/movies?actor=${encodeURIComponent('测试演员')}&tag=${encodeURIComponent('测试标签')}&sort=release-desc`, { headers })).json() as { items: Array<Record<string, unknown>> }
    expect(movies.items).toHaveLength(1)
    expect(movies.items[0]).not.toHaveProperty('path')
    expect((movies.items[0].files as Array<Record<string, unknown>>)[0]).not.toHaveProperty('path')
    expect(await (await fetch(`${base}/api/v1/tags`, { headers })).json()).toEqual([{ name: '测试标签', movieCount: 1 }])
    expect((await (await fetch(`${base}/api/v1/actors/${encodeURIComponent('测试演员')}`, { headers })).json() as { name: string }).name).toBe('测试演员')
  })
})
