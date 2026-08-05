import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { ActorMetadataDetails, MetadataCandidate, MetadataDetails } from '../shared/contracts'

export type JavBusSection = 'censored' | 'uncensored'

const REQUEST_TIMEOUT_MS = 15_000
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7,ja;q=0.6',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'upgrade-insecure-requests': '1'
}

export class JavBusNotFoundError extends Error {
  constructor(providerId: string) {
    super(`JavBus 未收录该影片：${providerId}`)
    this.name = 'JavBusNotFoundError'
  }
}

function absoluteUrl(baseUrl: string, value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}

function valueAfterLabel($: cheerio.CheerioAPI, label: string): string | null {
  const paragraph = $('.info p').filter((_, element) => $(element).text().includes(label)).first()
  if (!paragraph.length) return null
  const clone = paragraph.clone()
  // The uncensored page wraps the actual code in a second span. Remove only
  // the label span so the value remains available to the parser.
  clone.find('span').first().remove()
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const text = clone.text().replace(new RegExp(`^\\s*${escapedLabel}\\s*[:：]?\\s*`), '').trim()
  return text || paragraph.find('a').first().text().trim() || null
}

function isJavBusNotFoundHtml(html: string): boolean {
  const $ = cheerio.load(html)
  return $('.error-page').length > 0 && /404\s+Page\s+Not\s+Found/i.test($('.error-page').text())
}

export class JavBusProvider {
  private readonly cookies = new Map<string, string>()
  private referer: string

