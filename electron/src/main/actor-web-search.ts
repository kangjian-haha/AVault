import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ActorMetadataDetails } from '../shared/contracts'

const HEADERS = { 'user-agent': 'AVault/0.1 (personal media library; public profile lookup)', 'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6' }

export interface WikipediaActorFacts {
  aliases?: string[]
  birthday?: string
  height?: number
  bust?: number
  waist?: number
  hip?: number
  debutYear?: number
}

export interface WebSource { url: string; title: string; text: string; wikipediaFacts?: WikipediaActorFacts }

function decodeHtml(text: string): string {
  return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}

function plainText(html: string): string {
  return decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

/** Extract the visible key/value rows from Japanese Wikipedia's infobox before
 * handing the article to the model.  This keeps dimensions such as B/W/H from
 * being buried in the rest of a long article. */
export function wikipediaInfoboxText(html: string): string {
  const rows: string[] = []
  const importantLabel = /生年月日|誕生日|身長|スリーサイズ|バスト|ウエスト|ヒップ|デビュー|別名|活動|血液型/i
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1]
    const header = row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1]
    const value = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1]
    if (!header || !value) continue
    const label = plainText(header)
    const text = plainText(value)
    if (label && text && importantLabel.test(label)) rows.push(`${label}: ${text}`)
  }
  return [...new Set(rows)].slice(0, 20).join('\n')
}

function normalizedWikipediaDate(value: string): string | undefined {
  const matched = value.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return undefined
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`
}

function positiveInteger(value: string): number | undefined {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

/** Parse fields that Japanese Wikipedia presents in a standard infobox. */
export function wikipediaActorFacts(html: string): WikipediaActorFacts {
  const values = new Map<string, string>()
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1]
    const header = row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1]
    const cell = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1]
    if (!header || !cell) continue
    const label = plainText(header)
    const value = plainText(cell)
    if (label && value) values.set(label, value)
  }
  const findValue = (pattern: RegExp) => [...values.entries()].find(([label]) => pattern.test(label))?.[1]
  const sizes = findValue(/スリーサイズ/i) ?? ''
  const bustText = findValue(/バスト/i) ?? sizes.match(/(?:\bB|バスト)\s*([0-9]{2,3})/i)?.[1] ?? ''
  const waistText = findValue(/ウエスト/i) ?? sizes.match(/(?:\bW|ウエスト)\s*([0-9]{2,3})/i)?.[1] ?? ''
  const hipText = findValue(/ヒップ/i) ?? sizes.match(/(?:\bH|ヒップ)\s*([0-9]{2,3})/i)?.[1] ?? ''
  const aliases = (findValue(/別名|別名義|愛称/i) ?? '')
    .split(/[、,，/／\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 20)
  const birthday = normalizedWikipediaDate(findValue(/生年月日|誕生日/i) ?? '')
  const debutText = findValue(/デビュー|活動期間/i) ?? ''
  const debutYear = debutText.match(/(?:19|20)\d{2}/)?.[0]
  return {
    ...(aliases.length ? { aliases } : {}),
    ...(birthday ? { birthday } : {}),
    ...(positiveInteger((findValue(/身長/i) ?? '').match(/\d{2,3}/)?.[0] ?? '') ? { height: positiveInteger((findValue(/身長/i) ?? '').match(/\d{2,3}/)?.[0] ?? '') } : {}),
    ...(positiveInteger(bustText.match(/\d{2,3}/)?.[0] ?? '') ? { bust: positiveInteger(bustText.match(/\d{2,3}/)?.[0] ?? '') } : {}),
    ...(positiveInteger(waistText.match(/\d{2,3}/)?.[0] ?? '') ? { waist: positiveInteger(waistText.match(/\d{2,3}/)?.[0] ?? '') } : {}),
    ...(positiveInteger(hipText.match(/\d{2,3}/)?.[0] ?? '') ? { hip: positiveInteger(hipText.match(/\d{2,3}/)?.[0] ?? '') } : {}),
    ...(debutYear ? { debutYear: Number(debutYear) } : {}),
  }
}

/** Directly parsed Wikipedia values are more reliable than a model omission. */
export function applyWikipediaActorFacts(details: ActorMetadataDetails, sources: WebSource[]): ActorMetadataDetails {
  const facts = sources.find((source) => source.wikipediaFacts)?.wikipediaFacts
  if (!facts) return details
  return {
    ...details,
    aliases: facts.aliases?.length ? facts.aliases : details.aliases,
    birthday: facts.birthday ?? details.birthday,
    height: facts.height ?? details.height,
    bust: facts.bust ?? details.bust,
    waist: facts.waist ?? details.waist,
    hip: facts.hip ?? details.hip,
    debutYear: facts.debutYear ?? details.debutYear,
  }
}

function searchLinks(html: string): Array<{ url: string; title: string }> {
  const results: Array<{ url: string; title: string }> = []
  for (const match of html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1])
    const redirect = href.match(/[?&]uddg=([^&]+)/i)?.[1]
    const url = redirect ? decodeURIComponent(redirect) : href.startsWith('//') ? `https:${href}` : href
    if (/^https?:\/\//i.test(url)) results.push({ url, title: plainText(match[2]) })
  }
  return results
}

function bingSearchLinks(html: string): Array<{ url: string; title: string }> {
  const results: Array<{ url: string; title: string }> = []
  for (const match of html.matchAll(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi)) {
    const url = decodeHtml(match[1])
    if (/^https?:\/\//i.test(url)) results.push({ url, title: plainText(match[2]) })
  }
  return results
}

export type WebRequest = (url: string, init?: RequestInit) => Promise<Response>

type WikipediaSearchResponse = {
  query?: { search?: Array<{ title?: string }> }
}

type WikidataSearchResponse = {
  search?: Array<{ id?: string; label?: string; description?: string; aliases?: string[] }>
}

export function isPublicIpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 0 || b === 168)) return false
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false
    if (a === 203 && b === 0) return false
    return true
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return normalized !== '::' && normalized !== '::1' && !normalized.startsWith('fc') && !normalized.startsWith('fd') && !normalized.startsWith('fe8') && !normalized.startsWith('fe9') && !normalized.startsWith('fea') && !normalized.startsWith('feb') && !normalized.startsWith('ff')
  }
  return false
}

async function isPublicHttpUrl(value: string): Promise<boolean> {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  const hostname = url.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false
  if (isIP(hostname)) return isPublicIpAddress(hostname)
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    return addresses.length > 0 && addresses.every(({ address }) => isPublicIpAddress(address))
  } catch { return false }
}

async function fetchHtml(request: WebRequest, url: string): Promise<string | null> {
  try {
    let target = url
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!await isPublicHttpUrl(target)) return null
      const response = await request(target, { headers: HEADERS, signal: AbortSignal.timeout(15_000), redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return null
        target = new URL(location, target).toString()
        continue
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null
      return await response.text()
    }
    return null
  } catch { return null }
}

async function fetchText(request: WebRequest, url: string): Promise<string | null> {
  const html = await fetchHtml(request, url)
  if (!html) return null
  const text = plainText(html)
  return text.length > 80 ? text.slice(0, 12_000) : null
}

async function fetchJson<T>(request: WebRequest, url: string): Promise<T | null> {
  try {
    if (!await isPublicHttpUrl(url)) return null
    const response = await request(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function findJapaneseWikipediaSource(name: string, request: WebRequest): Promise<WebSource | null> {
  const api = `https://ja.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&utf8=1&srsearch=${encodeURIComponent(name)}`
  const result = await fetchJson<WikipediaSearchResponse>(request, api)
  const candidates = result?.query?.search ?? []
  const exact = candidates.find((candidate) => candidate.title?.trim() === name.trim())
  const title = (exact ?? candidates[0])?.title?.trim()
  if (!title) return null
  const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
  const html = await fetchHtml(request, url)
  if (!html) return null
  const articleText = plainText(html)
  const infobox = wikipediaInfoboxText(html)
  const text = [
    infobox ? `Wikipedia 信息框（已直接解析，请优先使用）：\n${infobox}` : '',
    articleText,
  ].filter(Boolean).join('\n\n').slice(0, 12_000)
  return text ? { url, title: `日本語 Wikipedia：${title}`, text, wikipediaFacts: wikipediaActorFacts(html) } : null
}

