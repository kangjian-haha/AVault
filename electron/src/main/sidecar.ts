import { readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { MetadataDetails, MovieRecord, SourcePartition, SourcePartitionSource } from '../shared/contracts'

const SCHEMA_VERSION = 2

type MovieSidecar = {
  schemaVersion: number
  kind: 'avault-movie'
  updatedAt: string
  metadataSource: string | null
  code: string | null
  title: string
  description: string
  releaseDate: string | null
  durationMinutes: number | null
  director: string | null
  studio: string | null
  label: string | null
  series: string | null
  actors: string[]
  tags: string[]
  manualFields: string[]
  coverFileName: string | null
  sourcePartition: { value: SourcePartition; determinedBy: SourcePartitionSource; updatedAt: string }
}

function safeBaseName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim() || 'movie'
}

function primaryFile(movie: MovieRecord) {
  return movie.files.find((file) => file.available && !file.versionLabel) ?? movie.files.find((file) => file.available) ?? null
}

export function sidecarPath(movie: MovieRecord): string | null {
  const file = primaryFile(movie)
  if (!file) return null
  return sidecarPathForMediaFile(file.path, movie.normalizedCode ?? movie.code)
}

export function sidecarPathForMediaFile(filePath: string, code: string | null): string {
  return join(dirname(filePath), `${safeBaseName(code ?? basename(filePath).replace(/\.[^.]+$/, ''))}.avault.json`)
}

export async function writeMovieSidecar(movie: MovieRecord, coverPath: string | null): Promise<string | null> {
  const target = sidecarPath(movie)
  if (!target) return null
  const coverFileName = coverPath && dirname(coverPath).toLowerCase() === dirname(target).toLowerCase() ? basename(coverPath) : null
  const payload: MovieSidecar = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'avault-movie',
    updatedAt: new Date().toISOString(),
    metadataSource: movie.metadataSource,
    code: movie.normalizedCode ?? movie.code,
    title: movie.title,
    description: movie.description,
    releaseDate: movie.releaseDate,
    durationMinutes: movie.durationMinutes,
    director: movie.director,
    studio: movie.studio,
    label: movie.label,
    series: movie.series,
    actors: movie.actors,
    tags: movie.tags,
    manualFields: movie.manualFields,
    coverFileName
    , sourcePartition: { value: movie.sourcePartition, determinedBy: movie.sourcePartitionSource, updatedAt: movie.updatedAt }
  }
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
  return target
}

export async function readMovieSidecar(filePath: string, code: string | null): Promise<{ details: MetadataDetails; coverPath: string | null; metadataSource: string; manualFields: string[]; sourcePartition: SourcePartition | null } | null> {
  const directory = dirname(filePath)
  const base = safeBaseName(code ?? basename(filePath).replace(/\.[^.]+$/, ''))
  const target = sidecarPathForMediaFile(filePath, code)
  if (!existsSync(target)) return null
  try {
    const value = JSON.parse(await readFile(target, 'utf8')) as Partial<MovieSidecar>
    if (![1, SCHEMA_VERSION].includes(Number(value.schemaVersion)) || value.kind !== 'avault-movie' || typeof value.title !== 'string') return null
    const coverPath = typeof value.coverFileName === 'string' ? join(directory, value.coverFileName) : null
    return {
      details: {
        providerId: `local-json:${value.code ?? base}`,
        code: typeof value.code === 'string' ? value.code : base,
        title: value.title,
        description: typeof value.description === 'string' ? value.description : '',
        releaseDate: typeof value.releaseDate === 'string' ? value.releaseDate : null,
        durationMinutes: typeof value.durationMinutes === 'number' ? value.durationMinutes : null,
        director: typeof value.director === 'string' ? value.director : null,
        studio: typeof value.studio === 'string' ? value.studio : null,
        label: typeof value.label === 'string' ? value.label : null,
        series: typeof value.series === 'string' ? value.series : null,
        actors: Array.isArray(value.actors) ? value.actors.filter((item): item is string => typeof item === 'string') : [],
        tags: Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === 'string') : [],
        coverUrl: null
      },
      coverPath: coverPath && existsSync(coverPath) ? coverPath : null,
      metadataSource: typeof value.metadataSource === 'string' ? value.metadataSource : 'local-json',
      manualFields: Array.isArray(value.manualFields) ? value.manualFields.filter((item): item is string => typeof item === 'string') : []
      , sourcePartition: value.sourcePartition && ['censored', 'fc2', 'uncensored', 'leaked', 'unknown'].includes(value.sourcePartition.value) ? value.sourcePartition.value : null
    }
  } catch {
    return null
  }
}
