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

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null
    const text = plainText(await response.text())
    return text.length > 80 ? text.slice(0, 12_000) : null
  } catch { return null }
}

export async function searchActorPublicSources(name: string): Promise<WebSource[]> {
  const query = `${name} 女優 プロフィール SNS`
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`公开网页搜索失败（HTTP ${response.status}）`)
  const links = searchLinks(await response.text()).slice(0, 5)
  if (links.length === 0) throw new Error('公开网页搜索没有返回可用结果')
  const sources = await Promise.all(links.map(async (link) => ({ ...link, text: await fetchText(link.url) })))
  // Social platforms commonly block automated page reads. Keep their result title and exact URL
  // as a small but still attributable source rather than treating the entire lookup as failed.
  const usable = sources.flatMap((source) => source.text || source.title ? [{ url: source.url, title: source.title, text: source.text ?? source.title }] : [])
  if (usable.length === 0) throw new Error('搜索结果页面无法读取')
  return usable
}
