import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const HEADERS = { 'user-agent': 'AVault/0.1 (personal media library; public profile lookup)', 'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6' }

export interface WebSource { url: string; title: string; text: string }

function decodeHtml(text: string): string {
  return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}

function plainText(html: string): string {
  return decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
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

async function fetchText(request: WebRequest, url: string): Promise<string | null> {
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
      const text = plainText(await response.text())
      return text.length > 80 ? text.slice(0, 12_000) : null
    }
    return null
  } catch { return null }
}

export async function searchActorPublicSources(name: string, request: WebRequest = fetch): Promise<WebSource[]> {
  const query = `${name} 女優 プロフィール SNS`
  const searchEngines = [
    { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, parse: searchLinks },
    { name: 'Bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`, parse: bingSearchLinks }
  ]
  let links: Array<{ url: string; title: string }> = []
  const failures: string[] = []
  for (const engine of searchEngines) {
    try {
      const response = await request(engine.url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
      if (!response.ok) { failures.push(`${engine.name} HTTP ${response.status}`); continue }
      links = engine.parse(await response.text()).slice(0, 5)
      if (links.length > 0) break
      failures.push(`${engine.name} 没有可用结果`)
    } catch (error) {
      failures.push(`${engine.name}：${error instanceof Error ? error.message : '连接失败'}`)
    }
  }
  if (links.length === 0) throw new Error(`公开网页搜索不可用，请检查网络或代理后重试（${failures.join('；')}）`)
  const sources = await Promise.all(links.map(async (link) => ({ ...link, text: await fetchText(request, link.url) })))
  // Social platforms commonly block automated page reads. Keep their result title and exact URL
  // as a small but still attributable source rather than treating the entire lookup as failed.
  const usable = sources.flatMap((source) => source.text || source.title ? [{ url: source.url, title: source.title, text: source.text ?? source.title }] : [])
  if (usable.length === 0) throw new Error('搜索结果页面无法读取')
  return usable
}