  constructor(
    private readonly baseUrl: string,
    private readonly cacheDirectory: string,
    private readonly actorCacheDirectory = join(cacheDirectory, 'actors')
  ) {
    this.referer = baseUrl
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  private async fetchHtml(url: string): Promise<string> {
    const cookie = this.cookieHeader()
    const response = await fetch(url, {
      headers: {
        ...HEADERS,
        ...(this.referer && this.referer !== url ? { referer: this.referer } : {}),
        ...(cookie ? { cookie } : {})
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow'
    })
    if (!response.ok) throw new Error(`JavBus 请求失败（HTTP ${response.status}）`)
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(';', 1)
      const separator = pair.indexOf('=')
      if (separator > 0) this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
    this.referer = response.url
    return response.text()
  }

  private async fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const response = await fetch(url, {
      headers: {
        ...HEADERS,
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        referer: this.referer,
        ...(this.cookieHeader() ? { cookie: this.cookieHeader() } : {})
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow'
    })
    if (!response.ok) throw new Error(`封面下载失败（HTTP ${response.status}）`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? ''
    if (!contentType.startsWith('image/')) throw new Error('封面地址没有返回图片')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('封面文件过大')
    return { bytes, contentType }
  }

  private async attachPreviews(candidates: MetadataCandidate[]): Promise<MetadataCandidate[]> {
    return Promise.all(candidates.slice(0, 12).map(async (candidate) => {
      if (!candidate.coverUrl) return { ...candidate, previewDataUrl: null }
      try {
        const image = await this.fetchImage(candidate.coverUrl)
        return { ...candidate, previewDataUrl: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}` }
      } catch {
        return { ...candidate, previewDataUrl: null }
      }
    }))
  }

  async search(code: string, section: JavBusSection = 'censored'): Promise<MetadataCandidate[]> {
    const normalized = code.trim().toUpperCase()
    if (!normalized) throw new Error('请先填写番号')
    const searchPath = section === 'uncensored'
      ? `/uncensored/search/${encodeURIComponent(normalized)}`
      : `/search/${encodeURIComponent(normalized)}&type=1`
    const html = await this.fetchHtml(new URL(searchPath, this.baseUrl).toString())
    const results = parseJavBusSearch(this.baseUrl, html)
    if (results.length === 0) {
      try {
        const direct = await this.getDetails(normalized, section)
        return this.attachPreviews([direct])
      } catch {
        return []
      }
    }
    return this.attachPreviews(results)
  }

  async getDetails(providerId: string, _section: JavBusSection = 'censored'): Promise<MetadataDetails> {
    // JavBus separates censored and uncensored search pages, but both kinds of
    // result link to the same root-level detail route (for example /th101-...).
    const detailUrl = new URL(`/${encodeURIComponent(providerId)}`, this.baseUrl).toString()
    let html: string
    try {
      html = await this.fetchHtml(detailUrl)
    } catch (error) {
      // Cloudflare currently rejects JavBus' bare detail route on some exits while the
      // language-prefixed route serves the same page normally. Keep the search session
      // cookies and referer, then retry the canonical Japanese route once.
      if (error instanceof Error && error.message.includes('HTTP 404')) throw new JavBusNotFoundError(providerId)
      if (!(error instanceof Error) || !error.message.includes('HTTP 403')) throw error
      try {
        const localizedDetailUrl = new URL(`/ja/${encodeURIComponent(providerId)}`, this.baseUrl).toString()
        html = await this.fetchHtml(localizedDetailUrl)
      } catch (retryError) {
        if (retryError instanceof Error && retryError.message.includes('HTTP 403')) {
          throw new Error('JavBus 详情页暂时不可访问（HTTP 403），搜索结果仍然可用，请稍后再试。')
        }
        throw retryError
      }
    }
    if (isJavBusNotFoundHtml(html)) throw new JavBusNotFoundError(providerId)
    return parseJavBusDetails(this.baseUrl, providerId, html)
  }

  async getActorDetails(name: string): Promise<ActorMetadataDetails> {
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('演员姓名不能为空')
    const searchHtml = await this.fetchHtml(`${this.baseUrl}/searchstar/${encodeURIComponent(normalizedName)}`)
    const candidates = parseJavBusActorSearch(this.baseUrl, searchHtml)
    const actor = candidates.find((candidate) => candidate.name === normalizedName) ?? (candidates.length === 1 ? candidates[0] : null)
    if (!actor) throw new Error('JavBus 没有找到匹配的演员')
    let providerMovieCount: number | null = null
    try {
      const profileHtml = await this.fetchHtml(`${this.baseUrl}/star/${encodeURIComponent(actor.providerId)}`)
      providerMovieCount = parseJavBusActorMovieCount(profileHtml)
    } catch {
      // The avatar result is still useful if the profile page temporarily fails.
    }
    return { ...actor, providerMovieCount }
  }

  async cacheActorAvatar(providerId: string, avatarUrl: string | null): Promise<string | null> {
    if (!avatarUrl) return null
    const { bytes, contentType } = await this.fetchImage(avatarUrl)
    await mkdir(this.actorCacheDirectory, { recursive: true })
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const target = join(this.actorCacheDirectory, `${providerId}.${extension}`)
    await writeFile(target, bytes)
    return target
  }

  async cacheCover(targetDirectory: string, fileBase: string, coverUrl: string | null): Promise<string | null> {
    if (!coverUrl) return null
    const { bytes, contentType } = await this.fetchImage(coverUrl)
    await mkdir(targetDirectory, { recursive: true })
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const target = join(targetDirectory, `${fileBase}.${extension}`)
    await writeFile(target, bytes)
    return target
  }
}

export function parseJavBusActorSearch(baseUrl: string, html: string): ActorMetadataDetails[] {
  const $ = cheerio.load(html)
  const results: ActorMetadataDetails[] = []
  $('.avatar-box').each((_, element) => {
    const box = $(element)
    const href = box.attr('href')
    const providerId = href?.match(/\/star\/([^/?#]+)/)?.[1]
    const image = box.find('img').first()
    const name = image.attr('title')?.trim() || box.find('span').first().clone().children().remove().end().text().trim()
    if (!providerId || !name) return
    results.push({
      name,
      providerId,
      avatarUrl: absoluteUrl(baseUrl, image.attr('src')),
      category: box.find('button').first().text().trim() || null,
      providerMovieCount: null
    })
  })
  return results
}

export function parseJavBusActorMovieCount(html: string): number | null {
  const text = cheerio.load(html).text().replace(/\s+/g, ' ')
  const match = text.match(/全部影片\s*(\d+)\s*部/) ?? text.match(/全部(?:影片|電影).*?(\d+)/)
  return match ? Number(match[1]) : null
}

export function parseJavBusSearch(baseUrl: string, html: string): MetadataCandidate[] {
    const $ = cheerio.load(html)
    const results: MetadataCandidate[] = []
    $('.movie-box').each((_, element) => {
      const link = $(element)
      const href = link.attr('href')
      const providerId = href?.split('/').filter(Boolean).pop()
      const title = link.find('img').attr('title')?.trim() || link.find('.photo-info span').first().text().trim()
      if (!providerId || !title) return
      const codeText = link.find('.photo-info date').first().text().trim() || providerId
      const dateText = link.find('.photo-info date').eq(1).text().trim()
      results.push({
        providerId,
        code: codeText.toUpperCase(),
        title,
        coverUrl: absoluteUrl(baseUrl, link.find('img').attr('src')),
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : null
      })
    })
    return results
}

export function parseJavBusDetails(baseUrl: string, providerId: string, html: string): MetadataDetails {
    const $ = cheerio.load(html)
    const rawTitle = $('h3').first().text().trim()
    const coverUrl = absoluteUrl(baseUrl, $('.bigImage').attr('href') ?? $('.bigImage img').attr('src'))
    const code = valueAfterLabel($, '識別碼') ?? valueAfterLabel($, '识别码') ?? providerId
    if (!rawTitle) throw new Error('没有找到可用的影片资料')
    const normalizedCode = code.replace(/\s/g, '').toUpperCase()
    const escapedCode = normalizedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const titleWithoutCode = rawTitle.replace(new RegExp(`^\\s*${escapedCode}(?:\\s+|$)`, 'i'), '').trim()
    const title = titleWithoutCode || rawTitle
    const durationText = valueAfterLabel($, '長度') ?? valueAfterLabel($, '长度')
    const duration = durationText?.match(/(\d+)/)?.[1]
    const actors = $('.star-name a, a.star-name, a[href*="/star/"]')
      .map((_, element) => $(element).text().trim() || $(element).attr('title')?.trim() || '')
      .get().filter(Boolean)
    const tags = $('.genre a')
      .filter((_, element) => !($(element).attr('href') ?? '').includes('/star/'))
      .map((_, element) => $(element).text().trim()).get().filter(Boolean)
    return {
      providerId,
      code: normalizedCode,
      title,
      coverUrl,
      releaseDate: valueAfterLabel($, '發行日期') ?? valueAfterLabel($, '发行日期'),
      description: '',
      durationMinutes: duration ? Number(duration) : null,
      director: valueAfterLabel($, '導演') ?? valueAfterLabel($, '导演'),
      studio: valueAfterLabel($, '製作商') ?? valueAfterLabel($, '制作商'),
      label: valueAfterLabel($, '發行商') ?? valueAfterLabel($, '发行商'),
      series: valueAfterLabel($, '系列'),
      actors: [...new Set(actors)],
      tags: [...new Set(tags)]
    }
}