async function findWikidataSource(name: string, request: WebRequest): Promise<WebSource | null> {
  const api = `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=ja&uselang=ja&type=item&limit=5&format=json&search=${encodeURIComponent(name)}`
  const result = await fetchJson<WikidataSearchResponse>(request, api)
  const candidates = result?.search ?? []
  const normalized = name.trim()
  const exact = candidates.find((candidate) => candidate.label?.trim() === normalized || candidate.aliases?.some((alias) => alias.trim() === normalized))
  const item = exact ?? candidates[0]
  if (!item?.id || !item.label) return null
  const description = item.description?.trim()
  return {
    url: `https://www.wikidata.org/wiki/${encodeURIComponent(item.id)}`,
    title: `Wikidata：${item.label}`,
    text: description ? `${item.label}。${description}` : item.label,
  }
}

export async function searchActorPublicSources(name: string, request: WebRequest = fetch): Promise<WebSource[]> {
  const query = `${name} 女優 プロフィール SNS`
  const searchEngines = [
    { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, parse: searchLinks },
    { name: 'Bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`, parse: bingSearchLinks }
  ]
  // Wikipedia 通常比搜索结果页更稳定，先作为生平字段的优先依据；
  // 普通搜索仍用于补充官方社交链接及 Wikipedia 未收录的演员。
  const referenceSources = (await Promise.all([
    findJapaneseWikipediaSource(name, request),
    findWikidataSource(name, request),
  ])).filter((source): source is WebSource => Boolean(source))
  let links: Array<{ url: string; title: string }> = []
  const failures: string[] = []
  for (const engine of searchEngines) {
    try {
      const response = await request(engine.url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
      if (!response.ok) { failures.push(`${engine.name} HTTP ${response.status}`); continue }
      links = engine.parse(await response.text()).slice(0, Math.max(1, 5 - referenceSources.length))
      if (links.length > 0) break
      failures.push(`${engine.name} 没有可用结果`)
    } catch (error) {
      failures.push(`${engine.name}：${error instanceof Error ? error.message : '连接失败'}`)
    }
  }
  if (links.length === 0 && referenceSources.length === 0) throw new Error(`公开网页搜索不可用，请检查网络或代理后重试（${failures.join('；')}）`)
  const sources = await Promise.all(links.map(async (link) => ({ ...link, text: await fetchText(request, link.url) })))
  // Social platforms commonly block automated page reads. Keep their result title and exact URL
  // as a small but still attributable source rather than treating the entire lookup as failed.
  const usable = sources.flatMap((source) => source.text || source.title ? [{ url: source.url, title: source.title, text: source.text ?? source.title }] : [])
  const allSources = [...referenceSources, ...usable]
  if (allSources.length === 0) throw new Error('搜索结果页面无法读取')
  return allSources.slice(0, 5)
}
