import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { MetadataCandidate, MetadataDetails } from '../shared/contracts'

const REQUEST_TIMEOUT_MS = 15_000
const HEADERS = {
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7,ja;q=0.6'
}

export function fc2ArticleId(input: string): string | null {
  const match = input.toUpperCase().match(/FC2[-_.\s]?(?:PPV[-_.\s]?)?(\d{5,8})/)
  return match?.[1] ?? null
}

function absoluteUrl(baseUrl: string, value: string | undefined): string | null {
  if (!value) return null
  try { return new URL(value, baseUrl).toString() } catch { return null }
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const value = cleanText($(selector).first().text())
    if (value) return value
  }
  return ''
}

function visibleTitleText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const element = $(selector).first()
    if (!element.length) continue
    const clone = element.clone()
    clone.find('span').each((_, span) => {
      const style = ($(span).attr('style') ?? '').replace(/\s/g, '').toLowerCase()
      const isHiddenTrap = /zoom:0\.0*1/.test(style) || (style.includes('color:#fff') && style.includes('overflow:hidden') && /(?:width|height):1px/.test(style))
      if (isHiddenTrap) $(span).remove()
    })
    const value = cleanText(clone.text())
    if (value) return value
  }
  return ''
}

function parseFc2Date(value: string): string | null {
  const match = value.match(/(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null
}

function parseFc2Duration(value: string): number | null {
  const clock = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (clock) {
    const hours = clock[3] ? Number(clock[1]) : 0
    const minutes = clock[3] ? Number(clock[2]) : Number(clock[1])
    const seconds = Number(clock[3] ?? clock[2])
    return Math.max(1, Math.round((hours * 3600 + minutes * 60 + seconds) / 60))
  }
  const minutes = value.match(/(\d{1,3})\s*(?:分|分鐘|minutes?)/i)?.[1]
  return minutes ? Number(minutes) : null
}

export function parseFc2Details(baseUrl: string, articleId: string, html: string): MetadataDetails {
  const $ = cheerio.load(html)
  const title = visibleTitleText($, ['#top .items_article_headerInfo h3', '.items_article_headerInfo h3', '.items_article_Header h1', '.article-title'])
  if (!title) throw new Error('FC2 商品页没有返回可用的标题')
  const description = firstText($, ['.items_article_Description', '.article-description', '[itemprop="description"]']) || cleanText($('meta[name="description"]').attr('content'))
  const image = $('meta[property="og:image"]').attr('content')
    ?? $('.items_article_Thumbnail img, .article-image img, [itemprop="image"]').first().attr('src')
  const tags = [...new Set($('a[href*="tag"], a[href*="genre"]').map((_, element) => cleanText($(element).text())).get().filter(Boolean))]
  const pageText = cleanText($('body').text())
  const releaseDateText = firstText($, ['#top .items_article_headerInfo > div:nth-child(5) > p', '.items_article_headerInfo .items_article_date p']) || (pageText.match(/(?:販売日|发布日期|發售日|Release(?:\s+date)?)\s*[:：]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})/i)?.[1] ?? '')
  const durationText = firstText($, ['#top .items_article_MainitemThumb > span > p', '.items_article_MainitemThumb > span > p']) || pageText
  const director = firstText($, ['#top .items_article_headerInfo li.items_article_writer > a', '.items_article_headerInfo li.items_article_writer > a']) || null
  const code = `FC2-PPV-${articleId}`
  return {
    providerId: `fc2:${articleId}`,
    code,
    title,
    coverUrl: absoluteUrl(baseUrl, image),
    releaseDate: parseFc2Date(releaseDateText),
    description,
    durationMinutes: parseFc2Duration(durationText),
    director,
    studio: 'FC2',
    label: null,
    series: null,
    actors: director ? [director] : [],
    tags
  }
}

export class Fc2Provider {
  constructor(
    private readonly baseUrl: string,
    private readonly cacheDirectory: string,
    private readonly cookieHeader: () => Promise<string>,
    private readonly fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)
  ) {}

  private async request(url: string, accept = 'text/html,application/xhtml+xml'): Promise<Response> {
    const cookie = await this.cookieHeader()
    return this.fetcher(url, {
      headers: { ...HEADERS, accept, ...(cookie ? { cookie } : {}) },
      credentials: 'include',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow'
    })
  }

  async getDetails(providerId: string): Promise<MetadataDetails> {
    const articleId = providerId.replace(/^fc2:/i, '')
    if (!/^\d{5,8}$/.test(articleId)) throw new Error('FC2 番号格式无效')
    const response = await this.request(`${this.baseUrl}/article/${articleId}/`)
    if (response.url.includes('/login.php') || response.url.includes('/services/id/login')) throw new Error('FC2 需要先在本机登录后才能爬取资料')
    if (!response.ok) throw new Error(`FC2 请求失败（HTTP ${response.status}）`)
    const html = await response.text()
    const $ = cheerio.load(html)
    const pageTitle = cleanText($('title').text())
    const hasLoginForm = Boolean($('form[action*="login"], input[name="email"], input[name="password"]').length)
    const hasArticle = Boolean($('#top .items_article_headerInfo h3, .items_article_headerInfo h3').length)
    if (hasLoginForm || /(?:登录|登入|ログイン)\s*FC2/i.test(pageTitle)) {
      throw new Error('FC2 Cookie 已失效，请刷新浏览器中的 FC2 商品页后复制最新 Cookie')
    }
    if (!hasArticle) throw new Error('FC2 返回的不是商品详情页，请更新 Cookie 后重试')
    return parseFc2Details(this.baseUrl, articleId, html)
  }

  async search(code: string): Promise<MetadataCandidate[]> {
    const articleId = fc2ArticleId(code)
    if (!articleId) throw new Error('请先填写有效的 FC2-PPV 番号')
    const details = await this.getDetails(`fc2:${articleId}`)
    return [{ providerId: details.providerId, code: details.code, title: details.title, coverUrl: details.coverUrl, releaseDate: details.releaseDate }]
  }

  async cacheCover(targetDirectory: string, fileBase: string, coverUrl: string | null): Promise<string | null> {
    if (!coverUrl) return null
    const response = await this.request(coverUrl, 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')
    if (!response.ok) throw new Error(`FC2 封面下载失败（HTTP ${response.status}）`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? ''
    if (!contentType.startsWith('image/')) throw new Error('FC2 封面地址没有返回图片')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('FC2 封面文件过大')
    await mkdir(targetDirectory, { recursive: true })
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const target = join(targetDirectory, `${fileBase}.${extension}`)
    await writeFile(target, bytes)
    return target
  }
}
