import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from './database'

describe.runIf(process.versions.modules === '139')('source partition precedence', () => {
  it('preserves manual and local-json values over later scans', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-partition-'))
    const database = new AppDatabase(join(root, 'avault.sqlite'))
    try {
      const library = database.addLibrary(root)
      const input = { libraryId: library.id, path: join(root, 'SSIS-826.mp4'), name: 'SSIS-826.mp4', relativeDir: '', extension: 'mp4', size: 1, mtimeMs: 1, codeRecognized: true, sourcePartition: 'leaked' as const, sourcePartitionSource: 'folder' as const, normalizedCode: 'SSIS-826', partLabel: null, versionLabel: null, mediaInfo: null }
      const movieId = database.upsertScannedFile(input)
      expect(database.getMovie(movieId)).toMatchObject({ sourcePartition: 'leaked', sourcePartitionSource: 'folder' })

      database.updateMovie(movieId, { sourcePartition: 'censored' })
      database.upsertScannedFile({ ...input, sourcePartition: 'uncensored', sourcePartitionSource: 'filename', mtimeMs: 2 })
      expect(database.getMovie(movieId)).toMatchObject({ sourcePartition: 'censored', sourcePartitionSource: 'manual' })

      database.setMovieSourcePartition(movieId, 'leaked', 'local-json')
      database.upsertScannedFile({ ...input, sourcePartition: 'censored', sourcePartitionSource: 'folder', mtimeMs: 3 })
      expect(database.getMovie(movieId)).toMatchObject({ sourcePartition: 'leaked', sourcePartitionSource: 'local-json' })
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
