import { describe, expect, it } from 'vitest'
import { parseJavDbHtml } from './javdb-html'

const fragment = `
<h2 class="title is-4"><strong>MFC-125 </strong><strong class="current-title">测试影片标题</strong></h2>
<div class="video-meta-panel"><img class="video-cover" src="https://c0.jdbstatic.com/covers/2r/2R48X.jpg"></div>
<nav class="panel movie-panel-info">
 <div class="panel-block"><strong>番號:</strong><span class="value"><a>MFC</a>-125</span></div>
 <div class="panel-block"><strong>日期:</strong><span class="value">2021-07-21</span></div>
 <div class="panel-block"><strong>時長:</strong><span class="value">87 分鍾</span></div>
 <div class="panel-block"><strong>片商:</strong><span class="value"><a>MOON FORCE</a></span></div>
 <div class="panel-block"><strong>發行:</strong><span class="value"><a>MOON FORCE</a></span></div>
 <div class="panel-block"><strong>導演:</strong><span class="value"><a>测试导演</a></span></div>
 <div class="panel-block"><strong>類別:</strong><span class="value"><a>業餘</a><a>中出</a><a>美少女</a></span></div>
 <div class="panel-block"><strong>演員:</strong><span class="value"><a>椎名ほのか</a><a>ぴょんちゃん</a></span></div>
</nav>`

describe('parseJavDbHtml', () => {
  it('parses a JavDB detail fragment', () => {
    const details = parseJavDbHtml(fragment)
    expect(details).toMatchObject({ code: 'MFC-125', title: '测试影片标题', releaseDate: '2021-07-21', durationMinutes: 87, studio: 'MOON FORCE', label: 'MOON FORCE', director: '测试导演' })
    expect(details.actors).toEqual(['椎名ほのか', 'ぴょんちゃん'])
    expect(details.tags).toEqual(['業餘', '中出', '美少女'])
    expect(details.coverUrl).toBe('https://c0.jdbstatic.com/covers/2r/2R48X.jpg')
  })

  it('accepts a complete document and leaves unavailable optional fields empty', () => {
    const details = parseJavDbHtml(`<!doctype html><html><body>${fragment.replace(/<div class="panel-block"><strong>導演:[\s\S]*?<\/div>/, '')}</body></html>`)
    expect(details.code).toBe('MFC-125')
    expect(details.director).toBeNull()
    expect(details.series).toBeNull()
    expect(details.description).toBe('')
  })

  it('rejects non-JavDB or oversized markup', () => {
    expect(() => parseJavDbHtml('<h1>not a movie</h1>')).toThrow('未识别到有效的 JavDB')
    expect(() => parseJavDbHtml('x'.repeat(5 * 1024 * 1024 + 1))).toThrow('不能超过 5 MB')
  })
})
