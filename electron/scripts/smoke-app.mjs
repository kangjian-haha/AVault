import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const executable = join(root, 'release', 'win-unpacked', 'AVault.exe')
const userData = join(root, 'release', 'smoke-ui')
const sampleLibrary = join(root, 'release', 'smoke-library')
await mkdir(userData, { recursive: true })
await mkdir(sampleLibrary, { recursive: true })
await writeFile(join(sampleLibrary, 'ABP-123-CD1-1080p.mp4'), Buffer.alloc(100, 1))
await writeFile(join(sampleLibrary, 'ABP-123-CD2-1080p.mp4'), Buffer.alloc(100, 2))

const child = spawn(executable, ['--headless', '--remote-debugging-port=9333', `--user-data-dir=${userData}`, `--smoke-library=${sampleLibrary}`], {
  stdio: 'ignore',
  windowsHide: true
})

async function findPage() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    try {
      const response = await fetch('http://127.0.0.1:9333/json')
      const pages = await response.json()
      const page = pages.find((candidate) => candidate.type === 'page')
      if (page) return page
    } catch {
      // The renderer is still starting.
    }
  }
  throw new Error('Renderer debugging endpoint did not appear')
}

async function evaluate(url, expression) {
  return new Promise((resolveResult, reject) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => reject(new Error('Renderer evaluation timed out')), 10_000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true
      }
    })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails)))
      else resolveResult(message.result.result.value)
    })
    socket.addEventListener('error', () => reject(new Error('Could not connect to renderer CDP endpoint')))
  })
}

try {
  const page = await findPage()
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))
  const result = await evaluate(page.webSocketDebuggerUrl, `(async () => {
    const snapshot = await window.avault.getSnapshot()
    const pairing = await window.avault.createPairing()
    return {
      title: document.title,
      hasBridge: typeof window.avault === 'object',
      serverRunning: snapshot.server.running,
      libraryCount: snapshot.libraries.length,
      movieCount: snapshot.movies.length,
      groupedFileCount: snapshot.movies[0]?.files.length ?? 0,
      renderedText: document.body.innerText.slice(0, 160),
      pairing: pairing.payload
    }
  })()`)
  const baseUrl = `http://127.0.0.1:${result.pairing.port}/api/v1`
  const unauthorizedStatus = (await fetch(`${baseUrl}/movies`)).status
  const pairResponse = await fetch(`${baseUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce: result.pairing.nonce, deviceName: 'Smoke Android' })
  })
  const paired = await pairResponse.json()
  const authHeaders = { authorization: `Bearer ${paired.token}` }
  const moviesResponse = await fetch(`${baseUrl}/movies`, { headers: authHeaders })
  const movies = await moviesResponse.json()
  const streamResponse = await fetch(`${baseUrl}/files/${movies.items[0].files[0].id}/stream`, {
    headers: { ...authHeaders, range: 'bytes=10-19' }
  })
  const streamBytes = new Uint8Array(await streamResponse.arrayBuffer())
  await evaluate(page.webSocketDebuggerUrl, `(async () => {
    const snapshot = await window.avault.getSnapshot()
    await window.avault.revokeDevice(snapshot.devices.find((device) => device.name === 'Smoke Android').id)
    return true
  })()`)
  const revokedStatus = (await fetch(`${baseUrl}/movies`, { headers: authHeaders })).status
  let liveCover = null
  if (process.env.AVAULT_LIVE_JAVBUS === '1') {
    liveCover = await evaluate(page.webSocketDebuggerUrl, `(async () => {
      const snapshot = await window.avault.getSnapshot()
      const candidates = await window.avault.lookupMetadata(snapshot.movies[0].id)
      const movie = await window.avault.applyMetadata(snapshot.movies[0].id, 'WAAA-636', 'overwrite')
      return { title: movie.title, coverUrl: movie.coverUrl, candidatePreview: candidates[0]?.previewDataUrl?.startsWith('data:image/') === true }
    })()`)
    if (!liveCover?.coverUrl || !liveCover.candidatePreview) throw new Error('Live JavBus cover or candidate preview was not available')
  }
  const report = {
    ...result,
    pairing: undefined,
    unauthorizedStatus,
    pairStatus: pairResponse.status,
    movieApiStatus: moviesResponse.status,
    rangeStatus: streamResponse.status,
    rangeLength: streamBytes.length,
    revokedStatus,
    liveCover
  }
  console.log(JSON.stringify(report))
  if (!result.hasBridge || !result.serverRunning || result.libraryCount !== 1 || result.movieCount !== 1 || result.groupedFileCount !== 2 || !result.renderedText.includes('AVault') || unauthorizedStatus !== 401 || pairResponse.status !== 200 || moviesResponse.status !== 200 || streamResponse.status !== 206 || streamBytes.length !== 10 || revokedStatus !== 401) {
    throw new Error('Packaged app smoke assertions failed')
  }
} finally {
  child.kill()
}
