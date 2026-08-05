import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, relative, resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  protocol,
  safeStorage,
  session,
  shell,
  Tray
} from 'electron'
import { AppDatabase } from './database'
import { MediaScanner } from './scanner'
import { JavBusNotFoundError, JavBusProvider } from './javbus'
import { Fc2Provider, fc2ArticleId } from './fc2'
import { GfriendsActorProvider } from './gfriends'
import { DeepSeekActorProvider } from './deepseek'
import { parseJavDbHtml } from './javdb-html'
import { searchActorPublicSources } from './actor-web-search'
import { PotPlayerService } from './potplayer'
import { LanServer } from './lan-server'
import { FfmpegService } from './ffmpeg'
import { MediaOrganizer, createOrganizePreview } from './organizer'
import { sidecarPathForMediaFile, writeMovieSidecar } from './sidecar'
import { pickNextFfmpegSource } from './ffmpeg-task-queue'
import type { ActorProfilePatch, HomePreferences, MetadataBatchProgress, MetadataDetails, MoviePatch, MovieRecord, ScanProgress, SourcePartition, ToolEncodeOptions, ToolFile, ToolTask, TranscodeKind, TranscodeProgress } from '../shared/contracts'

protocol.registerSchemesAsPrivileged([
  { scheme: 'avault-media', privileges: { secure: true, standard: true, supportFetchAPI: true } }
])

// Keep AVault data outside the installation directory. NSIS can replace that
// directory during upgrades, so colocating database data there risks deletion.
// The installed build uses a stable folder at the root of its installation drive
// (for example D:\AVault-data), while development can override it explicitly.
const configuredDataDirectory = process.env.AVAULT_DATA_DIR?.trim()
const avaultDataDirectory = configuredDataDirectory
  ? resolve(configuredDataDirectory)
  : app.isPackaged
    ? join(parse(process.execPath).root, 'AVault-data')
    : join(app.getAppPath(), 'data')
app.setPath('userData', avaultDataDirectory)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let database: AppDatabase
let scanner: MediaScanner
let potPlayer: PotPlayerService
let lanServer: LanServer
let ffmpeg: FfmpegService
let metadataBatchRunning = false
const metadataLookupSessions = new Map<string, { provider: JavBusProvider | Fc2Provider; expiresAt: number }>()
let syncedFc2Cookie = ''
const transcodeTasks: TranscodeProgress[] = []
let processingFfmpegQueue = false
let organizer: MediaOrganizer | null = null
const toolTasks: ToolTask[] = []
let ffmpegWork = Promise.resolve()
let activeQueuedTask: { source: 'media' | 'tool'; id: string } | null = null
let ffmpegTaskSequence = 0
const TOOL_VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.ts'])

function enqueueFfmpeg<T>(operation: () => Promise<T>): Promise<T> {
  const result = ffmpegWork.then(operation, operation)
  ffmpegWork = result.then(() => undefined, () => undefined)
  return result
}

const METADATA_BATCH_DELAY_MS = 5_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

function trayIcon() {
  return nativeImage.createFromPath(appIconPath()).resize({ width: 16, height: 16 })
}

function createWindow(): BrowserWindow {
  const headless = process.argv.includes('--headless')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0e0f12',
    title: 'AVault',
    icon: appIconPath(),
    frame: false,
    thickFrame: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  window.removeMenu()
  window.on('ready-to-show', () => {
    if (headless) return
    window.maximize()
    window.show()
  })
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

function createTray(): void {
  tray = new Tray(trayIcon())
  tray.setToolTip('AVault · 局域网服务运行中')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 AVault', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: '完全退出', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function notifyScan(progress: ScanProgress): void {
  mainWindow?.webContents.send('scan:progress', progress)
}

function createProvider(): JavBusProvider {
  return new JavBusProvider(database.getSettings().javBusBaseUrl, join(app.getPath('userData'), 'covers'), join(app.getPath('userData'), 'actors'))
}

function needsMetadataLookup(movie: MovieRecord): boolean {
  const title = movie.title.trim().toUpperCase()
  const codes = [movie.code, movie.normalizedCode]
    .filter((code): code is string => Boolean(code))
    .map((code) => code.trim().toUpperCase())
  const hasMeaningfulTitle = Boolean(title) && !codes.includes(title)
  return !(
    movie.metadataSource || hasMeaningfulTitle || movie.releaseDate || movie.durationMinutes || movie.director || movie.studio || movie.label || movie.series ||
    movie.description.trim() || movie.actors.length || movie.tags.length
  )
}

function previewSourceFile(movie: MovieRecord) {
  return movie.files.find((file) => file.available && !/HEVC/.test(file.versionLabel ?? '') && !file.partLabel)
    ?? movie.files.find((file) => file.available && !/HEVC/.test(file.versionLabel ?? ''))
    ?? movie.files.find((file) => file.available)
    ?? null
}

async function previewUrlForMovie(movie: MovieRecord): Promise<string | null> {
  const file = previewSourceFile(movie)
  if (!file) return null
  const previewPath = ffmpeg.previewPath(file.path)
  try {
    const info = await stat(previewPath)
    return `avault-media://preview/${encodeURIComponent(file.id)}?v=${encodeURIComponent(String(info.mtimeMs))}`
  } catch {
    return null
  }
}

function storedFc2Cookie(): string {
  const plain = database.getSetting('fc2Cookie')
  if (plain) return plain
  const encrypted = database.getSetting('fc2CookieEncrypted')
  if (!encrypted) return ''
  try {
    const migrated = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    database.setSetting('fc2Cookie', migrated)
    database.setSetting('fc2CookieEncrypted', '')
    return migrated
  } catch {
    return ''
  }
}

function cookiePairs(cookieHeader: string): Array<{ name: string; value: string }> {
  return cookieHeader.split(';').map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator <= 0) return []
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ? [{ name, value }] : []
  })
}

