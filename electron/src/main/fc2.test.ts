import { describe, expect, it } from 'vitest'
import { fc2ArticleId, parseFc2Details } from './fc2'

describe('FC2 metadata parser', () => {
  it('normalizes FC2-PPV codes from common filenames', () => {
    expect(fc2ArticleId('FC2-PPV-1234567')).toBe('1234567')
    expect(fc2ArticleId('hhd800.com@fc2ppv_1234567.mp4')).toBe('1234567')
    expect(fc2ArticleId('ABP-123')).toBeNull()
  })

  it('parses public FC2 article metadata', () => {
    const html = `
      <html><head><meta property="og:image" content="/images/cover.jpg" /><meta name="description" content="测试简介" /></head><body>
        <div id="top"><div class="items_article_left"><section class="items_article_header"><div><section><div class="items_article_headerInfo"><h3><span style="zoom: 0.01; color: #fff; width: 1px; height: 1px; display: inline-block; overflow: hidden;">znoqnxxxqz</span>FC2 测试影片</h3></div></section></div></section></div></div>
        <div class="items_article_Description">完整的影片简介</div>
        <div class="items_article_headerInfo"><div></div><div></div><div></div><div></div><div><p>販売日 2025/04/03</p></div><ul><li class="items_article_writer"><a>测试作者</a></li></ul></div>
        <div class="items_article_MainitemThumb"><span><p>01:18:20</p></span></div>
        <a href="/tags/example">标签甲</a><a href="/tags/example-2">标签乙</a>
      </body></html>`
    expect(parseFc2Details('https://adult.contents.fc2.com', '1234567', html)).toMatchObject({
      providerId: 'fc2:1234567', code: 'FC2-PPV-1234567', title: 'FC2 测试影片',
      coverUrl: 'https://adult.contents.fc2.com/images/cover.jpg', releaseDate: '2025-04-03',
      description: '完整的影片简介', durationMinutes: 78, director: '测试作者', studio: 'FC2', actors: ['测试作者'], tags: ['标签甲', '标签乙']
    })
  })

  it('does not treat an FC2 portal title as an article title', () => {
    expect(() => parseFc2Details(
      'https://adult.contents.fc2.com',
      '4828968',
      '<html><head><title>FC2 total Web Solutions</title></head><body><h1>FC2 total Web Solutions</h1></body></html>'
    )).toThrow('FC2 商品页没有返回可用的标题')
  })
})
