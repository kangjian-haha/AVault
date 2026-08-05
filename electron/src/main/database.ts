import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type {
  ActorMetadataDetails,
  ActorProfile,
  ActorProfilePatch,
  ActorSocialLink,
  AppLogEntry,
  AiUsageStats,
  AppSettings,
  LibraryRecord,
  MediaInfo,
  MediaFileRecord,
  MetadataDetails,
  MoviePatch,
  SourcePartition,
  SourcePartitionSource,
  MovieRecord,
  PairedDevice,
  WatchStatus
} from '../shared/contracts'
import { schema } from './schema'

type Row = Record<string, unknown>

function now(): string {
  return new Date().toISOString()
}

function jsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function jsonSocialLinks(value: unknown): ActorSocialLink[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Record<string, unknown>
      const platform = typeof candidate.platform === 'string' ? candidate.platform.trim() : ''
      const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
      if (!platform || !/^https?:\/\//i.test(url) || seen.has(url)) return []
      seen.add(url)
      return [{ platform, url }]
    })
  } catch { return [] }
}

function bool(value: unknown): boolean {
  return value === 1 || value === true
}

const PARTITIONS = new Set<SourcePartition>(['censored', 'fc2', 'uncensored', 'leaked', 'unknown'])
const PARTITION_SOURCES = new Set<SourcePartitionSource>(['manual', 'local-json', 'folder', 'filename', 'legacy'])
function sourcePartition(value: unknown): SourcePartition { return typeof value === 'string' && PARTITIONS.has(value as SourcePartition) ? value as SourcePartition : 'unknown' }
function sourcePartitionSource(value: unknown): SourcePartitionSource { return typeof value === 'string' && PARTITION_SOURCES.has(value as SourcePartitionSource) ? value as SourcePartitionSource : 'legacy' }

function parseMediaInfo(value: unknown): MediaInfo | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as Partial<MediaInfo>
    return typeof parsed === 'object' && parsed ? {
      container: typeof parsed.container === 'string' ? parsed.container : null,
      videoCodec: typeof parsed.videoCodec === 'string' ? parsed.videoCodec : null,
      videoProfile: typeof parsed.videoProfile === 'string' ? parsed.videoProfile : null,
      videoEncoder: typeof parsed.videoEncoder === 'string' ? parsed.videoEncoder : null,
      width: typeof parsed.width === 'number' ? parsed.width : null,
      height: typeof parsed.height === 'number' ? parsed.height : null,
      frameRate: typeof parsed.frameRate === 'number' ? parsed.frameRate : null,
      videoBitrate: typeof parsed.videoBitrate === 'number' ? parsed.videoBitrate : null,
      pixelFormat: typeof parsed.pixelFormat === 'string' ? parsed.pixelFormat : null,
      hdr: Boolean(parsed.hdr), audioCodec: typeof parsed.audioCodec === 'string' ? parsed.audioCodec : null,
      audioBitrate: typeof parsed.audioBitrate === 'number' ? parsed.audioBitrate : null,
      audioChannels: typeof parsed.audioChannels === 'number' ? parsed.audioChannels : null,
      durationSeconds: typeof parsed.durationSeconds === 'number' ? parsed.durationSeconds : null
    } : null
  } catch { return null }
}

export class AppDatabase {
  readonly sqlite: BetterSqlite3.Database
  readonly orm: BetterSQLite3Database<typeof schema>

