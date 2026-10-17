import type { ActorMetadataDetails, ActorSocialLink } from '../shared/contracts'
import type { WebSource } from './actor-web-search'

const API_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-v4-flash'

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function aliases(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(stringOrNull).filter((item): item is string => Boolean(item)))].slice(0, 20) : []
}

export function socialLinks(value: unknown): ActorSocialLink[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const platform = stringOrNull(raw.platform)
    const url = stringOrNull(raw.url)
    if (!platform || !url || !/^https?:\/\//i.test(url) || seen.has(url)) return []
    seen.add(url)
    return [{ platform, url }]
  }).slice(0, 12)
}

export function parseDeepSeekActorDetails(name: string, content: string): ActorMetadataDetails {
  let raw: Record<string, unknown>
  try {
    const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(normalized)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid JSON')
    raw = parsed as Record<string, unknown>
  } catch {
    throw new Error('DeepSeek 返回的演员资料格式无效')
  }
  return {
    name,
    providerId: `deepseek:${name}`,
    avatarUrl: null,
    category: stringOrNull(raw.category),
    providerMovieCount: null,
    aliases: aliases(raw.aliases),
    birthday: stringOrNull(raw.birthday),
    bust: integerOrNull(raw.bust),
    waist: integerOrNull(raw.waist),
    hip: integerOrNull(raw.hip),
    height: integerOrNull(raw.height),
    debutYear: integerOrNull(raw.debutYear),
    socialLinks: socialLinks(raw.socialLinks),
    metadataSource: 'deepseek'
  }
}

export class DeepSeekActorProvider {
  constructor(private readonly apiKey: string, private readonly request: typeof fetch = fetch) {}

  async getActorDetails(name: string, knownAliases: string[] = [], sources: WebSource[] = []): Promise<{ details: ActorMetadataDetails; request: string; response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    if (!this.apiKey.trim()) throw new Error('请先在设置中填写 DeepSeek API Key')
    const body = {
      model: MODEL,
      thinking: { type: 'disabled' },
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Return a JSON object only. Extract public biographical information from the supplied public web sources. When a source contains “Wikipedia 信息框（已直接解析）”, treat it as a high-priority source and extract every available field. Parse Japanese size notation such as スリーサイズ, B88/W59/H85, バスト, ウエスト, ヒップ into bust, waist and hip numbers. Never invent facts or URLs. Unknown values must be null, unknown arrays must be []. socialLinks must contain only exact publicly known http(s) profile URLs visible in the sources, never search URLs. JSON schema: {"aliases":string[],"birthday":string|null,"height":number|null,"bust":number|null,"waist":number|null,"hip":number|null,"debutYear":number|null,"category":string|null,"socialLinks":[{"platform":string,"url":string}]}. The word json is intentional.'
        },
        { role: 'user', content: `Actor name: ${name}\nKnown aliases: ${knownAliases.join(', ') || 'none'}\n\nPublic web sources:\n${sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\n${source.text}`).join('\n\n')}\n\nReturn json now.` }
      ]
    }
    let response: Response
    try {
      response = await this.request(API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey.trim()}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify(body)
      })
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `：${error.cause.message}` : ''
      throw new Error(`DeepSeek 网络连接失败${cause}`)
    }
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500)
      throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）${message ? `：${message}` : ''}`)
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek 没有返回演员资料')
    return { details: parseDeepSeekActorDetails(name, content), request: JSON.stringify(body, null, 2), response: content, usage: { promptTokens: payload.usage?.prompt_tokens ?? 0, completionTokens: payload.usage?.completion_tokens ?? 0, totalTokens: payload.usage?.total_tokens ?? 0 } }
  }
}