async function fc2CookieHeader(): Promise<string> {
  const stored = storedFc2Cookie()
  if (stored && stored !== syncedFc2Cookie) {
    for (const cookie of cookiePairs(stored)) {
      await session.defaultSession.cookies.set({
        url: 'https://adult.contents.fc2.com/',
        name: cookie.name,
        value: cookie.value,
        path: '/',
        secure: true
      })
    }
    syncedFc2Cookie = stored
  }
  if (stored) return stored
  const cookies = await session.defaultSession.cookies.get({ url: 'https://adult.contents.fc2.com/' })
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

function appSettings() {
  const fc2Cookie = storedFc2Cookie()
  const deepSeekApiKey = database.getSetting('deepSeekApiKey') ?? ''
  const defaults: HomePreferences = { sort: 'added-desc', watchFilter: 'all', view: 'grid', gridCoverMode: 'landscape' }
  let homePreferences = defaults
  try {
    const parsed = JSON.parse(database.getSetting('homePreferences') ?? '') as Partial<HomePreferences>
    if (['added-desc', 'added-asc', 'release-desc', 'release-asc', 'code-asc', 'title-asc'].includes(parsed.sort ?? '') && ['all', 'unwatched', 'watching', 'watched'].includes(parsed.watchFilter ?? '') && ['grid', 'list'].includes(parsed.view ?? '') && ['landscape', 'portrait'].includes(parsed.gridCoverMode ?? '')) homePreferences = parsed as HomePreferences
  } catch { /* Use defaults for an absent or malformed saved preference. */ }
  return { ...database.getSettings(), fc2CookieConfigured: Boolean(fc2Cookie), fc2Cookie, deepSeekApiKeyConfigured: Boolean(deepSeekApiKey), deepSeekApiKey, homePreferences, ffmpeg: ffmpeg?.getStatus() ?? database.getSettings().ffmpeg }
}

function normalizeCookieHeader(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const cookieLine = lines.find((line) => /^cookie\s*:/i.test(line))
  const source = cookieLine ? cookieLine.replace(/^cookie\s*:\s*/i, '') : lines.join('; ')
  return cookiePairs(source).map(({ name, value }) => `${name}=${value}`).join('; ')
}

function createFc2Provider(): Fc2Provider {
  return new Fc2Provider(
    'https://adult.contents.fc2.com',
    join(app.getPath('userData'), 'covers'),
    fc2CookieHeader,
    (url, init) => session.defaultSession.fetch(url, init)
  )
}

function coverDestination(movie: MovieRecord, extension: string): { directory: string; fileBase: string; path: string } {
  const primaryFile = movie.files.find((file) => file.available && !file.versionLabel) ?? movie.files.find((file) => file.available)
  if (!primaryFile) throw new Error('没有可用的本地影片文件，无法将封面保存到影片目录')
  const rawName = movie.normalizedCode ?? movie.code ?? movie.id
  const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim() || movie.id
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`
  const directory = dirname(primaryFile.path)
  const fileBase = `${safeName}.avault-cover`
  return { directory, fileBase, path: join(directory, `${fileBase}${normalizedExtension}`) }
}

async function cacheCoverForMovie(provider: JavBusProvider | Fc2Provider, movie: MovieRecord, coverUrl: string | null): Promise<string | null> {
  const destination = coverDestination(movie, '.jpg')
  let targetDirectory = destination.directory
  try {
    const probe = join(targetDirectory, `.avault-write-probe-${process.pid}`)
    await writeFile(probe, '')
    await rm(probe, { force: true })
  } catch {
    targetDirectory = join(app.getPath('userData'), 'imported-covers')
  }
  return provider.cacheCover(targetDirectory, destination.fileBase, coverUrl)
}

async function persistMovieSidecar(movie: MovieRecord): Promise<boolean> {
  try {
    return Boolean(await writeMovieSidecar(movie, database.getCoverPath(movie.id)))
  } catch (error) {
    database.addLog('metadata', 'error', `本地资料写入失败：${movie.normalizedCode ?? movie.code ?? movie.title}`, error instanceof Error ? error.stack ?? error.message : String(error))
    return false
  }
}

async function relocateSidecarWithMovie(movieId: string, sourceVideoPath: string, targetVideoPath: string): Promise<void> {
  const movie = database.getMovie(movieId)
  if (!movie) return
  const source = sidecarPathForMediaFile(sourceVideoPath, movie.normalizedCode ?? movie.code)
  const target = sidecarPathForMediaFile(targetVideoPath, movie.normalizedCode ?? movie.code)
  if (resolve(source).toLowerCase() === resolve(target).toLowerCase() || !existsSync(source)) return
  if (!existsSync(target)) await copyFile(source, target)
  await rm(source, { force: true })
}

async function exportLocalJsonForLibrary(libraryId: string): Promise<{ libraryId: string; total: number; exported: number; failed: number; errors: string[] }> {
  const result = { libraryId, total: 0, exported: 0, failed: 0, errors: [] as string[] }
  for (const movie of database.listMovies().filter((item) => item.files.some((file) => file.libraryId === libraryId && file.available))) {
    result.total += 1
    try {
      if (await writeMovieSidecar(movie, database.getCoverPath(movie.id))) result.exported += 1
    } catch (error) {
      result.failed += 1
      if (result.errors.length < 5) result.errors.push(`${movie.normalizedCode ?? movie.code ?? movie.title}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return result
}

async function migrateStoredCovers(): Promise<{ moved: number; skipped: number }> {
  const legacyDirectory = resolve(join(app.getPath('userData'), 'covers'))
  const prefix = `${legacyDirectory.toLowerCase()}\\`
  let moved = 0
  let skipped = 0
  for (const movie of database.listMovies()) {
    const source = database.getCoverPath(movie.id)
    if (!source || !resolve(source).toLowerCase().startsWith(prefix) || !existsSync(source)) continue
    try {
      const destination = coverDestination(movie, extname(source) || '.jpg').path
      if (resolve(source).toLowerCase() !== resolve(destination).toLowerCase()) {
        if (!existsSync(destination)) await copyFile(source, destination)
        database.relocateCoverPath(movie.id, destination)
        await rm(source, { force: true })
      }
      moved += 1
    } catch {
      skipped += 1
    }
  }
  return { moved, skipped }
}

async function relocateCoverWithMovie(movieId: string, sourceVideoPath: string, targetVideoPath: string): Promise<void> {
  const sourceCover = database.getCoverPath(movieId)
  if (!sourceCover || dirname(resolve(sourceCover)).toLowerCase() !== dirname(resolve(sourceVideoPath)).toLowerCase()) return
  const targetCover = join(dirname(targetVideoPath), basename(sourceCover))
  if (resolve(sourceCover).toLowerCase() === resolve(targetCover).toLowerCase()) return
  if (!existsSync(targetCover)) await copyFile(sourceCover, targetCover)
  database.relocateCoverPath(movieId, targetCover)
  await rm(sourceCover, { force: true })
}

function manualActorAvatarPath(name: string, extension: string): string {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`
  const key = createHash('sha256').update(name.normalize('NFKC').trim()).digest('hex').slice(0, 20)
  return join(app.getPath('userData'), 'actors', `manual-${key}${normalizedExtension}`)
}

function publishTranscode(task: TranscodeProgress): void {
  mainWindow?.webContents.send('transcode:progress', { ...task })
}

function publishToolTask(task: ToolTask): void { mainWindow?.webContents.send('tool:task-progress', { ...task }) }

async function inspectToolFiles(paths: string[]): Promise<ToolFile[]> {
  const unique = [...new Set(paths.map((path) => resolve(path)))]
  const files: ToolFile[] = []
  for (const path of unique) {
    if (!TOOL_VIDEO_EXTENSIONS.has(extname(path).toLowerCase())) continue
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      files.push({ path, name: basename(path), size: info.size, mediaInfo: await ffmpeg.analyze(path) })
    } catch { /* Ignore files which are inaccessible or no longer exist. */ }
  }
  return files
}

function validToolOptions(options: ToolEncodeOptions): ToolEncodeOptions {
  const frameRates = new Set(['24000/1001', '24', '25', '30000/1001', '30', '50', '60000/1001', '60'])
  if (!options || !['h264', 'hevc'].includes(options.codec) || (options.frameRate !== null && !frameRates.has(options.frameRate)) || !Number.isInteger(options.cq) || options.cq < 0 || options.cq > 51 || (options.maxBitrateKbps !== null && (!Number.isInteger(options.maxBitrateKbps) || options.maxBitrateKbps < 200 || options.maxBitrateKbps > 100000)) || (options.height !== null && (!Number.isInteger(options.height) || options.height < 144 || options.height > 4320))) throw new Error('转码参数无效')
  return options
}

async function runMediaTask(task: TranscodeProgress): Promise<void> {
  const file = database.getFile(task.fileId)
  if (!file?.available) {
    Object.assign(task, { state: 'failed', message: '源文件已失效' }); publishTranscode(task); return
  }
  try {
    const result = await enqueueFfmpeg(async () => {
      if (!transcodeTasks.includes(task) || task.state !== 'queued') throw new Error('转码已取消')
      activeQueuedTask = { source: 'media', id: `${task.fileId}:${task.kind}` }
      Object.assign(task, { state: 'running', percent: 0, message: undefined }); publishTranscode(task)
      try {
        return await ffmpeg.transcode(file.path, file.id, task.kind, (progress) => { Object.assign(task, progress); publishTranscode(task) }, (command) => database.addLog('ffmpeg', 'info', `开始转码：${file.name}`, command))
      } finally { activeQueuedTask = null }
    })
    await scanner.scan(file.libraryId)
    Object.assign(task, { state: 'completed', percent: 100, speed: null, etaSeconds: 0, outputPath: result.outputPath, message: '转码完成' })
    database.addLog('ffmpeg', 'info', `转码完成：${file.name}`, `输出文件：${result.outputPath}`)
  } catch (error) {
    const cancelled = error instanceof Error && error.message.includes('已取消')
    Object.assign(task, { state: cancelled ? 'cancelled' : 'failed', percent: null, speed: null, etaSeconds: null, message: error instanceof Error ? error.message : '转码失败' })
    database.addLog('ffmpeg', cancelled ? 'info' : 'error', `${cancelled ? '转码已取消' : '转码失败'}：${file.name}`, error instanceof Error ? error.stack ?? error.message : String(error))
  }
  publishTranscode(task)
}

async function runToolTask(task: ToolTask): Promise<void> {
  try {
    const result = await enqueueFfmpeg(async () => {
      if (!toolTasks.includes(task) || task.state !== 'queued') throw new Error('任务已取消')
      activeQueuedTask = { source: 'tool', id: task.id }
      Object.assign(task, { state: 'running', percent: 0, message: task.type === 'merge-copy' ? '正在无损合并' : task.type === 'merge-transcode' ? '正在转码合并' : '正在转码' }); publishToolTask(task)
      try {
        return await (task.type === 'transcode'
          ? ffmpeg.toolTranscode(task.inputPaths[0], task.options!, (progress) => { Object.assign(task, progress); publishToolTask(task) }, (command) => database.addLog('ffmpeg', 'info', `工具箱转码：${task.outputName}`, command))
          : ffmpeg.merge(task.inputPaths, task.outputName, task.type === 'merge-copy' ? 'copy' : 'transcode', task.options!, (progress) => { Object.assign(task, progress); publishToolTask(task) }, (command) => database.addLog('ffmpeg', 'info', `工具箱合并：${task.outputName}`, command)))
      } finally { activeQueuedTask = null }
    })
    Object.assign(task, { state: 'completed', percent: 100, speed: null, etaSeconds: 0, outputPath: result.outputPath, message: '完成' })
    database.addLog('ffmpeg', 'info', `工具箱任务完成：${task.outputName}`, `输出文件：${result.outputPath}`)
  } catch (error) {
    const cancelled = error instanceof Error && error.message.includes('取消')
    Object.assign(task, { state: cancelled ? 'cancelled' : 'failed', percent: null, speed: null, etaSeconds: null, message: error instanceof Error ? error.message : '任务失败' })
    database.addLog('ffmpeg', cancelled ? 'info' : 'error', `工具箱任务${cancelled ? '已取消' : '失败'}：${task.outputName}`, error instanceof Error ? error.stack ?? error.message : String(error))
  }
  publishToolTask(task)
}

async function processFfmpegQueue(): Promise<void> {
  if (processingFfmpegQueue) return
  processingFfmpegQueue = true
  try {
    while (true) {
      const mediaTask = transcodeTasks.find((task) => task.state === 'queued')
      const toolTask = toolTasks.find((task) => task.state === 'queued')
      const source = pickNextFfmpegSource(transcodeTasks, toolTasks)
      if (!source) return
      if (source === 'media' && mediaTask) await runMediaTask(mediaTask)
      else if (source === 'tool' && toolTask) await runToolTask(toolTask)
    }
  } finally { processingFfmpegQueue = false }
}

function registerIpc(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('fc2:set-cookie', async (_event, cookieHeader: string) => {
    const normalized = normalizeCookieHeader(cookieHeader)
    if (cookieHeader.trim() && !normalized) throw new Error('没有识别到有效的 Cookie，请粘贴 Cookie 请求头的值')
    database.setSetting('fc2Cookie', normalized)
    database.setSetting('fc2CookieEncrypted', '')
    syncedFc2Cookie = ''
    if (normalized) await fc2CookieHeader()
  })
  ipcMain.handle('deepseek:set-api-key', (_event, apiKey: string) => {
    database.setSetting('deepSeekApiKey', apiKey.trim())
  })
  ipcMain.handle('preferences:set-home', (_event, preferences: HomePreferences) => {
    const valid = ['added-desc', 'added-asc', 'release-desc', 'release-asc', 'code-asc', 'title-asc'].includes(preferences?.sort) && ['all', 'unwatched', 'watching', 'watched'].includes(preferences?.watchFilter) && ['grid', 'list'].includes(preferences?.view) && ['landscape', 'portrait'].includes(preferences?.gridCoverMode)
    if (!valid) throw new Error('首页偏好设置无效')
    database.setSetting('homePreferences', JSON.stringify(preferences))
  })
  ipcMain.handle('ai:usage-stats', () => database.getAiUsageStats())
  ipcMain.handle('logs:list', (_event, scope?: 'ai' | 'ffmpeg') => database.listLogs(scope))
  ipcMain.handle('logs:clear', (_event, scope?: 'ai' | 'ffmpeg') => database.clearLogs(scope))
  ipcMain.handle('app:snapshot', () => ({
    libraries: database.listLibraries(),
    movies: database.listMovies(),
    devices: database.listDevices(),
    server: lanServer.getStatus(),
    settings: appSettings()
  }))

  ipcMain.handle('library:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: '选择媒体文件夹' })
    if (result.canceled || !result.filePaths[0]) return null
    const library = database.addLibrary(result.filePaths[0])
    void scanner.scan(library.id)
    return library
  })
  ipcMain.handle('library:scan', (_event, id: string) => scanner.scan(id))
  ipcMain.handle('library:organize-preview', (_event, id: string) => {
    const library = database.getLibrary(id)
    if (!library) throw new Error('媒体目录不存在')
    return createOrganizePreview(library, database.listMovies())
  })
  ipcMain.handle('library:organize', async (_event, id: string) => {
    const library = database.getLibrary(id)
    if (!library) throw new Error('媒体目录不存在')
    if (organizer) throw new Error('已有整理任务正在进行')
    const preview = createOrganizePreview(library, database.listMovies())
    organizer = new MediaOrganizer()
    const relocatedCoverMovies = new Set<string>()
    try {
      await organizer.execute(
        preview,
        (progress) => mainWindow?.webContents.send('organize:progress', { ...progress, libraryId: id }),
        (item) => {
          if (!item.targetPath) return
          database.relocateMediaFile(item.fileId, item.targetPath, basename(item.targetPath), relative(library.path, dirname(item.targetPath)))
          if (!relocatedCoverMovies.has(item.movieId)) {
            relocatedCoverMovies.add(item.movieId)
            return Promise.all([
              relocateCoverWithMovie(item.movieId, item.sourcePath, item.targetPath),
              relocateSidecarWithMovie(item.movieId, item.sourcePath, item.targetPath)
            ]).then(async () => {
              const movie = database.getMovie(item.movieId)
              if (movie) await persistMovieSidecar(movie)
            }).catch(() => undefined)
          }
        }
      )
      await scanner.scan(id)
    } finally { organizer = null }
  })
  ipcMain.handle('library:organize-cancel', () => organizer?.cancel())
  ipcMain.handle('library:remove', (_event, id: string) => database.removeLibrary(id))
  ipcMain.handle('library:set-source-partition', async (_event, id: string, partition: SourcePartition | null) => {
    let movies = database.setLibrarySourcePartition(id, partition)
    if (!partition) {
      // Remove stale folder-derived values from sidecars before rescanning;
      // otherwise the old JSON would immediately restore the cleared default.
      for (const movie of movies) await persistMovieSidecar(movie)
      await scanner.scan(id)
      movies = database.listMovies().filter((movie) => movie.files.some((file) => file.libraryId === id))
    }
    let sidecarFailed = 0
    for (const movie of movies) if (!await persistMovieSidecar(movie)) sidecarFailed += 1
    database.addLog('metadata', sidecarFailed ? 'error' : 'info', `片源分区已更新：${database.getLibrary(id)?.name ?? id}`, `分区：${partition ?? '自动判断'}\n影片：${movies.length}\nJSON 写入失败：${sidecarFailed}`)
    return { updated: movies.length, sidecarFailed }
  })
  ipcMain.handle('app:open-external', async (_event, value: string) => {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('链接无效') }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许打开网页链接')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle('movie:update', async (_event, id: string, patch: MoviePatch) => {
    const updated = database.updateMovie(id, patch)
    await persistMovieSidecar(updated)
    return updated
  })
  ipcMain.handle('metadata:parse-javdb-html', async (_event, html: string) => {
    try {
      const details = parseJavDbHtml(html)
      database.addLog('metadata', 'info', `JavDB HTML 解析完成：${details.code}`, `本地解析；字段：${[details.title, details.releaseDate, details.durationMinutes, details.director, details.studio, details.label, details.series, details.actors.length, details.tags.length].filter(Boolean).length}`)
      return details
    } catch (error) {
      database.addLog('metadata', 'error', 'JavDB HTML 解析失败', error instanceof Error ? error.message : String(error))
      throw error
    }
  })
  ipcMain.handle('movie:save-javdb-html-import', async (_event, id: string, patch: MoviePatch) => {
    const current = database.getMovie(id)
    if (!current) throw new Error('影片不存在')
    try {
      let updated = database.updateMovie(id, patch)
      updated = database.markMovieMetadataSource(updated.id, 'JavDB 本地 HTML')
      await persistMovieSidecar(updated)
      database.addLog('metadata', 'info', `JavDB HTML 资料已保存：${updated.normalizedCode ?? updated.code ?? updated.title}`, '仅保存文字资料；未下载或修改封面\n本地 JSON：已更新')
      return updated
    } catch (error) {
      database.addLog('metadata', 'error', `JavDB HTML 保存失败：${current.normalizedCode ?? current.code ?? current.title}`, error instanceof Error ? error.stack ?? error.message : String(error))
      throw error
    }
  })
  ipcMain.handle('movie:choose-cover', async (_event, id: string) => {
    const movie = database.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择影片封面',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const extension = extname(result.filePaths[0]).toLowerCase() || '.jpg'
    const target = coverDestination(movie, extension).path
    if (resolve(result.filePaths[0]).toLowerCase() !== resolve(target).toLowerCase()) await copyFile(result.filePaths[0], target)
    const updated = database.updateCover(id, target)
    await persistMovieSidecar(updated)
    return updated
  })
  ipcMain.handle('movie:paste-cover', async (_event, id: string) => {
    const movie = database.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const image = clipboard.readImage()
    if (image.isEmpty()) throw new Error('剪贴板中没有图片')
    const target = coverDestination(movie, '.png').path
    await writeFile(target, image.toPNG())
    const updated = database.updateCover(id, target)
    await persistMovieSidecar(updated)
    return updated
  })
  ipcMain.handle('movie:set-cover-data', async (_event, id: string, dataUrl: string) => {
    const movie = database.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const match = /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i.exec(dataUrl)
    if (!match) throw new Error('请选择有效的图片文件')
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) throw new Error('图片大小需要在 20 MB 以内')
    const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
    const target = coverDestination(movie, extension).path
    await writeFile(target, bytes)
    const updated = database.updateCover(id, target)
    await persistMovieSidecar(updated)
    return updated
  })
  ipcMain.handle('movie:remove-cover', async (_event, id: string) => {
    const current = database.getCoverPath(id)
    const updated = database.removeCover(id)
    if (current) await rm(current, { force: true }).catch(() => undefined)
    await persistMovieSidecar(updated)
    return updated
  })
  ipcMain.handle('movie:get-preview', async (_event, movieId: string) => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    return previewUrlForMovie(movie)
  })
  ipcMain.handle('movie:generate-preview', async (_event, movieId: string) => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    const file = previewSourceFile(movie)
    if (!file) throw new Error('没有可用的本地影片文件')
    try {
      const result = await enqueueFfmpeg(() => ffmpeg.generatePreview(file.path, (command) => database.addLog('ffmpeg', 'info', `生成影片预览图：${file.name}`, command)))
      database.addLog('ffmpeg', 'info', `影片预览图已生成：${file.name}`, `输出文件：${result.outputPath}`)
      return previewUrlForMovie(movie)
    } catch (error) {
      database.addLog('ffmpeg', 'error', `影片预览图生成失败：${file.name}`, error instanceof Error ? error.stack ?? error.message : String(error))
      throw error
    }
  })
  ipcMain.handle('movie:delete-preview', async (_event, movieId: string) => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    const file = previewSourceFile(movie)
    if (!file) throw new Error('没有可用的本地影片文件')
    const previewPath = ffmpeg.previewPath(file.path)
    await rm(previewPath, { force: true })
    database.addLog('ffmpeg', 'info', `影片预览图已删除：${file.name}`, `文件：${previewPath}`)
  })

  ipcMain.handle('metadata:lookup', async (_event, movieId: string) => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    const code = movie.normalizedCode ?? movie.code ?? ''
    try {
      // Keep the provider that performed the search. JavBus attaches visitor cookies
      // and a referer while searching; creating a fresh provider on “confirm” loses
      // that session and can cause an otherwise valid detail request to receive 403.
      const provider = fc2ArticleId(code) ? createFc2Provider() : createProvider()
      const candidates = provider instanceof JavBusProvider
        ? await provider.search(code, movie.sourcePartition === 'uncensored' ? 'uncensored' : 'censored')
        : await provider.search(code)
      metadataLookupSessions.set(movieId, { provider, expiresAt: Date.now() + 10 * 60_000 })
      database.addLog('metadata', 'info', `资料搜索完成：${code || movie.title}`, `来源：${fc2ArticleId(code) ? 'FC2' : 'JavBus'}\n候选结果：${candidates.length}`)
      return candidates
    } catch (error) {
      database.addLog('metadata', 'error', `资料搜索失败：${code || movie.title}`, error instanceof Error ? error.stack ?? error.message : String(error))
      throw error
    }
  })
  ipcMain.handle('metadata:apply', async (_event, movieId: string, providerId: string, mode: 'fill' | 'preserve' | 'overwrite') => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    try {
      const cachedSession = metadataLookupSessions.get(movieId)
      const provider = cachedSession && cachedSession.expiresAt > Date.now()
        ? cachedSession.provider
        : providerId.startsWith('fc2:') ? createFc2Provider() : createProvider()
      if (providerId.startsWith('fc2:')) {
        const details = await provider.getDetails(providerId)
        const coverPath = await cacheCoverForMovie(provider, movie, details.coverUrl)
        const updated = database.applyMetadata(movieId, details, coverPath, mode, 'fc2')
        await persistMovieSidecar(updated)
        metadataLookupSessions.delete(movieId)
        database.addLog('metadata', 'info', `资料已保存：${updated.normalizedCode ?? updated.code ?? updated.title}`, `来源：FC2\n封面：${coverPath ?? '无'}\n模式：${mode}`)
        return updated
      }
      const details = provider instanceof JavBusProvider
        ? await provider.getDetails(providerId, movie.sourcePartition === 'uncensored' ? 'uncensored' : 'censored')
        : await provider.getDetails(providerId)
      const coverPath = await cacheCoverForMovie(provider, movie, details.coverUrl)
      const updated = database.applyMetadata(movieId, details, coverPath, mode)
      await persistMovieSidecar(updated)
      metadataLookupSessions.delete(movieId)
      database.addLog('metadata', 'info', `资料已保存：${updated.normalizedCode ?? updated.code ?? updated.title}`, `来源：JavBus\n封面：${coverPath ?? '无'}\n模式：${mode}`)
      return updated
    } catch (error) {
      database.addLog('metadata', 'error', `资料确认失败：${movie.normalizedCode ?? movie.code ?? movie.title}`, error instanceof Error ? error.stack ?? error.message : String(error))
      throw error
    }
  })
  ipcMain.handle('metadata:batch-fetch', async (event, libraryId: string): Promise<MetadataBatchProgress> => {
    if (metadataBatchRunning) throw new Error('已有批量爬取任务正在进行')
    const movies = database.listMovies().filter((movie) => needsMetadataLookup(movie) && Boolean(movie.normalizedCode ?? movie.code) && movie.files.some((file) => file.libraryId === libraryId))
    const progress: MetadataBatchProgress = { libraryId, phase: 'starting', total: movies.length, completed: 0, succeeded: 0, notFound: 0, failed: 0 }
    const publish = () => event.sender.send('metadata:batch-progress', progress)
    publish()
    if (movies.length === 0) return { ...progress, phase: 'complete', message: '没有需要爬取资料的影片' }

    metadataBatchRunning = true
    const library = database.getLibrary(libraryId)
    database.addLog('metadata', 'info', `批量爬取开始：${library?.name ?? libraryId}`, `待处理：${movies.length} 部\n来源：JavBus / FC2\n间隔：每部约 5–7 秒`)
    const javBusProvider = createProvider()
    const fc2Provider = createFc2Provider()
    let consecutiveFailures = 0
    try {
      for (const movie of movies) {
        const code = movie.normalizedCode ?? movie.code ?? ''
        const isFc2 = Boolean(fc2ArticleId(code))
        progress.phase = 'processing'
        progress.currentCode = code || '未识别'
        progress.stage = 'fetching'
        progress.message = '正在获取影片资料'
        publish()
        try {
          database.addLog('metadata', 'info', `批量爬取：${code || movie.title}`, `来源：${isFc2 ? 'FC2' : 'JavBus'}\n阶段：正在获取资料`)
          const provider = isFc2 ? fc2Provider : javBusProvider
          const details = provider instanceof JavBusProvider
            ? await provider.getDetails(code, movie.sourcePartition === 'uncensored' ? 'uncensored' : 'censored')
            : await provider.getDetails(`fc2:${fc2ArticleId(code)}`)
          // Commit text metadata first. A slow or failed cover download must not
          // discard a successful JavBus/FC2 response for the movie.
          const saved = database.applyMetadata(movie.id, details, null, 'preserve', isFc2 ? 'fc2' : 'javbus')
          await persistMovieSidecar(saved)
          progress.succeeded += 1
          consecutiveFailures = 0
          database.addLog('metadata', 'info', `批量爬取成功：${code || movie.title}`, `来源：${isFc2 ? 'FC2' : 'JavBus'}\n标题：${details.title}\n封面：${details.coverUrl ? '待下载' : '无'}`)
          progress.stage = 'downloading-cover'
          progress.message = details.coverUrl ? '资料已入库，正在下载封面' : '资料已入库（该来源未提供封面）'
          publish()
          if (details.coverUrl) {
            try {
              const coverPath = await cacheCoverForMovie(provider, movie, details.coverUrl)
              if (coverPath) {
                const savedWithCover = database.applyMetadata(movie.id, details, coverPath, 'preserve', isFc2 ? 'fc2' : 'javbus')
                await persistMovieSidecar(savedWithCover)
              }
            } catch (coverError) {
              database.addLog('metadata', 'error', `封面下载失败（资料已入库）：${progress.currentCode}`, coverError instanceof Error ? coverError.stack ?? coverError.message : String(coverError))
            }
          }
        } catch (error) {
          if (error instanceof JavBusNotFoundError) {
            progress.notFound += 1
            consecutiveFailures = 0
            database.addLog('metadata', 'info', `JavBus 未收录：${progress.currentCode ?? movie.title}`, '详情页返回 404 Page Not Found，不计入请求失败。')
          } else {
            progress.failed += 1
            consecutiveFailures += 1
            database.addLog('metadata', 'error', `批量爬取失败：${progress.currentCode ?? movie.title}`, error instanceof Error ? error.stack ?? error.message : String(error))
          }
        }
        progress.completed += 1
        delete progress.stage
        delete progress.message
        publish()
        if (consecutiveFailures >= 3) {
          progress.phase = 'stopped'
          progress.message = '连续 3 次请求失败，已自动暂停以保护你的 IP'
          database.addLog('metadata', 'error', `批量爬取已暂停：${library?.name ?? libraryId}`, `连续失败：${consecutiveFailures} 次\n已完成：${progress.completed}/${progress.total}\n成功：${progress.succeeded}\n未收录：${progress.notFound}\n失败：${progress.failed}`)
          publish()
          return { ...progress }
        }
        if (progress.completed < progress.total) await delay(METADATA_BATCH_DELAY_MS + Math.floor(Math.random() * 2_000))
      }
      progress.phase = 'complete'
      progress.message = `完成：成功 ${progress.succeeded} 部，未收录 ${progress.notFound} 部，失败 ${progress.failed} 部`
      database.addLog('metadata', 'info', `批量爬取完成：${library?.name ?? libraryId}`, `总数：${progress.total}\n成功：${progress.succeeded}\n未收录：${progress.notFound}\n失败：${progress.failed}`)
      publish()
      return { ...progress }
    } finally {
      metadataBatchRunning = false
    }
  })
  ipcMain.handle('metadata:export-local-json', async (_event, libraryId: string) => {
    if (!database.getLibrary(libraryId)) throw new Error('媒体目录不存在')
    return exportLocalJsonForLibrary(libraryId)
  })
  ipcMain.handle('actor:get-profile', (_event, name: string) => database.getActorProfile(name))
  ipcMain.handle('actor:set-avatar-data', async (_event, name: string, dataUrl: string) => {
    if (!name.trim()) throw new Error('演员姓名不能为空')
    const match = /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i.exec(dataUrl)
    if (!match) throw new Error('请选择有效的图片文件')
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) throw new Error('图片大小需要在 20 MB 以内')
    const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
    const target = manualActorAvatarPath(name, extension)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    return database.setActorAvatar(name, target)
  })
  ipcMain.handle('actor:remove-avatar', async (_event, name: string) => {
    const current = database.getActorAvatarPath(name)
    const profile = database.removeActorAvatar(name)
    if (current) await rm(current, { force: true }).catch(() => undefined)
    return profile
  })
  ipcMain.handle('actor:fetch-avatar', async (_event, name: string) => {
    if (!name.trim()) throw new Error('演员姓名不能为空')
    const existing = database.getActorProfile(name)
    const provider = new GfriendsActorProvider(join(app.getPath('userData'), 'actors'))
    const avatarPath = await provider.cacheActorAvatar(name, existing?.aliases ?? [])
    if (!avatarPath) throw new Error('Gfriends 未找到该演员的头像')
    return database.setActorAvatar(name, avatarPath, false)
  })
  ipcMain.handle('actor:update-profile', (_event, name: string, patch: ActorProfilePatch) => {
    if (!name.trim()) throw new Error('演员姓名不能为空')
    const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
    const socialLinks = Array.isArray(patch.socialLinks) ? patch.socialLinks.flatMap((link) => {
      const platform = text(link?.platform); const url = text(link?.url)
      return platform && url && /^https?:\/\//i.test(url) ? [{ platform, url }] : []
    }).slice(0, 20) : []
    return database.updateActorProfile(name, {
      category: text(patch.category), aliases: Array.isArray(patch.aliases) ? [...new Set(patch.aliases.map(text).filter((value): value is string => Boolean(value)))].slice(0, 30) : [],
      birthday: text(patch.birthday), bust: integer(patch.bust), waist: integer(patch.waist), hip: integer(patch.hip), height: integer(patch.height), debutYear: integer(patch.debutYear), socialLinks
    })
  })
  ipcMain.handle('actor:lookup-profile', async (_event, name: string) => {
    if (!name.trim()) throw new Error('演员姓名不能为空')
    const existing = database.getActorProfile(name)
    const provider = new DeepSeekActorProvider(database.getSetting('deepSeekApiKey') ?? '', (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init))
    try {
      const sources = await searchActorPublicSources(name, (url, init) => net.fetch(url, init))
      const result = await provider.getActorDetails(name, existing?.aliases ?? [], sources)
      database.recordAiUsage('deepseek-v4-flash', result.usage.promptTokens, result.usage.completionTokens, result.usage.totalTokens, true)
      database.addLog('ai', 'info', `AI 演员资料返回：${name}`, `联网来源：\n${sources.map((source) => `${source.title}\n${source.url}`).join('\n\n')}\n\n请求：\n${result.request}\n\n原始返回：\n${result.response}`)
      return database.upsertActorProfile(result.details, null)
    } catch (error) {
      database.recordAiUsage('deepseek-v4-flash', 0, 0, 0, false)
      database.addLog('ai', 'error', `AI 演员资料失败：${name}`, error instanceof Error ? error.stack ?? error.message : String(error))
      throw error
    }
  })

  ipcMain.handle('player:play', (_event, movieId: string, fileId?: string) => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    const available = movie.files.filter((file) => file.available)
    const file = fileId
      ? available.find((candidate) => candidate.id === fileId)
      : available.find((candidate) => !/HEVC/.test(candidate.versionLabel ?? '')) ?? available[0]
    if (!file) throw new Error('没有可播放的本地文件')
    potPlayer.play(file.path)
    return {}
  })
  ipcMain.handle('file:reveal', (_event, fileId: string) => {
    const file = database.getFile(fileId)
    if (!file) throw new Error('影片文件不存在')
    shell.showItemInFolder(file.path)
  })
  ipcMain.handle('file:remove-missing', (_event, fileId: string) => database.removeMissingFile(fileId))
  ipcMain.handle('movie:show-context-menu', (event, movieId: string) => {
    const movie = database.getMovie(movieId)
    if (!movie) throw new Error('影片不存在')
    const file = movie.files.find((candidate) => candidate.available) ?? movie.files[0]
    Menu.buildFromTemplate([
      {
        label: '在资源管理器中显示',
        enabled: Boolean(file?.available),
        click: () => { if (file?.available) shell.showItemInFolder(file.path) }
      }
    ]).popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined })
  })
  ipcMain.handle('player:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 PotPlayer',
      properties: ['openFile'],
      filters: [{ name: 'PotPlayer', extensions: ['exe'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    potPlayer.setPath(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('transcode:start', (_event, fileId: string, kind: TranscodeKind) => {
    const file = database.getFile(fileId)
    if (!file?.available) throw new Error('影片文件不可用')
    if (transcodeTasks.some((task) => task.fileId === fileId && task.kind === kind && ['queued', 'running'].includes(task.state))) throw new Error('该转码任务已在队列中')
    const task: TranscodeProgress = { fileId, kind, state: 'queued', percent: 0, speed: null, etaSeconds: null, createdAt: new Date().toISOString(), queueOrder: ++ffmpegTaskSequence }
    transcodeTasks.push(task)
    publishTranscode(task)
    void processFfmpegQueue()
  })
  ipcMain.handle('transcode:cancel', (_event, fileId: string, kind: TranscodeKind) => {
    const task = transcodeTasks.find((item) => item.fileId === fileId && item.kind === kind)
    if (!task) throw new Error('任务不存在')
    if (task.state === 'queued') { task.state = 'cancelled'; task.message = '已取消'; publishTranscode(task); return }
    if (task.state !== 'running' || activeQueuedTask?.source !== 'media' || activeQueuedTask.id !== `${fileId}:${kind}`) throw new Error('该任务当前未在执行')
    ffmpeg.cancel()
  })
  ipcMain.handle('transcode:list', () => transcodeTasks.map((task) => ({ ...task })))
  ipcMain.handle('transcode:remove', (_event, fileId: string, kind: TranscodeKind) => {
    const index = transcodeTasks.findIndex((task) => task.fileId === fileId && task.kind === kind && task.state !== 'running')
    if (index < 0) throw new Error('只能移除等待中或已结束的任务')
    transcodeTasks.splice(index, 1)
  })
  ipcMain.handle('transcode:replace-original', async (_event, originalFileId: string, hevcFileId: string) => {
    const original = database.getFile(originalFileId)
    const hevc = database.getFile(hevcFileId)
    if (!original || !hevc || original.movieId !== hevc.movieId || !/HEVC 原分辨率/.test(hevc.versionLabel ?? '')) throw new Error('请选择同一影片的高清 HEVC 版本')
    const info = await stat(hevc.path)
    const mediaInfo = await ffmpeg.analyze(hevc.path)
    if (!mediaInfo?.videoCodec || !mediaInfo.durationSeconds) throw new Error('HEVC 文件校验失败，无法替换原片')
    await rm(original.path, { force: false })
    database.replaceOriginalWithHevc(originalFileId, hevcFileId, {
      path: hevc.path, name: basename(hevc.path), extension: extname(hevc.path).slice(1).toLowerCase(), size: info.size, mtimeMs: info.mtimeMs, mediaInfo
    })
  })
  ipcMain.handle('tool:choose-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择视频文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '视频', extensions: [...TOOL_VIDEO_EXTENSIONS].map((extension) => extension.slice(1)) }] })
    return result.canceled ? [] : inspectToolFiles(result.filePaths)
  })
  ipcMain.handle('tool:inspect-files', (_event, paths: string[]) => inspectToolFiles(Array.isArray(paths) ? paths.slice(0, 100) : []))
  ipcMain.handle('tool:start-merge', async (_event, paths: string[], outputName: string, mode: 'copy' | 'transcode', options: ToolEncodeOptions) => {
    const files = await inspectToolFiles(Array.isArray(paths) ? paths : [])
    if (files.length < 2 || !['copy', 'transcode'].includes(mode) || !outputName.trim()) throw new Error('合并参数无效')
    const task: ToolTask = { id: randomUUID(), type: mode === 'copy' ? 'merge-copy' : 'merge-transcode', inputPaths: files.map((file) => file.path), outputName: outputName.trim(), options: validToolOptions(options), state: 'queued', percent: 0, speed: null, etaSeconds: null, createdAt: new Date().toISOString(), queueOrder: ++ffmpegTaskSequence }
    toolTasks.push(task); publishToolTask(task); void processFfmpegQueue()
  })
  ipcMain.handle('tool:start-transcode', async (_event, paths: string[], options: ToolEncodeOptions) => {
    const files = await inspectToolFiles(Array.isArray(paths) ? paths : [])
    if (files.length === 0) throw new Error('没有可转码的视频文件')
    const validOptions = validToolOptions(options)
    for (const file of files) {
      const suffix = `${validOptions.codec === 'hevc' ? 'H265' : 'H264'}${validOptions.height ? ` ${validOptions.height}p` : ' 原分辨率'} CQ${validOptions.cq}`
      const task: ToolTask = { id: randomUUID(), type: 'transcode', inputPaths: [file.path], outputName: `${basename(file.path, extname(file.path))} [工具 ${suffix}]`, options: validOptions, state: 'queued', percent: 0, speed: null, etaSeconds: null, createdAt: new Date().toISOString(), queueOrder: ++ffmpegTaskSequence }
      toolTasks.push(task); publishToolTask(task)
    }
    void processFfmpegQueue()
  })
  ipcMain.handle('tool:list-tasks', () => toolTasks.map((task) => ({ ...task })))
  ipcMain.handle('tool:cancel-task', (_event, id: string) => {
    const task = toolTasks.find((item) => item.id === id)
    if (!task) throw new Error('任务不存在')
    if (task.state === 'running') {
      if (activeQueuedTask?.source !== 'tool' || activeQueuedTask.id !== id) throw new Error('该任务当前未在执行')
      ffmpeg.cancel()
    }
    else if (task.state === 'queued') { task.state = 'cancelled'; task.message = '已取消'; publishToolTask(task) }
  })
  ipcMain.handle('tool:remove-task', (_event, id: string) => {
    const index = toolTasks.findIndex((item) => item.id === id && item.state !== 'running')
    if (index < 0) throw new Error('只能移除未运行的任务')
    toolTasks.splice(index, 1)
  })
  ipcMain.handle('tool:reveal-output', (_event, path: string) => {
    const toolTask = toolTasks.find((item) => item.outputPath === path && item.state === 'completed')
    const mediaTask = transcodeTasks.find((item) => item.outputPath === path && item.state === 'completed')
    if ((!toolTask && !mediaTask) || !existsSync(path)) throw new Error('转码输出文件不存在')
    shell.showItemInFolder(path)
  })

  ipcMain.handle('pairing:create', () => lanServer.createPairing())
  ipcMain.handle('device:revoke', (_event, deviceId: string) => database.revokeDevice(deviceId))
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  database = new AppDatabase(join(app.getPath('userData'), 'avault.sqlite'))
  const legacyDataDirectory = join(app.getPath('appData'), 'avault-desktop')
  const repairedAssetPaths = database.relocateLocalAssetPaths(legacyDataDirectory, app.getPath('userData'))
  if (repairedAssetPaths > 0) console.info(`已更新 ${repairedAssetPaths} 个本地封面或演员头像路径`)
  const fc2ActorsUpdated = database.addFc2DirectorsToActors()
  if (fc2ActorsUpdated > 0) console.info(`已将 ${fc2ActorsUpdated} 部 FC2 影片的导演补入演员列表`)
  const coverMigration = await migrateStoredCovers()
  if (coverMigration.moved || coverMigration.skipped) console.info(`影片封面迁移：已移动 ${coverMigration.moved} 张，跳过 ${coverMigration.skipped} 张`)
  ffmpeg = new FfmpegService()
  await ffmpeg.detect()
  potPlayer = new PotPlayerService(database)
  scanner = new MediaScanner(database, notifyScan, (filePath) => ffmpeg.analyze(filePath))
  lanServer = new LanServer(database, () => mainWindow?.webContents.send('server:changed'))

  const smokeLibrary = process.argv.find((argument) => argument.startsWith('--smoke-library='))?.slice('--smoke-library='.length)
  if (smokeLibrary) {
    const library = database.addLibrary(smokeLibrary)
    await scanner.scan(library.id)
  }

  protocol.handle('avault-media', async (request) => {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const file = url.hostname === 'preview' ? database.getFile(id) : null
    const mediaPath = url.hostname === 'cover' ? database.getCoverPath(id) : url.hostname === 'actor' ? database.getActorAvatarPath(id) : file?.available ? ffmpeg.previewPath(file.path) : null
    if (!mediaPath) return new Response('Not found', { status: 404 })
    try {
      const bytes = await readFile(mediaPath)
      const type = mediaPath.endsWith('.png') ? 'image/png' : mediaPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
      return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'max-age=86400' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  mainWindow = createWindow()
  createTray()
  registerIpc()
  await lanServer.start()
  mainWindow.webContents.once('did-finish-load', () => {
    void (async () => {
      await Promise.all(database.listLibraries().map((library) => scanner.scan(library.id).catch(() => undefined)))
      if (database.getSetting('sourcePartitionSidecarV2Migrated') === '1') return
      const movies = database.listMovies().filter((movie) => movie.files.some((file) => file.available))
      let failed = 0
      for (const movie of movies) if (!await persistMovieSidecar(movie)) failed += 1
      database.addLog('metadata', failed ? 'error' : 'info', '片源分区 JSON v2 回填完成', `影片：${movies.length}\n失败：${failed}`)
      if (failed === 0) database.setSetting('sourcePartitionSidecarV2Migrated', '1')
    })()
  })
}

const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
  app.whenReady().then(bootstrap)
}

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => {
  void lanServer?.stop()
  database?.close()
})
app.on('window-all-closed', () => {
  // Windows keeps the process alive in the tray until the user chooses “完全退出”.
})