  constructor(filePath: string) {
    this.sqlite = new BetterSqlite3(filePath)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.orm = drizzle(this.sqlite, { schema })
    this.migrate()
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        last_scanned_at TEXT,
        media_category TEXT,
        source_partition TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        code TEXT,
        normalized_code TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        release_date TEXT,
        duration_minutes INTEGER,
        director TEXT,
        studio TEXT,
        label TEXT,
        series TEXT,
        cover_path TEXT,
        cover_source TEXT,
        metadata_source TEXT,
        metadata_updated_at TEXT,
        media_category TEXT,
        source_partition TEXT NOT NULL DEFAULT 'unknown',
        source_partition_source TEXT NOT NULL DEFAULT 'legacy',
        actors_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        manual_fields_json TEXT NOT NULL DEFAULT '[]',
        watch_status TEXT NOT NULL DEFAULT 'unwatched',
        progress_seconds INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS movies_normalized_code_unique
        ON movies(normalized_code) WHERE normalized_code IS NOT NULL;
      CREATE TABLE IF NOT EXISTS media_files (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL REFERENCES movies(id),
        library_id TEXT NOT NULL REFERENCES libraries(id),
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        relative_dir TEXT NOT NULL DEFAULT '',
        extension TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        available INTEGER NOT NULL DEFAULT 1,
        code_recognized INTEGER NOT NULL DEFAULT 1,
        part_label TEXT,
        version_label TEXT,
        media_info_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_files_movie_idx ON media_files(movie_id);
      CREATE INDEX IF NOT EXISTS media_files_library_idx ON media_files(library_id);
      CREATE TABLE IF NOT EXISTS actor_profiles (
        name TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        whos_id TEXT,
        avatar_path TEXT,
        avatar_manual INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        provider_movie_count INTEGER,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        birthday TEXT,
        bust INTEGER,
        waist INTEGER,
        hip INTEGER,
        height INTEGER,
        debut_year INTEGER,
        social_links_json TEXT NOT NULL DEFAULT '[]',
        metadata_source TEXT NOT NULL,
        metadata_updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paired_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        paired_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_logs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS app_logs_created_idx ON app_logs(created_at DESC);
      CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage(created_at DESC);
    `)
    const actorColumns = new Set((this.sqlite.prepare('PRAGMA table_info(actor_profiles)').all() as Row[]).map((row) => String(row.name)))
    const mediaFileColumns = new Set((this.sqlite.prepare('PRAGMA table_info(media_files)').all() as Row[]).map((row) => String(row.name)))
    const libraryColumns = new Set((this.sqlite.prepare('PRAGMA table_info(libraries)').all() as Row[]).map((row) => String(row.name)))
    const movieColumns = new Set((this.sqlite.prepare('PRAGMA table_info(movies)').all() as Row[]).map((row) => String(row.name)))
    if (!libraryColumns.has('media_category')) this.sqlite.exec('ALTER TABLE libraries ADD COLUMN media_category TEXT')
    if (!movieColumns.has('media_category')) this.sqlite.exec('ALTER TABLE movies ADD COLUMN media_category TEXT')
    if (!libraryColumns.has('source_partition')) this.sqlite.exec('ALTER TABLE libraries ADD COLUMN source_partition TEXT')
    if (!movieColumns.has('source_partition')) this.sqlite.exec("ALTER TABLE movies ADD COLUMN source_partition TEXT NOT NULL DEFAULT 'unknown'")
    if (!movieColumns.has('source_partition_source')) this.sqlite.exec("ALTER TABLE movies ADD COLUMN source_partition_source TEXT NOT NULL DEFAULT 'legacy'")
    this.sqlite.prepare("UPDATE libraries SET source_partition = media_category WHERE source_partition IS NULL AND media_category IN ('censored','fc2','uncensored')").run()
    this.sqlite.prepare("UPDATE movies SET source_partition = media_category, source_partition_source = 'legacy' WHERE source_partition = 'unknown' AND media_category IN ('censored','fc2','uncensored')").run()
    if (!mediaFileColumns.has('media_info_json')) this.sqlite.exec('ALTER TABLE media_files ADD COLUMN media_info_json TEXT')
    if (!mediaFileColumns.has('code_recognized')) this.sqlite.exec('ALTER TABLE media_files ADD COLUMN code_recognized INTEGER NOT NULL DEFAULT 1')
    const actorColumnMigrations = [
      ['whos_id', 'TEXT'], ['aliases_json', "TEXT NOT NULL DEFAULT '[]'"], ['birthday', 'TEXT'], ['bust', 'INTEGER'], ['waist', 'INTEGER'],
      ['hip', 'INTEGER'], ['height', 'INTEGER'], ['debut_year', 'INTEGER'], ['social_links_json', "TEXT NOT NULL DEFAULT '[]'"], ['avatar_manual', 'INTEGER NOT NULL DEFAULT 0']
    ] as const
    for (const [column, definition] of actorColumnMigrations) {
      if (!actorColumns.has(column)) this.sqlite.exec(`ALTER TABLE actor_profiles ADD COLUMN ${column} ${definition}`)
    }
    this.sqlite.prepare("DELETE FROM settings WHERE key IN ('dmmApiId', 'dmmAffiliateId')").run()
  }

  close(): void {
    this.sqlite.close()
  }

  getSetting(key: string): string | null {
    const row = this.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined
    return typeof row?.value === 'string' ? row.value : null
  }

  setSetting(key: string, value: string): void {
    this.sqlite.prepare(`
      INSERT INTO settings(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  addLog(scope: AppLogEntry['scope'], level: AppLogEntry['level'], message: string, details: string | null = null): void {
    this.sqlite.prepare('INSERT INTO app_logs(id, created_at, scope, level, message, details) VALUES(?, ?, ?, ?, ?, ?)').run(randomUUID(), now(), scope, level, message, details)
    this.sqlite.prepare('DELETE FROM app_logs WHERE id IN (SELECT id FROM app_logs ORDER BY created_at DESC LIMIT -1 OFFSET 500)').run()
  }

  listLogs(scope?: AppLogEntry['scope']): AppLogEntry[] {
    const rows = (scope
      ? this.sqlite.prepare('SELECT * FROM app_logs WHERE scope = ? ORDER BY created_at DESC LIMIT 500').all(scope)
      : this.sqlite.prepare('SELECT * FROM app_logs ORDER BY created_at DESC LIMIT 500').all()) as Row[]
    return rows.map((row) => ({ id: String(row.id), createdAt: String(row.created_at), scope: row.scope === 'ffmpeg' || row.scope === 'metadata' ? row.scope : 'ai', level: row.level === 'error' ? 'error' : 'info', message: String(row.message), details: typeof row.details === 'string' ? row.details : null }))
  }

  clearLogs(scope?: AppLogEntry['scope']): void {
    if (scope) this.sqlite.prepare('DELETE FROM app_logs WHERE scope = ?').run(scope)
    else this.sqlite.prepare('DELETE FROM app_logs').run()
  }

  recordAiUsage(model: string, promptTokens: number, completionTokens: number, totalTokens: number, success: boolean): void {
    this.sqlite.prepare('INSERT INTO ai_usage(id, created_at, model, prompt_tokens, completion_tokens, total_tokens, success) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), now(), model, Math.max(0, promptTokens), Math.max(0, completionTokens), Math.max(0, totalTokens), success ? 1 : 0)
  }

  getAiUsageStats(): AiUsageStats {
    const row = this.sqlite.prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) AS successful_requests,
      COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failed_requests, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM ai_usage`).get() as Row
    const promptTokens = Number(row.prompt_tokens) || 0
    const completionTokens = Number(row.completion_tokens) || 0
    return { requests: Number(row.requests) || 0, successfulRequests: Number(row.successful_requests) || 0, failedRequests: Number(row.failed_requests) || 0, promptTokens, completionTokens, totalTokens: Number(row.total_tokens) || 0, estimatedUsd: promptTokens / 1_000_000 * 0.14 + completionTokens / 1_000_000 * 0.28 }
  }

  getSettings(): AppSettings {
    return {
      potPlayerPath: this.getSetting('potPlayerPath'),
      javBusBaseUrl: this.getSetting('javBusBaseUrl') ?? 'https://www.javbus.com',
      fc2CookieConfigured: false,
      fc2Cookie: '',
      deepSeekApiKeyConfigured: false,
      deepSeekApiKey: '',
      homePreferences: { sort: 'added-desc', watchFilter: 'all', view: 'grid', gridCoverMode: 'landscape' },
      ffmpeg: { available: false, nvencAvailable: false, ffmpegPath: null, ffprobePath: null, version: null, message: null }
    }
  }

  getOrCreateServerId(): string {
    const existing = this.getSetting('serverId')
    if (existing) return existing
    const id = randomUUID()
    this.setSetting('serverId', id)
    return id
  }

  addLibrary(path: string): LibraryRecord {
    const existing = this.sqlite.prepare('SELECT id FROM libraries WHERE lower(path) = lower(?)').get(path) as Row | undefined
    if (typeof existing?.id === 'string') return this.getLibrary(existing.id)!
    const id = randomUUID()
    this.sqlite.prepare('INSERT INTO libraries(id, name, path, created_at) VALUES(?, ?, ?, ?)')
      .run(id, basename(path), path, now())
    return this.getLibrary(id)!
  }

  removeLibrary(id: string): void {
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM media_files WHERE library_id = ?').run(id)
      this.sqlite.prepare('DELETE FROM libraries WHERE id = ?').run(id)
      this.sqlite.prepare('DELETE FROM movies WHERE NOT EXISTS (SELECT 1 FROM media_files WHERE media_files.movie_id = movies.id)').run()
    })
    transaction()
  }

  getLibrary(id: string): LibraryRecord | null {
    const row = this.sqlite.prepare(`
      SELECT l.*,
        COUNT(DISTINCT mf.movie_id) AS movie_count,
        SUM(CASE WHEN mf.available = 1 THEN 1 ELSE 0 END) AS available_file_count
      FROM libraries l LEFT JOIN media_files mf ON mf.library_id = l.id
      WHERE l.id = ? GROUP BY l.id
    `).get(id) as Row | undefined
    return row ? this.mapLibrary(row) : null
  }

  listLibraries(): LibraryRecord[] {
    const rows = this.sqlite.prepare(`
      SELECT l.*,
        COUNT(DISTINCT mf.movie_id) AS movie_count,
        SUM(CASE WHEN mf.available = 1 THEN 1 ELSE 0 END) AS available_file_count
      FROM libraries l LEFT JOIN media_files mf ON mf.library_id = l.id
      GROUP BY l.id ORDER BY l.created_at ASC
    `).all() as Row[]
    return rows.map((row) => this.mapLibrary(row))
  }

  private mapLibrary(row: Row): LibraryRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      path: String(row.path),
      lastScannedAt: typeof row.last_scanned_at === 'string' ? row.last_scanned_at : null,
      movieCount: Number(row.movie_count ?? 0),
      availableFileCount: Number(row.available_file_count ?? 0),
      sourcePartition: typeof row.source_partition === 'string' && PARTITIONS.has(row.source_partition as SourcePartition) ? row.source_partition as SourcePartition : null
    }
  }

  beginScan(libraryId: string): void {
    this.sqlite.prepare('UPDATE media_files SET available = 0 WHERE library_id = ?').run(libraryId)
  }

  setLibrarySourcePartition(libraryId: string, partition: SourcePartition | null): MovieRecord[] {
    const library = this.getLibrary(libraryId)
    if (!library) throw new Error('媒体目录不存在')
    this.sqlite.prepare('UPDATE libraries SET source_partition = ? WHERE id = ?').run(partition, libraryId)
    if (partition) this.sqlite.prepare("UPDATE movies SET source_partition = ?, source_partition_source = 'folder', updated_at = ? WHERE source_partition_source NOT IN ('manual','local-json') AND id IN (SELECT DISTINCT movie_id FROM media_files WHERE library_id = ?)").run(partition, now(), libraryId)
    else this.sqlite.prepare("UPDATE movies SET source_partition = 'unknown', source_partition_source = 'filename', updated_at = ? WHERE source_partition_source = 'folder' AND id IN (SELECT DISTINCT movie_id FROM media_files WHERE library_id = ?)").run(now(), libraryId)
    return this.listMovies().filter((movie) => movie.files.some((file) => file.libraryId === libraryId))
  }

  getLibraryFileIndex(libraryId: string): Map<string, MediaFileRecord> {
    const rows = this.sqlite.prepare('SELECT * FROM media_files WHERE library_id = ?').all(libraryId) as Row[]
    return new Map(rows.map((row) => {
      const file = this.mapFile(row)
      return [file.path, file]
    }))
  }

  finishScan(libraryId: string): void {
    this.sqlite.prepare('UPDATE libraries SET last_scanned_at = ? WHERE id = ?').run(now(), libraryId)
  }

  upsertScannedFile(input: {
    libraryId: string
    path: string
    name: string
    relativeDir: string
    extension: string
    size: number
    mtimeMs: number
    sourcePartition: SourcePartition
    sourcePartitionSource: SourcePartitionSource
    codeRecognized: boolean
    normalizedCode: string | null
    partLabel: string | null
    versionLabel: string | null
    mediaInfo: MediaInfo | null
  }): string {
    const timestamp = now()
    const existing = this.sqlite.prepare('SELECT id, movie_id FROM media_files WHERE path = ?').get(input.path) as Row | undefined
    if (existing) {
      const previousMovieId = String(existing.movie_id)
      let movieId = previousMovieId
      const currentMovie = this.sqlite.prepare('SELECT normalized_code, manual_fields_json FROM movies WHERE id = ?').get(previousMovieId) as Row | undefined
      const codeWasManuallyEdited = jsonArray(currentMovie?.manual_fields_json).includes('code')
      if (input.normalizedCode && currentMovie?.normalized_code !== input.normalizedCode && !codeWasManuallyEdited) {
        const matchingMovie = this.sqlite.prepare('SELECT id FROM movies WHERE normalized_code = ?').get(input.normalizedCode) as Row | undefined
        movieId = typeof matchingMovie?.id === 'string' ? matchingMovie.id : this.insertMovie(input.normalizedCode, input.normalizedCode)
      }
      this.sqlite.prepare(`
        UPDATE media_files SET movie_id = ?, name = ?, relative_dir = ?, extension = ?, size = ?, mtime_ms = ?,
          available = 1, code_recognized = ?, part_label = ?, version_label = ?, media_info_json = ?, updated_at = ? WHERE id = ?
      `).run(movieId, input.name, input.relativeDir, input.extension, input.size, input.mtimeMs, input.codeRecognized ? 1 : 0, input.partLabel, input.versionLabel, input.mediaInfo ? JSON.stringify(input.mediaInfo) : null, timestamp, existing.id)
      if (movieId !== previousMovieId) {
        this.sqlite.prepare('DELETE FROM movies WHERE id = ? AND NOT EXISTS (SELECT 1 FROM media_files WHERE media_files.movie_id = movies.id)').run(previousMovieId)
      }
      const partitionRow = this.sqlite.prepare('SELECT source_partition_source FROM movies WHERE id = ?').get(movieId) as Row | undefined
      if (!['manual', 'local-json'].includes(String(partitionRow?.source_partition_source))) this.sqlite.prepare('UPDATE movies SET source_partition = ?, source_partition_source = ?, updated_at = ? WHERE id = ?').run(input.sourcePartition, input.sourcePartitionSource, timestamp, movieId)
      return movieId
    }

    let movieId: string
    if (input.normalizedCode) {
      const movie = this.sqlite.prepare('SELECT id FROM movies WHERE normalized_code = ?').get(input.normalizedCode) as Row | undefined
      movieId = typeof movie?.id === 'string' ? movie.id : this.insertMovie(input.normalizedCode, input.normalizedCode)
    } else {
      movieId = this.insertMovie(null, input.name.replace(/\.[^.]+$/, ''))
    }

    this.sqlite.prepare(`
      INSERT INTO media_files(id, movie_id, library_id, path, name, relative_dir, extension, size, mtime_ms,
        available, code_recognized, part_label, version_label, media_info_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), movieId, input.libraryId, input.path, input.name, input.relativeDir, input.extension,
      input.size, input.mtimeMs, input.codeRecognized ? 1 : 0, input.partLabel, input.versionLabel, input.mediaInfo ? JSON.stringify(input.mediaInfo) : null, timestamp, timestamp)
    this.sqlite.prepare('UPDATE movies SET source_partition = ?, source_partition_source = ? WHERE id = ?').run(input.sourcePartition, input.sourcePartitionSource, movieId)
    return movieId
  }

  private insertMovie(code: string | null, title: string): string {
    const id = randomUUID()
    const timestamp = now()
    this.sqlite.prepare(`
      INSERT INTO movies(id, code, normalized_code, title, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(id, code, code, title, timestamp, timestamp)
    return id
  }

  listMovies(): MovieRecord[] {
    const rows = this.sqlite.prepare('SELECT * FROM movies ORDER BY created_at DESC').all() as Row[]
    const files = this.sqlite.prepare('SELECT * FROM media_files ORDER BY name ASC').all() as Row[]
    const grouped = new Map<string, MediaFileRecord[]>()
    for (const row of files) {
      const file = this.mapFile(row)
      const current = grouped.get(file.movieId) ?? []
      current.push(file)
      grouped.set(file.movieId, current)
    }
    return rows.map((row) => this.mapMovie(row, grouped.get(String(row.id)) ?? []))
  }

  getMovie(id: string): MovieRecord | null {
    const row = this.sqlite.prepare('SELECT * FROM movies WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    const files = (this.sqlite.prepare('SELECT * FROM media_files WHERE movie_id = ? ORDER BY name ASC').all(id) as Row[])
      .map((file) => this.mapFile(file))
    return this.mapMovie(row, files)
  }

  private mapMovie(row: Row, files: MediaFileRecord[]): MovieRecord {
    return {
      id: String(row.id),
      code: typeof row.code === 'string' ? row.code : null,
      normalizedCode: typeof row.normalized_code === 'string' ? row.normalized_code : null,
      title: String(row.title),
      description: String(row.description ?? ''),
      releaseDate: typeof row.release_date === 'string' ? row.release_date : null,
      durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
      director: typeof row.director === 'string' ? row.director : null,
      studio: typeof row.studio === 'string' ? row.studio : null,
      label: typeof row.label === 'string' ? row.label : null,
      series: typeof row.series === 'string' ? row.series : null,
      coverUrl: row.cover_path ? `avault-media://cover/${String(row.id)}?v=${encodeURIComponent(String(row.updated_at))}` : null,
      metadataSource: typeof row.metadata_source === 'string' ? row.metadata_source : null,
      metadataUpdatedAt: typeof row.metadata_updated_at === 'string' ? row.metadata_updated_at : null,
      sourcePartition: sourcePartition(row.source_partition),
      sourcePartitionSource: sourcePartitionSource(row.source_partition_source),
      actors: jsonArray(row.actors_json),
      tags: jsonArray(row.tags_json),
      manualFields: jsonArray(row.manual_fields_json),
      watchStatus: (row.watch_status as WatchStatus) ?? 'unwatched',
      progressSeconds: Number(row.progress_seconds ?? 0),
      durationSeconds: Number(row.duration_seconds ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      files
    }
  }

  private mapFile(row: Row): MediaFileRecord {
    return {
      id: String(row.id),
      movieId: String(row.movie_id),
      libraryId: String(row.library_id),
      path: String(row.path),
      name: String(row.name),
      relativeDir: String(row.relative_dir ?? ''),
      extension: String(row.extension),
      size: Number(row.size),
      mtimeMs: Number(row.mtime_ms),
      available: bool(row.available),
      codeRecognized: bool(row.code_recognized),
      partLabel: typeof row.part_label === 'string' ? row.part_label : null,
      versionLabel: typeof row.version_label === 'string' ? row.version_label : null,
      mediaInfo: parseMediaInfo(row.media_info_json)
    }
  }

  updateMediaInfo(fileId: string, mediaInfo: MediaInfo | null): void {
    this.sqlite.prepare('UPDATE media_files SET media_info_json = ?, updated_at = ? WHERE id = ?').run(mediaInfo ? JSON.stringify(mediaInfo) : null, now(), fileId)
  }

  relocateMediaFile(fileId: string, path: string, name: string, relativeDir: string): void {
    this.sqlite.prepare('UPDATE media_files SET path = ?, name = ?, relative_dir = ?, available = 1, updated_at = ? WHERE id = ?')
      .run(path, name, relativeDir, now(), fileId)
  }

  relocateLocalAssetPaths(previousDataDirectory: string, currentDataDirectory: string): number {
    const previous = previousDataDirectory.replace(/[\\/]+$/, '')
    const current = currentDataDirectory.replace(/[\\/]+$/, '')
    if (!previous || previous.toLowerCase() === current.toLowerCase()) return 0
    const pattern = `${previous}\\%`
    const offset = previous.length + 1
    const update = (table: 'movies' | 'actor_profiles', column: 'cover_path' | 'avatar_path') => this.sqlite.prepare(`
      UPDATE ${table}
      SET ${column} = ? || substr(${column}, ?)
      WHERE lower(${column}) LIKE lower(?)
    `).run(current, offset, pattern).changes
    return this.sqlite.transaction(() => update('movies', 'cover_path') + update('actor_profiles', 'avatar_path'))()
  }

  relocateCoverPath(movieId: string, coverPath: string): void {
    this.sqlite.prepare('UPDATE movies SET cover_path = ?, updated_at = ? WHERE id = ?').run(coverPath, now(), movieId)
  }

  addFc2DirectorsToActors(): number {
    const rows = this.sqlite.prepare("SELECT id, director, actors_json FROM movies WHERE metadata_source = 'fc2' AND director IS NOT NULL AND trim(director) <> ''").all() as Row[]
    const update = this.sqlite.prepare('UPDATE movies SET actors_json = ?, updated_at = ? WHERE id = ?')
    let changed = 0
    const transaction = this.sqlite.transaction(() => {
      for (const row of rows) {
        const director = String(row.director).trim()
        const actors = jsonArray(row.actors_json)
        if (actors.some((actor) => actor === director)) continue
        update.run(JSON.stringify([...actors, director]), now(), row.id)
        changed += 1
      }
    })
    transaction()
    return changed
  }

  replaceOriginalWithHevc(originalFileId: string, hevcFileId: string, replacement: { path: string; name: string; extension: string; size: number; mtimeMs: number; mediaInfo: MediaInfo | null }): void {
    const original = this.getFile(originalFileId)
    const hevc = this.getFile(hevcFileId)
    if (!original || !hevc || original.movieId !== hevc.movieId) throw new Error('替换文件不属于同一影片')
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM media_files WHERE id = ?').run(hevcFileId)
      this.sqlite.prepare(`UPDATE media_files SET path = ?, name = ?, extension = ?, size = ?, mtime_ms = ?, available = 1, version_label = ?, media_info_json = ?, updated_at = ? WHERE id = ?`)
        .run(replacement.path, replacement.name, replacement.extension, replacement.size, replacement.mtimeMs, 'HEVC 原分辨率', replacement.mediaInfo ? JSON.stringify(replacement.mediaInfo) : null, now(), originalFileId)
    })
    transaction()
  }

  updateMovie(id: string, patch: MoviePatch, markManual = true): MovieRecord {
    if (typeof patch.code === 'string' && patch.code.trim()) {
      const normalized = patch.code.trim().toUpperCase()
      const grouped = this.sqlite.prepare('SELECT id FROM movies WHERE normalized_code = ? AND id <> ?').get(normalized, id) as Row | undefined
      if (typeof grouped?.id === 'string') {
        const targetId = grouped.id
        const transaction = this.sqlite.transaction(() => {
          this.sqlite.prepare('UPDATE media_files SET movie_id = ?, updated_at = ? WHERE movie_id = ?').run(targetId, now(), id)
          this.sqlite.prepare('DELETE FROM movies WHERE id = ?').run(id)
        })
        transaction()
        id = targetId
      }
    }
    const allowed: Record<keyof MoviePatch, string> = {
      code: 'code', title: 'title', description: 'description', releaseDate: 'release_date',
      durationMinutes: 'duration_minutes', director: 'director', studio: 'studio', label: 'label',
      series: 'series', actors: 'actors_json', tags: 'tags_json', watchStatus: 'watch_status', sourcePartition: 'source_partition'
    }
    const current = this.getMovie(id)
    if (!current) throw new Error('影片不存在')
    const assignments: string[] = []
    const values: unknown[] = []
    const manual = new Set(current.manualFields)
    for (const [key, value] of Object.entries(patch) as [keyof MoviePatch, MoviePatch[keyof MoviePatch]][]) {
      assignments.push(`${allowed[key]} = ?`)
      values.push(key === 'actors' || key === 'tags' ? JSON.stringify(value ?? []) : value ?? null)
      if (markManual) manual.add(key)
      if (key === 'code') {
        assignments.push('normalized_code = ?')
        values.push(typeof value === 'string' && value ? value.trim().toUpperCase() : null)
      }
      if (key === 'sourcePartition') {
        assignments.push('source_partition_source = ?')
        values.push(markManual ? 'manual' : current.sourcePartitionSource)
      }
    }
    if (assignments.length === 0) return current
    assignments.push('manual_fields_json = ?', 'updated_at = ?')
    values.push(JSON.stringify([...manual]), now(), id)
    this.sqlite.prepare(`UPDATE movies SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
    // Once a code has been explicitly saved (manually, NFO, JavBus, or sidecar),
    // its local files are no longer "unidentified" merely because their names are messy.
    if (typeof patch.code === 'string' && patch.code.trim()) {
      this.sqlite.prepare('UPDATE media_files SET code_recognized = 1, updated_at = ? WHERE movie_id = ?').run(now(), id)
    }
    return this.getMovie(id)!
  }

  markMovieMetadataSource(id: string, source: string): MovieRecord {
    const movie = this.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const timestamp = now()
    this.sqlite.prepare('UPDATE movies SET metadata_source = ?, metadata_updated_at = ?, updated_at = ? WHERE id = ?')
      .run(source, timestamp, timestamp, id)
    return this.getMovie(id)!
  }

  setMovieSourcePartition(id: string, partition: SourcePartition, determinedBy: SourcePartitionSource): MovieRecord {
    const movie = this.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    this.sqlite.prepare('UPDATE movies SET source_partition = ?, source_partition_source = ?, updated_at = ? WHERE id = ?').run(partition, determinedBy, now(), id)
    return this.getMovie(id)!
  }

  applyMetadata(id: string, details: MetadataDetails, coverPath: string | null, mode: 'fill' | 'preserve' | 'overwrite', metadataSource = 'javbus'): MovieRecord {
    const movie = this.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const manual = new Set(movie.manualFields)
    const source: MoviePatch = {
      code: details.code,
      title: details.title,
      description: details.description,
      releaseDate: details.releaseDate,
      durationMinutes: details.durationMinutes,
      director: details.director,
      studio: details.studio,
      label: details.label,
      series: details.series,
      actors: details.actors,
      tags: details.tags
    }
    const patch: MoviePatch = {}
    for (const [key, value] of Object.entries(source) as [keyof MoviePatch, MoviePatch[keyof MoviePatch]][]) {
      const existing = movie[key as keyof MovieRecord]
      const codeLikeTitle = key === 'title' && typeof existing === 'string' && [movie.code, movie.normalizedCode]
        .some((code) => typeof code === 'string' && existing.trim().toUpperCase() === code.trim().toUpperCase())
      const missing = existing == null || existing === '' || (Array.isArray(existing) && existing.length === 0) || codeLikeTitle
      // An empty field has no user content to protect. Older NFO/manual-edit
      // flows could mark every field as manual even when its value was blank,
      // which prevented a later metadata lookup from filling anything.
      if (mode === 'overwrite' || (mode === 'preserve' && (!manual.has(key) || missing)) || (mode === 'fill' && missing)) {
        ;(patch as Record<string, unknown>)[key] = value
      }
    }
    const updated = this.updateMovie(id, patch, false)
    const shouldReplaceCover = coverPath != null && (mode === 'overwrite' || (mode === 'preserve' && !manual.has('cover')) || (mode === 'fill' && !movie.coverUrl))
    this.sqlite.prepare(`
      UPDATE movies SET cover_path = COALESCE(?, cover_path), cover_source = CASE WHEN ? IS NOT NULL THEN ? ELSE cover_source END, metadata_source = ?,
        metadata_updated_at = ?, updated_at = ? WHERE id = ?
    `).run(shouldReplaceCover ? coverPath : null, shouldReplaceCover ? coverPath : null, details.coverUrl, metadataSource, now(), now(), id)
    return this.getMovie(updated.id)!
  }

  restoreManualFields(id: string, fields: string[]): MovieRecord {
    const movie = this.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const allowed = new Set(['code', 'title', 'description', 'releaseDate', 'durationMinutes', 'director', 'studio', 'label', 'series', 'actors', 'tags', 'watchStatus', 'sourcePartition', 'cover'])
    const restored = [...new Set(fields.filter((field) => allowed.has(field)))]
    this.sqlite.prepare('UPDATE movies SET manual_fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(restored), now(), id)
    return this.getMovie(id)!
  }

  updateCover(id: string, coverPath: string): MovieRecord {
    const movie = this.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const manual = new Set(movie.manualFields)
    manual.add('cover')
    this.sqlite.prepare(`UPDATE movies SET cover_path = ?, cover_source = 'manual', manual_fields_json = ?, updated_at = ? WHERE id = ?`)
      .run(coverPath, JSON.stringify([...manual]), now(), id)
    return this.getMovie(id)!
  }

  removeCover(id: string): MovieRecord {
    const movie = this.getMovie(id)
    if (!movie) throw new Error('影片不存在')
    const manual = new Set(movie.manualFields)
    manual.delete('cover')
    this.sqlite.prepare(`UPDATE movies SET cover_path = NULL, cover_source = NULL, manual_fields_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify([...manual]), now(), id)
    return this.getMovie(id)!
  }

  getCoverPath(movieId: string): string | null {
    const row = this.sqlite.prepare('SELECT cover_path FROM movies WHERE id = ?').get(movieId) as Row | undefined
    return typeof row?.cover_path === 'string' ? row.cover_path : null
  }

  getActorProfile(name: string): ActorProfile | null {
    const row = this.sqlite.prepare('SELECT * FROM actor_profiles WHERE name = ?').get(name) as Row | undefined
    if (!row) return null
    return {
      name: String(row.name),
      providerId: String(row.provider_id),
      avatarUrl: row.avatar_path ? `avault-media://actor/${encodeURIComponent(String(row.name))}?v=${encodeURIComponent(String(row.metadata_updated_at))}` : null,
      category: typeof row.category === 'string' ? row.category : null,
      providerMovieCount: typeof row.provider_movie_count === 'number' ? row.provider_movie_count : null,
      whosId: typeof row.whos_id === 'string' ? row.whos_id : null,
      aliases: jsonArray(row.aliases_json),
      birthday: typeof row.birthday === 'string' ? row.birthday : null,
      bust: typeof row.bust === 'number' ? row.bust : null,
      waist: typeof row.waist === 'number' ? row.waist : null,
      hip: typeof row.hip === 'number' ? row.hip : null,
      height: typeof row.height === 'number' ? row.height : null,
      debutYear: typeof row.debut_year === 'number' ? row.debut_year : null,
      socialLinks: jsonSocialLinks(row.social_links_json),
      metadataSource: String(row.metadata_source),
      metadataUpdatedAt: String(row.metadata_updated_at)
    }
  }

  getActorAvatarPath(name: string): string | null {
    const row = this.sqlite.prepare('SELECT avatar_path FROM actor_profiles WHERE name = ?').get(name) as Row | undefined
    return typeof row?.avatar_path === 'string' ? row.avatar_path : null
  }

  setActorAvatar(name: string, avatarPath: string, manual = true): ActorProfile {
    const timestamp = now()
    this.sqlite.prepare(`
      INSERT INTO actor_profiles(name, provider_id, avatar_path, avatar_manual, aliases_json, metadata_source, metadata_updated_at)
      VALUES(?, ?, ?, ?, '[]', ?, ?)
      ON CONFLICT(name) DO UPDATE SET avatar_path = excluded.avatar_path, avatar_manual = excluded.avatar_manual, metadata_updated_at = excluded.metadata_updated_at
    `).run(name, manual ? 'manual' : 'gfriends', avatarPath, manual ? 1 : 0, manual ? 'manual' : 'gfriends', timestamp)
    return this.getActorProfile(name)!
  }

  removeActorAvatar(name: string): ActorProfile | null {
    const profile = this.getActorProfile(name)
    if (!profile) return null
    this.sqlite.prepare('UPDATE actor_profiles SET avatar_path = NULL, avatar_manual = 0, metadata_updated_at = ? WHERE name = ?').run(now(), name)
    return this.getActorProfile(name)
  }

  updateActorProfile(name: string, patch: ActorProfilePatch): ActorProfile {
    const timestamp = now()
    const profile = this.getActorProfile(name)
    if (!profile) {
      this.sqlite.prepare("INSERT INTO actor_profiles(name, provider_id, aliases_json, metadata_source, metadata_updated_at) VALUES(?, 'manual', '[]', 'manual', ?)").run(name, timestamp)
    }
    this.sqlite.prepare(`UPDATE actor_profiles SET category = ?, aliases_json = ?, birthday = ?, bust = ?, waist = ?, hip = ?, height = ?, debut_year = ?, social_links_json = ?, metadata_source = 'manual', metadata_updated_at = ? WHERE name = ?`)
      .run(patch.category, JSON.stringify(patch.aliases), patch.birthday, patch.bust, patch.waist, patch.hip, patch.height, patch.debutYear, JSON.stringify(patch.socialLinks), timestamp, name)
    return this.getActorProfile(name)!
  }

  upsertActorProfile(details: ActorMetadataDetails, avatarPath: string | null): ActorProfile {
    const timestamp = now()
    this.sqlite.prepare(`
      INSERT INTO actor_profiles(name, provider_id, whos_id, avatar_path, category, provider_movie_count,
        aliases_json, birthday, bust, waist, hip, height, debut_year, social_links_json, metadata_source, metadata_updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET provider_id = excluded.provider_id,
        whos_id = COALESCE(excluded.whos_id, actor_profiles.whos_id),
        avatar_path = CASE WHEN actor_profiles.avatar_manual = 1 THEN actor_profiles.avatar_path ELSE COALESCE(excluded.avatar_path, actor_profiles.avatar_path) END, category = COALESCE(excluded.category, actor_profiles.category),
        provider_movie_count = COALESCE(excluded.provider_movie_count, actor_profiles.provider_movie_count),
        aliases_json = CASE WHEN excluded.aliases_json <> '[]' THEN excluded.aliases_json ELSE actor_profiles.aliases_json END,
        birthday = COALESCE(excluded.birthday, actor_profiles.birthday),
        bust = COALESCE(excluded.bust, actor_profiles.bust), waist = COALESCE(excluded.waist, actor_profiles.waist),
        hip = COALESCE(excluded.hip, actor_profiles.hip), height = COALESCE(excluded.height, actor_profiles.height),
        debut_year = COALESCE(excluded.debut_year, actor_profiles.debut_year),
        social_links_json = CASE WHEN excluded.social_links_json <> '[]' THEN excluded.social_links_json ELSE actor_profiles.social_links_json END,
        metadata_source = excluded.metadata_source,
        metadata_updated_at = excluded.metadata_updated_at
    `).run(details.name, details.providerId, details.whosId ?? null, avatarPath, details.category, details.providerMovieCount,
      JSON.stringify(details.aliases ?? []), details.birthday ?? null, details.bust ?? null, details.waist ?? null, details.hip ?? null,
      details.height ?? null, details.debutYear ?? null, JSON.stringify(details.socialLinks ?? []), details.metadataSource ?? 'javbus', timestamp)
    return this.getActorProfile(details.name)!
  }

  getFile(fileId: string): MediaFileRecord | null {
    const row = this.sqlite.prepare('SELECT * FROM media_files WHERE id = ?').get(fileId) as Row | undefined
    return row ? this.mapFile(row) : null
  }

  removeMissingFile(fileId: string): void {
    const file = this.getFile(fileId)
    if (!file) throw new Error('影片文件不存在')
    if (file.available) throw new Error('只能清理已失效的文件记录')
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM media_files WHERE id = ?').run(fileId)
      this.sqlite.prepare('DELETE FROM movies WHERE id = ? AND NOT EXISTS (SELECT 1 FROM media_files WHERE movie_id = ?)').run(file.movieId, file.movieId)
    })
    transaction()
  }

