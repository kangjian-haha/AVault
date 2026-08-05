import * as cheerio from 'cheerio'
import type { MetadataDetails } from '../shared/contracts'

const MAX_HTML_BYTES = 5 * 1024 * 1024

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function isLabel(value: string, labels: string[]): boolean {
  return labels.some((label) => value.includes(label))
}

/** Parses user-supplied JavDB markup only. It never fetches or executes page content. */
export function parseJavDbHtml(html: string): MetadataDetails {
  if (typeof html !== 'string' || !html.trim()) throw new Error('请粘贴或选择 JavDB 影片 HTML')
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('HTML 文件不能超过 5 MB')

  const $ = cheerio.load(html)
  const panel = $('.movie-panel-info').first()
  const titleNode = $('h2.title .current-title, h2 .current-title').first()
  const title = clean(titleNode.text())

  const blockFor = (labels: string[]) => panel.find('.panel-block').filter((_index, element) => {
    const heading = clean($(element).children('strong').first().text())
    return isLabel(heading, labels)
  }).first()
  const valueFor = (labels: string[]): string | null => {
    const block = blockFor(labels)
    if (!block.length) return null
    const value = clean(block.find('.value').first().text())
    if (value) return value
    const copy = block.clone()
    copy.children('strong').remove()
    return clean(copy.text()) || null
  }
  const linksFor = (labels: string[]): string[] => {
    const block = blockFor(labels)
    return block.length ? unique(block.find('.value a, a').map((_index, element) => $(element).text()).get()) : []
  }

  const code = (valueFor(['番號', '番号']) ?? clean($('h2.title > strong').first().text())).replace(/\s+/g, '')
  if (!panel.length || !title || !/^[A-Za-z0-9]+-[A-Za-z0-9]+$/i.test(code)) {
    throw new Error('未识别到有效的 JavDB 影片详情结构（需要标题、番号和 movie-panel-info）')
  }

  const dateValue = valueFor(['日期', '發行日期', '发行日期'])
  const releaseDate = dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null
  const durationValue = valueFor(['時長', '时长'])
  const durationMatch = durationValue?.match(/(\d+(?:\.\d+)?)/)
  const rawCover = $('.video-cover').first().attr('src') ?? null
  let coverUrl: string | null = null
  if (rawCover) {
    try {
      const parsed = new URL(rawCover, 'https://javdb.com')
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') coverUrl = parsed.toString()
    } catch { /* Ignore malformed artwork URLs. */ }
  }

  return {
    providerId: `javdb-html:${code.toUpperCase()}`,
    code: code.toUpperCase(),
    title,
    coverUrl,
    releaseDate,
    description: clean($('.video-description, #video-description, .movie-description').first().text()),
    durationMinutes: durationMatch ? Math.round(Number(durationMatch[1])) : null,
    director: valueFor(['導演', '导演']),
    studio: valueFor(['片商', '製作商', '制作商']),
    label: valueFor(['發行', '发行']),
    series: valueFor(['系列']),
    actors: linksFor(['演員', '演员']),
    tags: linksFor(['類別', '类别', '分類', '分类'])
  }
}
