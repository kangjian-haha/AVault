export type WatchStatus = 'unwatched' | 'watching' | 'watched'
export type SourcePartition = 'censored' | 'fc2' | 'uncensored' | 'leaked' | 'unknown'
export type SourcePartitionSource = 'manual' | 'local-json' | 'folder' | 'filename' | 'legacy'

export interface LibraryRecord {
  id: string
  name: string
  path: string
  lastScannedAt: string | null
  movieCount: number
  availableFileCount: number
  sourcePartition: SourcePartition | null
}

export interface MediaFileRecord {
  id: string
  movieId: string
  libraryId: string
  path: string
  name: string
  relativeDir: string
  extension: string
  size: number
  mtimeMs: number
  available: boolean
  codeRecognized: boolean
  partLabel: string | null
  versionLabel: string | null
  mediaInfo: MediaInfo | null
}

export interface MediaInfo {
  container: string | null
  videoCodec: string | null
  videoProfile: string | null
  videoEncoder: string | null
  width: number | null
  height: number | null
  frameRate: number | null
  videoBitrate: number | null
  pixelFormat: string | null
  hdr: boolean
  audioCodec: string | null
  audioBitrate: number | null
  audioChannels: number | null
  durationSeconds: number | null
}

export interface FfmpegStatus {
  available: boolean
  nvencAvailable: boolean
  ffmpegPath: string | null
  ffprobePath: string | null
  version: string | null
  message: string | null
}

export type TranscodeKind = 'hevc' | 'hevc-720p'
export interface TranscodeProgress {
  fileId: string
  kind: TranscodeKind
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  percent: number | null
  speed: string | null
  etaSeconds: number | null
  createdAt?: string
  queueOrder?: number
  outputPath?: string
  message?: string
}

export type ToolVideoCodec = 'h264' | 'hevc'
export interface ToolEncodeOptions {
  codec: ToolVideoCodec
  height: number | null
  frameRate: string | null
  cq: number
  maxBitrateKbps: number | null
}
export interface ToolFile {
  path: string
  name: string
  size: number
  mediaInfo: MediaInfo | null
}
export interface ToolTask {
  id: string
  type: 'merge-copy' | 'merge-transcode' | 'transcode' | 'cut-copy' | 'cut-transcode'
  inputPaths: string[]
  outputName: string
  options: ToolEncodeOptions | null
  cutStartSeconds?: number
  cutEndSeconds?: number
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  percent: number | null
  speed: string | null
  etaSeconds: number | null
  createdAt?: string
  queueOrder?: number
  outputPath?: string
  message?: string
}

export interface AppLogEntry {
  id: string
  createdAt: string
  scope: 'ai' | 'ffmpeg' | 'metadata'
  level: 'info' | 'error'
  message: string
  details: string | null
}

export interface AiUsageStats {
  requests: number
  successfulRequests: number
  failedRequests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedUsd: number
}

export interface MovieRecord {
  id: string
  code: string | null
  normalizedCode: string | null
  title: string
  description: string
  releaseDate: string | null
  durationMinutes: number | null
  director: string | null
  studio: string | null
  label: string | null
  series: string | null
  coverUrl: string | null
  metadataSource: string | null
  metadataUpdatedAt: string | null
  sourcePartition: SourcePartition
  sourcePartitionSource: SourcePartitionSource
  actors: string[]
  tags: string[]
  manualFields: string[]
  watchStatus: WatchStatus
  progressSeconds: number
  durationSeconds: number
  createdAt: string
  updatedAt: string
  files: MediaFileRecord[]
}

export interface PairedDevice {
  id: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
  revoked: boolean
}

export interface ServerStatus {
  running: boolean
  serverId: string
  host: string | null
  port: number | null
  addresses: string[]
  error: string | null
}

export interface AppSettings {
  potPlayerPath: string | null
  javBusBaseUrl: string
  fc2CookieConfigured: boolean
  fc2Cookie: string
  deepSeekApiKeyConfigured: boolean
  deepSeekApiKey: string
  homePreferences: HomePreferences
  ffmpeg: FfmpegStatus
}

export interface HomePreferences {
  sort: 'added-desc' | 'added-asc' | 'release-desc' | 'release-asc' | 'code-asc' | 'title-asc'
  watchFilter: 'all' | WatchStatus
  view: 'grid' | 'list'
  gridCoverMode: 'landscape' | 'portrait'
}

export interface AppSnapshot {
  libraries: LibraryRecord[]
  movies: MovieRecord[]
  devices: PairedDevice[]
  server: ServerStatus
  settings: AppSettings
}

export interface ScanProgress {
  libraryId: string
  phase: 'starting' | 'scanning' | 'complete' | 'error'
  discovered: number
  recognized: number
  unrecognized: number
  errors: number
  currentPath?: string
  message?: string
}