  saveDevice(name: string, token: string): PairedDevice {
    const id = randomUUID()
    const timestamp = now()
    this.sqlite.prepare(`INSERT INTO paired_devices(id, name, token_hash, paired_at, revoked) VALUES(?, ?, ?, ?, 0)`)
      .run(id, name.slice(0, 80) || 'Android 设备', createHash('sha256').update(token).digest('hex'), timestamp)
    return { id, name: name.slice(0, 80) || 'Android 设备', pairedAt: timestamp, lastSeenAt: null, revoked: false }
  }

  authenticateToken(token: string): PairedDevice | null {
    const hash = createHash('sha256').update(token).digest('hex')
    const row = this.sqlite.prepare('SELECT * FROM paired_devices WHERE token_hash = ? AND revoked = 0').get(hash) as Row | undefined
    if (!row) return null
    const seen = now()
    this.sqlite.prepare('UPDATE paired_devices SET last_seen_at = ? WHERE id = ?').run(seen, row.id)
    return this.mapDevice({ ...row, last_seen_at: seen })
  }

  listDevices(): PairedDevice[] {
    return (this.sqlite.prepare('SELECT * FROM paired_devices ORDER BY paired_at DESC').all() as Row[]).map((row) => this.mapDevice(row))
  }

  revokeDevice(id: string): void {
    this.sqlite.prepare('UPDATE paired_devices SET revoked = 1 WHERE id = ?').run(id)
  }

  private mapDevice(row: Row): PairedDevice {
    return {
      id: String(row.id),
      name: String(row.name),
      pairedAt: String(row.paired_at),
      lastSeenAt: typeof row.last_seen_at === 'string' ? row.last_seen_at : null,
      revoked: bool(row.revoked)
    }
  }

  updateProgress(movieId: string, progressSeconds: number, durationSeconds: number, status?: WatchStatus): void {
    const inferred: WatchStatus = status ?? (durationSeconds > 0 && progressSeconds / durationSeconds >= 0.9 ? 'watched' : progressSeconds > 0 ? 'watching' : 'unwatched')
    this.sqlite.prepare(`UPDATE movies SET progress_seconds = ?, duration_seconds = ?, watch_status = ?, updated_at = ? WHERE id = ?`)
      .run(Math.max(0, Math.floor(progressSeconds)), Math.max(0, Math.floor(durationSeconds)), inferred, now(), movieId)
  }
}
