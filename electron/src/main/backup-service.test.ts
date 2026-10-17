import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { BackupService } from './backup-service'
import type { AppDatabase } from './database'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'avault-backup-'))
  const data = join(root, 'AVault-data')
  const media = join(root, 'media')
  const backup = join(root, 'backups')
  await mkdir(data, { recursive: true })
  const { AppDatabase } = await import('./database')
  const database = new AppDatabase(join(data, 'avault.sqlite'))
  database.setSetting('deepSeekApiKey', 'secret-key')
  database.addLibrary(media)
  await mkdir(join(data, 'actors'), { recursive: true })
  await writeFile(join(data, 'actors', 'actor.jpg'), 'avatar')
  await mkdir(join(media, 'nested'), { recursive: true })
  await writeFile(join(media, 'movie.mp4'), 'video-never-backup')
  await writeFile(join(media, 'ABC-123.avault.json'), '{"title":"资料"}')
  await writeFile(join(media, 'ABC-123.avault-cover.jpg'), 'cover')
  await writeFile(join(media, 'nested', 'ABC-123.avault-preview.jpg'), 'preview')
  const service = new BackupService(database, data, '0.1.0-test', () => undefined)
  await service.setDirectory(backup)
  return { root, data, media, backup, database, service }
}

describe.runIf(process.versions.modules === '139')('BackupService', () => {
  it('backs up a consistent database and actor avatars without copying media-directory files', async () => {
    const test = await fixture()
    try {
      const record = await test.service.createBackup()
      expect(record.status).toBe('completed')
      expect(record.companionFileCount).toBe(0)
      expect(await readFile(join(record.directory, 'app-data', 'avault.sqlite'))).toBeTruthy()
      expect(await readFile(join(record.directory, 'app-data', 'actors', 'actor.jpg'), 'utf8')).toBe('avatar')
      const manifest = JSON.parse(await readFile(join(record.directory, 'manifest.json'), 'utf8')) as { libraries: Array<{ archiveName: string }> }
      await expect(stat(join(record.directory, 'library-assets', manifest.libraries[0].archiveName, 'ABC-123.avault.json'))).rejects.toThrow()
    } finally {
      test.database.close()
      await rm(test.root, { recursive: true, force: true })
    }
  })

  it('validates before restore, creates a safety snapshot, and leaves media-directory files untouched', async () => {
    const test = await fixture()
    try {
      const backup = await test.service.createBackup()
      test.database.setSetting('deepSeekApiKey', 'changed-key')
      await writeFile(join(test.media, 'ABC-123.avault-cover.jpg'), 'changed-cover')
      const prepared = await test.service.prepareRestore(backup.directory)
      expect(prepared.report.safetySnapshotDirectory).toBeTruthy()
      test.database.close()
      await test.service.restorePrepared(prepared)
      const { AppDatabase } = await import('./database')
      const restored = new AppDatabase(join(test.data, 'avault.sqlite'))
      try {
        expect(restored.getSetting('deepSeekApiKey')).toBe('secret-key')
        expect(await readFile(join(test.media, 'ABC-123.avault-cover.jpg'), 'utf8')).toBe('changed-cover')
      } finally { restored.close() }
    } finally {
      await rm(test.root, { recursive: true, force: true })
    }
  })

  it('rejects a damaged database before creating a safety snapshot', async () => {
    const test = await fixture()
    try {
      const backup = await test.service.createBackup()
      await writeFile(join(backup.directory, 'app-data', 'avault.sqlite'), 'damaged')
      await expect(test.service.prepareRestore(backup.directory)).rejects.toThrow('备份数据库校验失败')
      expect((await test.service.list()).filter((item) => item.isSafetySnapshot)).toHaveLength(0)
    } finally {
      test.database.close()
      await rm(test.root, { recursive: true, force: true })
    }
  })
})