export interface OrganizePreviewItem { fileId: string; sourceRelativePath: string; targetRelativePath: string | null; action: 'move' | 'skip'; reason?: string }
export interface OrganizePreview { libraryId: string; directories: string[]; cleanupDirectories: string[]; items: OrganizePreviewItem[]; movable: number; skipped: number; unrecognized: number }
export interface OrganizeProgress { libraryId: string; total: number; completed: number; moved: number; skipped: number; currentPath?: string; phase: 'moving' | 'complete' | 'cancelled' }

export interface MetadataCandidate {
  providerId: string
  code: string
  title: string
  coverUrl: string | null
  previewDataUrl?: string | null
  releaseDate: string | null
}

export interface MetadataDetails extends MetadataCandidate {
  description: string
  durationMinutes: number | null
  director: string | null
  studio: string | null
  label: string | null
  series: string | null
  actors: string[]
  tags: string[]
}

export interface ActorMetadataDetails {
  name: string
  providerId: string
  avatarUrl: string | null
  category: string | null
  providerMovieCount: number | null
  whosId?: string | null
  aliases?: string[]
  birthday?: string | null
  bust?: number | null
  waist?: number | null
  hip?: number | null
  height?: number | null
  debutYear?: number | null
  socialLinks?: ActorSocialLink[]
  metadataSource?: string
}

export interface ActorSocialLink {
  platform: string
  url: string
}

export interface ActorProfile {
  name: string
  providerId: string
  avatarUrl: string | null
  category: string | null
  providerMovieCount: number | null
  whosId: string | null
  aliases: string[]
  birthday: string | null
  bust: number | null
  waist: number | null
  hip: number | null
  height: number | null
  debutYear: number | null
  socialLinks: ActorSocialLink[]
  metadataSource: string
  metadataUpdatedAt: string
}

export interface ActorProfilePatch {
  category: string | null
  aliases: string[]
  birthday: string | null
  bust: number | null
  waist: number | null
  hip: number | null
  height: number | null
  debutYear: number | null
  socialLinks: ActorSocialLink[]
}

export interface MoviePatch {
  code?: string | null
  title?: string
  description?: string
  releaseDate?: string | null
  durationMinutes?: number | null
  director?: string | null
  studio?: string | null
  label?: string | null
  series?: string | null
  actors?: string[]
  tags?: string[]
  watchStatus?: WatchStatus
  sourcePartition?: SourcePartition
}

export interface PairingPayload {
  version: 1
  serverId: string
  host: string
  port: number
  nonce: string
  expiresAt: string
}

export interface PairingDisplay {
  qrDataUrl: string
  payload: PairingPayload
}

export interface MetadataBatchProgress {
  libraryId: string
  phase: 'starting' | 'processing' | 'complete' | 'stopped'
  total: number
  completed: number
  succeeded: number
  notFound: number
  failed: number
  currentCode?: string
  stage?: 'fetching' | 'downloading-cover'
  message?: string
}

export interface LocalJsonExportResult {
  libraryId: string
  total: number
  exported: number
  failed: number
  errors: string[]
}

export interface BackupManifestAsset {
  relativePath: string
  size: number
  sha256: string
}

export interface BackupManifest {
  formatVersion: number
  kind: 'avault-backup'
  createdAt: string
  completedAt: string
  appVersion: string
  isSafetySnapshot: boolean
  database: { path: string; size: number; sha256: string }
  libraries: Array<{ id: string; name: string; rootPath: string; archiveName: string; availableAtBackup: boolean; assets: BackupManifestAsset[] }>
}

export interface BackupRecord {
  id: string
  directory: string
  status: 'completed' | 'incomplete' | 'invalid'
  createdAt: string | null
  completedAt: string | null
  size: number
  appVersion: string | null
  libraryCount: number
  companionFileCount: number
  isSafetySnapshot: boolean
}

export interface BackupProgress {
  phase: 'database' | 'assets' | 'companions' | 'verifying' | 'restoring' | 'complete' | 'cancelled' | 'error'
  message: string
  copiedFiles: number
  copiedBytes: number
  totalFiles: number | null
  cancellable: boolean
}

export interface BackupRestoreReport {
  backupId: string
  restoredAt: string
  safetySnapshotDirectory: string | null
  restoredCompanionFiles: number
  skippedCompanionFiles: number
  missingLibraryRoots: string[]
  skippedReasons: string[]
}

export interface BackupState {
  directory: string
  records: BackupRecord[]
}

