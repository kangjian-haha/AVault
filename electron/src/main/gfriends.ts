import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILETREE_URLS = [
  'https://cdn.jsdelivr.net/gh/gfriends/gfriends@master/Filetree.json',
  'https://raw.githubusercontent.com/gfriends/gfriends/master/Filetree.json'
]
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 60_000
const HEADERS = {
  'user-agent': 'AVault/0.1 (personal media library)',
  'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6'
}

type FileTree = { Content?: Record<string, Record<string, string>> }

function normalizedName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s·・]/g, '')
}

function avatarUrl(company: string, value: string): string {
  const [file, query] = value.split('?', 2)
  const encodedPath = ['Content', company, file].map((part) => encodeURIComponent(part)).join('/')
  return `https://cdn.jsdelivr.net/gh/gfriends/gfriends@master/${encodedPath}${query ? `?${query}` : ''}`
}

export function findGfriendsAvatar(tree: FileTree, name: string, aliases: string[] = []): string | null {
  const candidates = new Set([name, ...aliases].map(normalizedName).filter(Boolean))
  let matched: string | null = null
  for (const [company, files] of Object.entries(tree.Content ?? {})) {
    for (const [alias, file] of Object.entries(files)) {
      const stem = alias.replace(/\.[^.]+$/, '')
      if (candidates.has(normalizedName(stem))) matched = avatarUrl(company, file)
    }
  }
  return matched
}

export class GfriendsActorProvider {
  private readonly filetreePath: string

  constructor(private readonly cacheDirectory: string) {
    this.filetreePath = join(cacheDirectory, 'gfriends-filetree.json')
  }

  private async cachedFiletree(): Promise<FileTree | null> {
    try {
      const info = await stat(this.filetreePath)
      const text = await readFile(this.filetreePath, 'utf8')
      const parsed = JSON.parse(text) as FileTree
      if (Date.now() - info.mtimeMs <= CACHE_MAX_AGE_MS) return parsed
      return parsed
    } catch { return null }
  }

  private async fetchFiletree(fallback: FileTree | null): Promise<FileTree> {
    for (const url of FILETREE_URLS) {
      try {
        const response = await fetch(url, { headers: { ...HEADERS, 'accept-encoding': 'gzip, deflate, br' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        if (!response.ok) continue
        const text = await response.text()
        if (text.length > 80 * 1024 * 1024) throw new Error('Gfriends 文件树过大')
        const parsed = JSON.parse(text) as FileTree
        if (!parsed.Content || typeof parsed.Content !== 'object') throw new Error('Gfriends 文件树格式无效')
        await mkdir(this.cacheDirectory, { recursive: true })
        await writeFile(this.filetreePath, text, 'utf8')
        return parsed
      } catch { /* Try the next mirror. */ }
    }
    if (fallback) return fallback
    throw new Error('Gfriends 头像索引下载失败')
  }

  async cacheActorAvatar(name: string, aliases: string[] = []): Promise<string | null> {
    const cached = await this.cachedFiletree()
    const tree = cached && Date.now() - (await stat(this.filetreePath)).mtimeMs <= CACHE_MAX_AGE_MS ? cached : await this.fetchFiletree(cached)
    const sourceUrl = findGfriendsAvatar(tree, name, aliases)
    if (!sourceUrl) return null
    const response = await fetch(sourceUrl, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' })
    if (!response.ok) throw new Error(`Gfriends 头像下载失败（HTTP ${response.status}）`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? ''
    if (!contentType.startsWith('image/')) throw new Error('Gfriends 返回的不是图片')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('Gfriends 头像文件过大')
    await mkdir(this.cacheDirectory, { recursive: true })
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const key = createHash('sha256').update(normalizedName(name)).digest('hex').slice(0, 20)
    const target = join(this.cacheDirectory, `gfriends-${key}.${extension}`)
    await writeFile(target, bytes)
    return target
  }
}
