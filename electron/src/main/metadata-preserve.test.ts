import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from './database'

describe.runIf(process.versions.modules === '139')('metadata preserve mode', () => {
  it('fills empty manual fields while preserving manual fields with content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'avault-metadata-preserve-'))
    const database = new AppDatabase(join(root, 'avault.sqlite'))
    try {
      const library = database.addLibrary(root)
      const movieId = database.upsertScannedFile({ libraryId: library.id, path: join(root, 'TH101-140-112594.mp4'), name: 'TH101-140-112594.mp4', relativeDir: '', extension: 'mp4', size: 1, mtimeMs: 1, codeRecognized: true, sourcePartition: 'uncensored', sourcePartitionSource: 'filename', normalizedCode: 'TH101-140-112594', partLabel: null, versionLabel: null, mediaInfo: null })
      database.updateMovie(movieId, { title: '我的标题', releaseDate: null, actors: [], tags: [] })
      const updated = database.applyMetadata(movieId, {
        providerId: 'th101-140-112594', code: 'TH101-140-112594', title: '网站标题', coverUrl: null,
        description: '', releaseDate: '2019-04-27', durationMinutes: 70, director: null,
        studio: '東京熱', label: 'EMPIRE', series: null, actors: ['琥珀うた'], tags: ['口交']
      }, null, 'preserve')
      expect(updated).toMatchObject({ title: '我的标题', releaseDate: '2019-04-27', actors: ['琥珀うた'], tags: ['口交'] })
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
