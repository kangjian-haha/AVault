import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JavBusNotFoundError, JavBusProvider, parseJavBusActorMovieCount, parseJavBusActorSearch, parseJavBusDetails, parseJavBusSearch } from './javbus'

describe('JavBus parser', () => {
  it('parses search candidates', () => {
    const html = `
      <a class="movie-box" href="https://www.javbus.com/ABP-123">
        <div class="photo-frame"><img src="/pics/thumb/example.jpg" title="示例影片" /></div>
        <div class="photo-info"><span><date>ABP-123</date><date>2024-01-02</date></span></div>
      </a>`
    expect(parseJavBusSearch('https://www.javbus.com', html)).toEqual([{
      providerId: 'ABP-123',
      code: 'ABP-123',
      title: '示例影片',
      coverUrl: 'https://www.javbus.com/pics/thumb/example.jpg',
      releaseDate: '2024-01-02'
    }])
  })

  it('parses detail metadata', () => {
    const html = `
      <h3>ABP-123  示例影片完整标题</h3>
      <a class="bigImage" href="/pics/cover/example_b.jpg"><img /></a>
      <div class="info">
        <p><span>識別碼:</span> ABP-123</p>
        <p><span>發行日期:</span> 2024-01-02</p>
        <p><span>長度:</span> 120分鐘</p>
        <p><span>導演:</span> 示例导演</p>
        <p><span>製作商:</span> 示例制作商</p>
        <p><span>發行商:</span> 示例发行商</p>
        <p><span>系列:</span> 示例系列</p>
      </div>
      <div class="star-name"><a>演员甲</a></div>
      <span class="genre"><a>标签甲</a></span>`
    expect(parseJavBusDetails('https://www.javbus.com', 'ABP-123', html)).toMatchObject({
      providerId: 'ABP-123', code: 'ABP-123', title: '示例影片完整标题',
      coverUrl: 'https://www.javbus.com/pics/cover/example_b.jpg', releaseDate: '2024-01-02',
      durationMinutes: 120, director: '示例导演', studio: '示例制作商', label: '示例发行商',
      series: '示例系列', actors: ['演员甲'], tags: ['标签甲']
    })
  })

  it('only removes a matching code at the beginning of a detail title', () => {
    const html = `
      <h3>特别企划 ABP-123 完整标题</h3>
      <div class="info"><p><span>識別碼:</span> ABP-123</p></div>`
    expect(parseJavBusDetails('https://www.javbus.com', 'ABP-123', html).title)
      .toBe('特别企划 ABP-123 完整标题')
  })

  it('parses uncensored detail metadata without mixing actors into genres', () => {
    const html = `
      <h3>TH101-140-112594 ノーパン中出しホームヘルパー</h3>
      <div class="row movie"><div class="col-md-3 info">
        <p><span class="header">識別碼:</span> <span>th101-140-112594</span></p>
        <p><span class="header">發行日期:</span> 2019-04-27</p>
        <p><span class="header">長度:</span> 70分鐘</p>
        <p><span class="header">製作商:</span> <a href="/uncensored/studio/3j">東京熱</a></p>
        <p><span class="header">發行商:</span> <a href="/label/v">EMPIRE</a></p>
        <p><span class="genre"><a href="/uncensored/genre/gre083">口交</a></span></p>
        <div class="star-box"><a href="/uncensored/star/3nr"><img title="琥珀うた"></a><div class="star-name"><a href="/uncensored/star/3nr">琥珀うた</a></div></div>
        <p><span class="genre"><a href="/uncensored/star/3nr">琥珀うた</a></span></p>
      </div></div>`
    expect(parseJavBusDetails('https://www.javbus.com', 'th101-140-112594', html)).toMatchObject({
      code: 'TH101-140-112594',
      title: 'ノーパン中出しホームヘルパー',
      releaseDate: '2019-04-27',
      durationMinutes: 70,
      studio: '東京熱',
      label: 'EMPIRE',
      actors: ['琥珀うた'],
      tags: ['口交']
    })
  })

  it('parses actor search results and profile movie count', () => {
    const html = `<a class="avatar-box text-center" href="https://www.javbus.com/star/10xw"><img src="/pics/actress/10xw_a.jpg" title="五日市芽依"><span>五日市芽依<button>有码</button></span></a>`
    expect(parseJavBusActorSearch('https://www.javbus.com', html)).toEqual([{
      name: '五日市芽依', providerId: '10xw', avatarUrl: 'https://www.javbus.com/pics/actress/10xw_a.jpg',
      category: '有码', providerMovieCount: null
    }])
    expect(parseJavBusActorMovieCount('<p>全部影片 285 部</p>')).toBe(285)
  })

  it('reuses detail-page cookies and referer when downloading a cover', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'avault-javbus-'))
    const server = createServer((request, response) => {
      if (request.url === '/search/ABP-123&type=1') {
        response.setHeader('set-cookie', ['PHPSESSID=test-session; Path=/', 'existmag=all; Path=/'])
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end('<a class="movie-box" href="/ABP-123"><img src="/pics/thumb/test.jpg" title="测试影片" /><div class="photo-info"><date>ABP-123</date><date>2024-01-02</date></div></a>')
        return
      }
      if (request.url === '/ABP-123') {
        response.setHeader('set-cookie', ['PHPSESSID=test-session; Path=/', 'existmag=all; Path=/'])
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end('<h3>测试影片</h3><a class="bigImage" href="/pics/cover/test.jpg"><img /></a><div class="info"><p><span>識別碼:</span> ABP-123</p></div>')
        return
      }
      if (request.url === '/pics/thumb/test.jpg') {
        const validCookie = request.headers.cookie?.includes('PHPSESSID=test-session') && request.headers.cookie?.includes('existmag=all')
        const validReferer = request.headers.referer?.endsWith('/search/ABP-123&type=1')
        if (!validCookie || !validReferer) { response.statusCode = 403; response.end('forbidden'); return }
        response.setHeader('content-type', 'image/jpeg')
        response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
        return
      }
      if (request.url === '/pics/cover/test.jpg') {
        const validCookie = request.headers.cookie?.includes('PHPSESSID=test-session') && request.headers.cookie?.includes('existmag=all')
        const validReferer = request.headers.referer?.endsWith('/ABP-123')
        if (!validCookie || !validReferer) { response.statusCode = 403; response.end('forbidden'); return }
        response.setHeader('content-type', 'image/jpeg')
        response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not start')
      const provider = new JavBusProvider(`http://127.0.0.1:${address.port}`, cacheDirectory)
      const candidates = await provider.search('ABP-123')
      expect(candidates[0].previewDataUrl).toBe('data:image/jpeg;base64,/9j/2Q==')
      const details = await provider.getDetails('ABP-123')
      const coverPath = await provider.cacheCover(cacheDirectory, 'movie-id.avault-cover', details.coverUrl)
      expect(coverPath).not.toBeNull()
      expect(await readFile(coverPath!)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })

  it('falls back to the language-prefixed detail route when Cloudflare rejects the bare route', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'avault-javbus-localized-'))
    const requested: string[] = []
    const server = createServer((request, response) => {
      requested.push(request.url ?? '')
      if (request.url === '/ABP-123') {
        response.statusCode = 403
        response.end('cloudflare forbidden')
        return
      }
      if (request.url === '/ja/ABP-123') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end('<h3>测试影片</h3><div class="info"><p><span>識別碼:</span> ABP-123</p></div>')
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not start')
      const provider = new JavBusProvider(`http://127.0.0.1:${address.port}`, cacheDirectory)
      const details = await provider.getDetails('ABP-123')
      expect(details.code).toBe('ABP-123')
      expect(requested).toEqual(['/ABP-123', '/ja/ABP-123'])
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })

  it('uses the uncensored search and detail routes for uncensored movies', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'avault-javbus-uncensored-'))
    const requested: string[] = []
    const server = createServer((request, response) => {
      requested.push(request.url ?? '')
      response.setHeader('content-type', 'text/html; charset=utf-8')
      if (request.url === '/uncensored/search/TH101-140-112594') {
        response.end('<a class="movie-box" href="/th101-140-112594"><img title="测试影片" /><div class="photo-info"><date>TH101-140-112594</date></div></a>')
        return
      }
      if (request.url === '/th101-140-112594') {
        response.end('<h3>TH101-140-112594 测试影片</h3><div class="info"><p><span>識別碼:</span> TH101-140-112594</p></div>')
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not start')
      const provider = new JavBusProvider(`http://127.0.0.1:${address.port}`, cacheDirectory)
      const candidates = await provider.search('TH101-140-112594', 'uncensored')
      expect(candidates[0]?.providerId).toBe('th101-140-112594')
      const details = await provider.getDetails(candidates[0].providerId, 'uncensored')
      expect(details.title).toBe('测试影片')
      expect(requested).toEqual(['/uncensored/search/TH101-140-112594', '/th101-140-112594'])
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })

  it('identifies a JavBus 404 detail page as an unlisted movie', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'avault-javbus-not-found-'))
    const server = createServer((_request, response) => {
      response.statusCode = 404
      response.end('<div class="alert alert-danger alert-page error-page"><h4>404 Page Not Found!</h4></div>')
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not start')
      const provider = new JavBusProvider(`http://127.0.0.1:${address.port}`, cacheDirectory)
      await expect(provider.getDetails('SIRO-4502')).rejects.toBeInstanceOf(JavBusNotFoundError)
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })
})
