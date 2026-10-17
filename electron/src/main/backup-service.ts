import { createHash } from 'node:crypto'
import { cp, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AppDatabase } from './database'
import type { BackupManifest, BackupProgress, BackupRecord, BackupRestoreReport } from '../shared/contracts'

const FORMAT_VERSION = 1
const RETENTION_COUNT = 5
const APP_ASSET_DIRECTORIES = ['actors']

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function hashPath(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 16)
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function isInside(root: string, target: string): boolean {
  const result = relative(resolve(root), resolve(target))
  return result === '' || (!result.startsWith(`..${sep}`) && result !== '..' && !isAbsolute(result))
}

function safeRelative(value: string): boolean {
  return Boolean(value) && !isAbsolute(value) && !value.split(/[\\/]+/).some((part) => part === '..' || !part)
}

async function pathSize(path: string): Promise<number> {
  const entry = await stat(path)
  if (entry.isFile()) return entry.size
  let total = 0
  for (const child of await readdir(path, { withFileTypes: true })) {
    if (!child.isSymbolicLink()) total += await pathSize(join(path, child.name))
  }
  return total
}

export class BackupService {
  private activeAbort: AbortController | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly dataDirectory: string,
    private readonly appVersion: string,
    private readonly onProgress: (progress: BackupProgress) => void,
  ) {}

  defaultDirectory(): string {
    return join(dirname(this.dataDirectory), 'AVault-backups')
  }

  getDirectory(): string {
    return resolve(this.database.getSetting('backupDirectory') ?? this.defaultDirectory())
  }

  async setDirectory(value: string): Promise<string> {
    const target = resolve(value)
    if (isInside(this.dataDirectory, target) || isInside(target, this.dataDirectory)) throw new Error('备份目录不能位于 AVault 数据目录内')
    await mkdir(target, { recursive: true })
    this.database.setSetting('backupDirectory', target)
    return target
  }

  cancel(): void {
    this.activeAbort?.abort()
  }

  async list(): Promise<BackupRecord[]> {
    const root = this.getDirectory()
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const directory = join(root, entry.name)
        const manifestPath = join(directory, 'manifest.json')
        try {
          const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest
          const databasePath = join(directory, 'app-data', 'avault.sqlite')
          if (!this.isManifestValid(manifest) || !(await stat(databasePath)).isFile()) throw new Error('invalid')
          return { id: entry.name, directory, status: 'completed' as const, createdAt: manifest.createdAt, completedAt: manifest.completedAt, size: await pathSize(directory), appVersion: manifest.appVersion, libraryCount: manifest.libraries.length, companionFileCount: manifest.libraries.reduce((total, item) => total + item.assets.length, 0), isSafetySnapshot: Boolean(manifest.isSafetySnapshot) }
        } catch {
          return { id: entry.name, directory, status: entry.name.startsWith('.incomplete-') ? 'incomplete' as const : 'invalid' as const, createdAt: null, completedAt: null, size: await pathSize(directory).catch(() => 0), appVersion: null, libraryCount: 0, companionFileCount: 0, isSafetySnapshot: false }
        }
      }))
      return records.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    } catch {
      return []
    }
  }

  async createBackup(options: { isSafetySnapshot?: boolean; protectedDirectories?: string[] } = {}): Promise<BackupRecord> {
    if (this.activeAbort) throw new Error('已有备份任务正在运行')
    const controller = new AbortController()
    this.activeAbort = controller
    const root = this.getDirectory()
    const id = `${options.isSafetySnapshot ? '恢复前安全快照-' : 'AVault-'}${timestamp()}`
    const staging = join(root, `.incomplete-${id}`)
    const finalDirectory = join(root, id)
    const startedAt = new Date().toISOString()
    let copiedFiles = 0
    let copiedBytes = 0
    const publish = (phase: BackupProgress['phase'], message: string) => this.onProgress({ phase, message, copiedFiles, copiedBytes, totalFiles: null, cancellable: true })
    const checkCancelled = () => { if (controller.signal.aborted) throw new Error('备份已取消') }
    try {
      await mkdir(staging, { recursive: true })
      publish('database', '正在创建数据库一致性快照')
      checkCancelled()
      const appDataDirectory = join(staging, 'app-data')
      await mkdir(appDataDirectory, { recursive: true })
      const databasePath = join(appDataDirectory, 'avault.sqlite')
      await this.database.sqlite.backup(databasePath)
      copiedFiles += 1
      copiedBytes += (await stat(databasePath)).size

      publish('assets', '正在备份演员头像与本地导入封面')
      for (const name of APP_ASSET_DIRECTORIES) {
        checkCancelled()
        const source = join(this.dataDirectory, name)
        try {
          if ((await stat(source)).isDirectory()) await cp(source, join(appDataDirectory, name), { recursive: true, dereference: false })
        } catch { /* optional local asset directory */ }
      }

      // Media directories remain entirely untouched: videos, covers, previews,
      // and sidecar JSON are already portable alongside the user's files.
      const libraries: BackupManifest['libraries'] = this.database.listLibraries().map((library) => ({
        id: library.id,
        name: library.name,
        rootPath: resolve(library.path),
        archiveName: `library-${hashPath(resolve(library.path))}`,
        availableAtBackup: false,
        assets: []
      }))

      publish('verifying', '正在校验备份完整性')
      const databaseSha256 = await sha256(databasePath)
      const manifest: BackupManifest = { formatVersion: FORMAT_VERSION, kind: 'avault-backup', createdAt: startedAt, completedAt: new Date().toISOString(), appVersion: this.appVersion, isSafetySnapshot: Boolean(options.isSafetySnapshot), database: { path: 'app-data/avault.sqlite', size: (await stat(databasePath)).size, sha256: databaseSha256 }, libraries }
      await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      await this.validateDirectory(staging)
      await rename(staging, finalDirectory)
      const record = (await this.list()).find((item) => item.id === id)
      if (!record) throw new Error('备份完成后无法读取备份清单')
      await this.prune(finalDirectory, options.protectedDirectories ?? [])
      this.database.addLog('metadata', 'info', `数据备份完成：${id}`, `旁路资料：${record.companionFileCount} 个\n媒体目录：${record.libraryCount} 个\n大小：${record.size} 字节`)
      this.onProgress({ phase: 'complete', message: '备份完成', copiedFiles, copiedBytes, totalFiles: copiedFiles, cancellable: false })
      return record
    } catch (error) {
      const cancelled = controller.signal.aborted
      this.onProgress({ phase: cancelled ? 'cancelled' : 'error', message: cancelled ? '备份已取消' : error instanceof Error ? error.message : String(error), copiedFiles, copiedBytes, totalFiles: null, cancellable: false })
      if (!cancelled) this.database.addLog('metadata', 'error', '数据备份失败', error instanceof Error ? error.stack ?? error.message : String(error))
      throw error
    } finally {
      this.activeAbort = null
    }
  }

  async prepareRestore(backupDirectory: string): Promise<{ source: string; manifest: BackupManifest; report: BackupRestoreReport }> {
    const source = resolve(backupDirectory)
    const manifest = await this.validateDirectory(source)
    const report: BackupRestoreReport = { backupId: basename(source), restoredAt: new Date().toISOString(), safetySnapshotDirectory: null, restoredCompanionFiles: 0, skippedCompanionFiles: 0, missingLibraryRoots: [], skippedReasons: [] }
    const safety = await this.createBackup({ isSafetySnapshot: true, protectedDirectories: [source] })
    report.safetySnapshotDirectory = safety.directory
    this.onProgress({ phase: 'restoring', message: '正在恢复应用数据', copiedFiles: 0, copiedBytes: 0, totalFiles: null, cancellable: false })
    return { source, manifest, report }
  }

  async restorePrepared(prepared: { source: string; manifest: BackupManifest; report: BackupRestoreReport }): Promise<BackupRestoreReport> {
    const { source, manifest, report } = prepared
    await this.restoreApplicationData(source)
    // Never restore files in media directories. They can be large, live on a
    // removable disk, and are intentionally managed independently of AVault.
    await writeFile(join(this.dataDirectory, 'last-restore-report.json'), JSON.stringify(report, null, 2), 'utf8')
    return report
  }

  async getLastRestoreReport(): Promise<BackupRestoreReport | null> {
    try { return JSON.parse(await readFile(join(this.dataDirectory, 'last-restore-report.json'), 'utf8')) as BackupRestoreReport } catch { return null }
  }

  async clearLastRestoreReport(): Promise<void> {
    await rm(join(this.dataDirectory, 'last-restore-report.json'), { force: true })
  }

  private isManifestValid(value: BackupManifest): boolean {
    return value?.kind === 'avault-backup' && value.formatVersion === FORMAT_VERSION && typeof value.createdAt === 'string' && typeof value.completedAt === 'string' && typeof value.database?.path === 'string' && Array.isArray(value.libraries)
  }

  private async validateDirectory(directory: string): Promise<BackupManifest> {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as BackupManifest
    if (!this.isManifestValid(manifest)) throw new Error('备份格式无效或版本不受支持')
    if (!safeRelative(manifest.database.path)) throw new Error('备份数据库路径无效')
    const databasePath = resolve(directory, manifest.database.path)
    if (!isInside(directory, databasePath) || (await stat(databasePath)).size !== manifest.database.size || await sha256(databasePath) !== manifest.database.sha256) throw new Error('备份数据库校验失败')
    for (const library of manifest.libraries) {
      if (!safeRelative(library.archiveName) || !isAbsolute(library.rootPath)) throw new Error('备份媒体目录信息无效')
      for (const asset of library.assets) if (!safeRelative(asset.relativePath)) throw new Error('备份包含非法旁路文件路径')
    }
    return manifest
  }

  private async restoreApplicationData(source: string): Promise<void> {
    const sourceAppData = join(source, 'app-data')
    const incomingDatabase = join(sourceAppData, 'avault.sqlite')
    const targetDatabase = join(this.dataDirectory, 'avault.sqlite')
    const stagedDatabase = join(this.dataDirectory, `.avault.sqlite.restore-${Date.now()}`)
    await copyFile(incomingDatabase, stagedDatabase)
    await rm(`${targetDatabase}-wal`, { force: true })
    await rm(`${targetDatabase}-shm`, { force: true })
    await rm(targetDatabase, { force: true })
    await rename(stagedDatabase, targetDatabase)
    for (const name of APP_ASSET_DIRECTORIES) {
      const incoming = join(sourceAppData, name)
      let incomingExists = false
      try { incomingExists = (await stat(incoming)).isDirectory() } catch { /* optional directory absent from an older backup */ }
      if (!incomingExists) continue
      const staged = join(this.dataDirectory, `.${name}.restore-${Date.now()}`)
      await cp(incoming, staged, { recursive: true, dereference: false })
      const target = join(this.dataDirectory, name)
      await rm(target, { recursive: true, force: true })
      await rename(staged, target)
    }
  }

  private async prune(excludeDirectory: string, protectedDirectories: string[]): Promise<void> {
    const protectedSet = new Set([resolve(excludeDirectory), ...protectedDirectories.map((item) => resolve(item))])
    const completed = (await this.list()).filter((item) => item.status === 'completed')
    let remaining = completed.length
    for (const item of [...completed].reverse()) {
      if (remaining <= RETENTION_COUNT) break
      if (protectedSet.has(resolve(item.directory))) continue
      await rm(item.directory, { recursive: true, force: true })
      remaining -= 1
    }
  }
}
