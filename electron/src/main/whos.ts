import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { ActorMetadataDetails } from '../shared/contracts'

const REQUEST_TIMEOUT_MS = 15_000
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6'
}

type PersonJsonLd = {
  '@type'?: string
  name?: string
  alternateName?: string | string[] | null
  image?: string
  birthDate?: string | null
  height?: string | number | null
}

function absoluteUrl(baseUrl: string, value: string | undefined): string | null {
  if (!value) return null
  try { return new URL(value, baseUrl).toString() } catch { return null }
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.trim().match(/(19|20)\d{2}[-年/.](\d{1,2})[-月/.](\d{1,2})/)
  if (!match) return null
  const year = match[0].slice(0, 4)
  return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function plausibleMeasurements(value: string | null): { bust: number; waist: number; hip: number } | null {
  const match = value?.match(/B\s*(\d{2,3}).*?W\s*(\d{2,3}).*?H\s*(\d{2,3})/i)
  if (!match) return null
  const [bust, waist, hip] = match.slice(1).map(Number)
  if (bust < 50 || bust > 150 || waist < 40 || waist > 120 || hip < 50 || hip > 150 || bust < waist || hip < waist) return null
  return { bust, waist, hip }
}

export function parseWhosActorDetails(baseUrl: string, html: string): ActorMetadataDetails {
  const $ = cheerio.load(html)
  const people: PersonJsonLd[] = []
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text()) as PersonJsonLd
      if (parsed['@type'] === 'Person') people.push(parsed)
    } catch { /* Ignore unrelated or malformed structured data. */ }
  })
  const person = people[0] ?? null
  const name = person?.name?.trim() || $('h1').first().text().trim()
  if (!name) throw new Error('Whos.tv 没有找到匹配的演员')
  const values = new Map<string, string>()
  $('p.text-sm.text-muted-foreground').each((_, element) => {
    const label = $(element).text().replace(/\s+/g, ' ').trim()
    const value = $(element).siblings('p.font-medium').first().text().replace(/\s+/g, ' ').trim()
    if (label && value) values.set(label, value)
  })
  const heightText = values.get('身高') ?? (person?.height != null ? String(person.height) : '')
  const heightMatch = heightText.match(/(\d{3})/)
  const height = heightMatch && Number(heightMatch[1]) >= 120 && Number(heightMatch[1]) <= 200 ? Number(heightMatch[1]) : null
  const measurements = plausibleMeasurements(values.get('三围') ?? null)
  const debutMatch = values.get('出道年份')?.match(/(19|20)\d{2}/)
  const debutYear = debutMatch ? Number(debutMatch[0]) : null
  const alternateName = person?.alternateName
  const aliases = (Array.isArray(alternateName) ? alternateName : alternateName ? [alternateName] : [])
    .map((alias) => alias.trim()).filter((alias) => alias && alias !== name)
  const internalId = html.match(/showRating\(['"](\d+)['"]/)?.[1]
  return {
    name,
    providerId: internalId ?? name,
    whosId: internalId ?? null,
    avatarUrl: absoluteUrl(baseUrl, person?.image ?? $('meta[property="og:image"]').attr('content')),
    category: null,
    providerMovieCount: null,
    aliases: [...new Set(aliases)],
    birthday: normalizeDate(values.get('生日') ?? person?.birthDate),
    height,
    bust: measurements?.bust ?? null,
    waist: measurements?.waist ?? null,
    hip: measurements?.hip ?? null,
    debutYear,
    metadataSource: 'whos'
  }
}

export class WhosActorProvider {
  constructor(private readonly cacheDirectory: string) {}

  async getActorDetails(name: string): Promise<ActorMetadataDetails> {
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('演员姓名不能为空')
    const url = `https://whos.tv/actresses/${encodeURIComponent(normalizedName)}`
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' })
    if (!response.ok) throw new Error(`Whos.tv 请求失败（HTTP ${response.status}）`)
    const details = parseWhosActorDetails(response.url, await response.text())
    if (details.name !== normalizedName && !details.aliases?.includes(normalizedName)) throw new Error('Whos.tv 返回了不匹配的演员')
    return details
  }

  async cacheActorAvatar(providerId: string, avatarUrl: string | null): Promise<string | null> {
    if (!avatarUrl) return null
    const response = await fetch(avatarUrl, { headers: { ...HEADERS, referer: 'https://whos.tv/' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' })
    if (!response.ok) throw new Error(`Whos.tv 头像下载失败（HTTP ${response.status}）`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? ''
    if (!contentType.startsWith('image/')) throw new Error('Whos.tv 头像地址没有返回图片')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('演员头像文件过大')
    await mkdir(this.cacheDirectory, { recursive: true })
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const key = createHash('sha256').update(providerId).digest('hex').slice(0, 20)
    const target = join(this.cacheDirectory, `whos-${key}.${extension}`)
    await writeFile(target, bytes)
    return target
  }
}
