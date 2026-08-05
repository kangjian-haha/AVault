import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, MetadataBatchProgress, MoviePatch, ScanProgress } from '../shared/contracts'

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('app:snapshot'),
  addLibrary: () => ipcRenderer.invoke('library:add'),
  scanLibrary: (libraryId) => ipcRenderer.invoke('library:scan', libraryId),
  previewOrganizeLibrary: (libraryId) => ipcRenderer.invoke('library:organize-preview', libraryId),
  organizeLibrary: (libraryId) => ipcRenderer.invoke('library:organize', libraryId),
  cancelOrganizeLibrary: () => ipcRenderer.invoke('library:organize-cancel'),
  removeLibrary: (libraryId) => ipcRenderer.invoke('library:remove', libraryId),
  setLibrarySourcePartition: (libraryId, partition) => ipcRenderer.invoke('library:set-source-partition', libraryId, partition),
  updateMovie: (movieId, patch: MoviePatch) => ipcRenderer.invoke('movie:update', movieId, patch),
  parseJavDbHtml: (html) => ipcRenderer.invoke('metadata:parse-javdb-html', html),
  saveJavDbHtmlImport: (movieId, patch) => ipcRenderer.invoke('movie:save-javdb-html-import', movieId, patch),
  chooseCover: (movieId) => ipcRenderer.invoke('movie:choose-cover', movieId),
  pasteCover: (movieId) => ipcRenderer.invoke('movie:paste-cover', movieId),
  setCoverData: (movieId, dataUrl) => ipcRenderer.invoke('movie:set-cover-data', movieId, dataUrl),
  removeCover: (movieId) => ipcRenderer.invoke('movie:remove-cover', movieId),
  getMoviePreview: (movieId) => ipcRenderer.invoke('movie:get-preview', movieId),
  generateMoviePreview: (movieId) => ipcRenderer.invoke('movie:generate-preview', movieId),
  deleteMoviePreview: (movieId) => ipcRenderer.invoke('movie:delete-preview', movieId),
  lookupMetadata: (movieId) => ipcRenderer.invoke('metadata:lookup', movieId),
  applyMetadata: (movieId, providerId, mode) => ipcRenderer.invoke('metadata:apply', movieId, providerId, mode),
  batchFetchMetadata: (libraryId) => ipcRenderer.invoke('metadata:batch-fetch', libraryId),
  exportLocalJson: (libraryId) => ipcRenderer.invoke('metadata:export-local-json', libraryId),
  getActorProfile: (name) => ipcRenderer.invoke('actor:get-profile', name),
  fetchActorAvatar: (name) => ipcRenderer.invoke('actor:fetch-avatar', name),
  lookupActorProfile: (name) => ipcRenderer.invoke('actor:lookup-profile', name),
  updateActorProfile: (name, patch) => ipcRenderer.invoke('actor:update-profile', name, patch),
  setActorAvatarData: (name, dataUrl) => ipcRenderer.invoke('actor:set-avatar-data', name, dataUrl),
  removeActorAvatar: (name) => ipcRenderer.invoke('actor:remove-avatar', name),
  playMovie: (movieId, fileId) => ipcRenderer.invoke('player:play', movieId, fileId),
  revealFile: (fileId) => ipcRenderer.invoke('file:reveal', fileId),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  removeMissingFile: (fileId) => ipcRenderer.invoke('file:remove-missing', fileId),
  showMovieContextMenu: (movieId) => ipcRenderer.invoke('movie:show-context-menu', movieId),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setFc2Cookie: (cookieHeader) => ipcRenderer.invoke('fc2:set-cookie', cookieHeader),
  setDeepSeekApiKey: (apiKey) => ipcRenderer.invoke('deepseek:set-api-key', apiKey),
  setHomePreferences: (preferences) => ipcRenderer.invoke('preferences:set-home', preferences),
  getAiUsageStats: () => ipcRenderer.invoke('ai:usage-stats'),
  getLogs: (scope) => ipcRenderer.invoke('logs:list', scope),
  clearLogs: (scope) => ipcRenderer.invoke('logs:clear', scope),
  startTranscode: (fileId, kind) => ipcRenderer.invoke('transcode:start', fileId, kind),
  cancelTranscode: (fileId, kind) => ipcRenderer.invoke('transcode:cancel', fileId, kind),
  getTranscodeTasks: () => ipcRenderer.invoke('transcode:list'),
  removeTranscodeTask: (fileId, kind) => ipcRenderer.invoke('transcode:remove', fileId, kind),
  replaceOriginalWithHevc: (originalFileId, hevcFileId) => ipcRenderer.invoke('transcode:replace-original', originalFileId, hevcFileId),
  chooseToolFiles: () => ipcRenderer.invoke('tool:choose-files'),
  inspectToolFiles: (paths) => ipcRenderer.invoke('tool:inspect-files', paths),
  startToolMerge: (paths, outputName, mode, options) => ipcRenderer.invoke('tool:start-merge', paths, outputName, mode, options),
  startToolTranscode: (paths, options) => ipcRenderer.invoke('tool:start-transcode', paths, options),
  getToolTasks: () => ipcRenderer.invoke('tool:list-tasks'),
  cancelToolTask: (taskId) => ipcRenderer.invoke('tool:cancel-task', taskId),
  removeToolTask: (taskId) => ipcRenderer.invoke('tool:remove-task', taskId),
  revealToolOutput: (path) => ipcRenderer.invoke('tool:reveal-output', path),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  choosePotPlayer: () => ipcRenderer.invoke('player:choose'),
  createPairing: () => ipcRenderer.invoke('pairing:create'),
  revokeDevice: (deviceId) => ipcRenderer.invoke('device:revoke', deviceId),
  onScanProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => listener(progress)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  onOrganizeProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: import('../shared/contracts').OrganizeProgress) => listener(progress)
    ipcRenderer.on('organize:progress', handler)
    return () => ipcRenderer.removeListener('organize:progress', handler)
  },
  onMetadataBatchProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: MetadataBatchProgress) => listener(progress)
    ipcRenderer.on('metadata:batch-progress', handler)
    return () => ipcRenderer.removeListener('metadata:batch-progress', handler)
  }
  , onTranscodeProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: import('../shared/contracts').TranscodeProgress) => listener(progress)
    ipcRenderer.on('transcode:progress', handler)
    return () => ipcRenderer.removeListener('transcode:progress', handler)
  }
  , onToolTaskProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, task: import('../shared/contracts').ToolTask) => listener(task)
    ipcRenderer.on('tool:task-progress', handler)
    return () => ipcRenderer.removeListener('tool:task-progress', handler)
  }
}

contextBridge.exposeInMainWorld('avault', api)