export interface DesktopApi {
  getSnapshot: () => Promise<AppSnapshot>
  addLibrary: () => Promise<LibraryRecord | null>
  scanLibrary: (libraryId: string) => Promise<ScanProgress>
  previewOrganizeLibrary: (libraryId: string) => Promise<OrganizePreview>
  organizeLibrary: (libraryId: string) => Promise<void>
  cancelOrganizeLibrary: () => Promise<void>
  removeLibrary: (libraryId: string) => Promise<void>
  updateMovie: (movieId: string, patch: MoviePatch) => Promise<MovieRecord>
  parseJavDbHtml: (html: string) => Promise<MetadataDetails>
  saveJavDbHtmlImport: (movieId: string, patch: MoviePatch) => Promise<MovieRecord>
  chooseCover: (movieId: string) => Promise<MovieRecord | null>
  pasteCover: (movieId: string) => Promise<MovieRecord>
  setCoverData: (movieId: string, dataUrl: string) => Promise<MovieRecord>
  removeCover: (movieId: string) => Promise<MovieRecord>
  getMoviePreview: (movieId: string) => Promise<string | null>
  generateMoviePreview: (movieId: string) => Promise<string | null>
  deleteMoviePreview: (movieId: string) => Promise<void>
  lookupMetadata: (movieId: string) => Promise<MetadataCandidate[]>
  applyMetadata: (movieId: string, providerId: string, mode: 'fill' | 'preserve' | 'overwrite') => Promise<MovieRecord>
  batchFetchMetadata: (libraryId: string) => Promise<MetadataBatchProgress>
  exportLocalJson: (libraryId: string) => Promise<LocalJsonExportResult>
  getBackupState: () => Promise<BackupState>
  chooseBackupDirectory: () => Promise<string | null>
  createBackup: () => Promise<BackupRecord>
  cancelBackup: () => Promise<void>
  revealBackupDirectory: () => Promise<void>
  restoreBackup: (directory: string) => Promise<void>
  getLastRestoreReport: () => Promise<BackupRestoreReport | null>
  clearLastRestoreReport: () => Promise<void>
  onBackupProgress: (listener: (progress: BackupProgress) => void) => () => void
  getActorProfile: (name: string) => Promise<ActorProfile | null>
  fetchActorAvatar: (name: string) => Promise<ActorProfile>
  lookupActorProfile: (name: string) => Promise<ActorProfile>
  updateActorProfile: (name: string, patch: ActorProfilePatch) => Promise<ActorProfile>
  setActorAvatarData: (name: string, dataUrl: string) => Promise<ActorProfile>
  removeActorAvatar: (name: string) => Promise<ActorProfile | null>
  playMovie: (movieId: string, fileId?: string) => Promise<{ needsFileChoice?: MediaFileRecord[] }>
  revealFile: (fileId: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  removeMissingFile: (fileId: string) => Promise<void>
  showMovieContextMenu: (movieId: string) => Promise<void>
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void
  setFc2Cookie: (cookieHeader: string) => Promise<void>
  setDeepSeekApiKey: (apiKey: string) => Promise<void>
  setHomePreferences: (preferences: HomePreferences) => Promise<void>
  setLibrarySourcePartition: (libraryId: string, partition: SourcePartition | null) => Promise<{ updated: number; sidecarFailed: number }>
  getAiUsageStats: () => Promise<AiUsageStats>
  getLogs: (scope?: AppLogEntry['scope']) => Promise<AppLogEntry[]>
  clearLogs: (scope?: AppLogEntry['scope']) => Promise<void>
  startTranscode: (fileId: string, kind: TranscodeKind) => Promise<void>
  cancelTranscode: (fileId: string, kind: TranscodeKind) => Promise<void>
  getTranscodeTasks: () => Promise<TranscodeProgress[]>
  removeTranscodeTask: (fileId: string, kind: TranscodeKind) => Promise<void>
  replaceOriginalWithHevc: (originalFileId: string, hevcFileId: string) => Promise<void>
  chooseToolFiles: () => Promise<ToolFile[]>
  getDroppedFilePath: (file: File) => string
  inspectToolFiles: (paths: string[]) => Promise<ToolFile[]>
  startToolMerge: (paths: string[], outputName: string, mode: 'copy' | 'transcode', options: ToolEncodeOptions) => Promise<void>
  startToolTranscode: (paths: string[], options: ToolEncodeOptions) => Promise<void>
  startToolCut: (path: string, startSeconds: number, endSeconds: number, mode: 'copy' | 'transcode', options: ToolEncodeOptions | null) => Promise<void>
  getToolTasks: () => Promise<ToolTask[]>
  cancelToolTask: (taskId: string) => Promise<void>
  removeToolTask: (taskId: string) => Promise<void>
  revealToolOutput: (path: string) => Promise<void>
  onToolTaskProgress: (listener: (task: ToolTask) => void) => () => void
  choosePotPlayer: () => Promise<string | null>
  createPairing: () => Promise<PairingDisplay>
  revokeDevice: (deviceId: string) => Promise<void>
  onScanProgress: (listener: (progress: ScanProgress) => void) => () => void
  onOrganizeProgress: (listener: (progress: OrganizeProgress) => void) => () => void
  onMetadataBatchProgress: (listener: (progress: MetadataBatchProgress) => void) => () => void
  onTranscodeProgress: (listener: (progress: TranscodeProgress) => void) => () => void
}

declare global {
  interface Window {
    avault: DesktopApi
  }
}
