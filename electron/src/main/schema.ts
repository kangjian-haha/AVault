import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  lastScannedAt: text('last_scanned_at'),
  createdAt: text('created_at').notNull()
})

export const movies = sqliteTable('movies', {
  id: text('id').primaryKey(),
  code: text('code'),
  normalizedCode: text('normalized_code'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  releaseDate: text('release_date'),
  durationMinutes: integer('duration_minutes'),
  director: text('director'),
  studio: text('studio'),
  label: text('label'),
  series: text('series'),
  coverPath: text('cover_path'),
  coverSource: text('cover_source'),
  metadataSource: text('metadata_source'),
  metadataUpdatedAt: text('metadata_updated_at'),
  actorsJson: text('actors_json').notNull().default('[]'),
  tagsJson: text('tags_json').notNull().default('[]'),
  manualFieldsJson: text('manual_fields_json').notNull().default('[]'),
  watchStatus: text('watch_status').notNull().default('unwatched'),
  progressSeconds: integer('progress_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [uniqueIndex('movies_normalized_code_unique').on(table.normalizedCode)])

export const mediaFiles = sqliteTable('media_files', {
  id: text('id').primaryKey(),
  movieId: text('movie_id').notNull().references(() => movies.id),
  libraryId: text('library_id').notNull().references(() => libraries.id),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  relativeDir: text('relative_dir').notNull().default(''),
  extension: text('extension').notNull(),
  size: integer('size').notNull(),
  mtimeMs: integer('mtime_ms').notNull(),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  partLabel: text('part_label'),
  versionLabel: text('version_label'),
  mediaInfoJson: text('media_info_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('media_files_movie_idx').on(table.movieId), index('media_files_library_idx').on(table.libraryId)])

export const pairedDevices = sqliteTable('paired_devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  pairedAt: text('paired_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false)
})

export const actorProfiles = sqliteTable('actor_profiles', {
  name: text('name').primaryKey(),
  providerId: text('provider_id').notNull(),
  whosId: text('whos_id'),
  avatarPath: text('avatar_path'),
  category: text('category'),
  providerMovieCount: integer('provider_movie_count'),
  aliasesJson: text('aliases_json').notNull().default('[]'),
  birthday: text('birthday'),
  bust: integer('bust'),
  waist: integer('waist'),
  hip: integer('hip'),
  height: integer('height'),
  debutYear: integer('debut_year'),
  metadataSource: text('metadata_source').notNull(),
  metadataUpdatedAt: text('metadata_updated_at').notNull()
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const schema = { libraries, movies, mediaFiles, actorProfiles, pairedDevices, settings }
