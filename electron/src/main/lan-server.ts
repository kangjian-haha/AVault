import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { Bonjour, type Service } from 'bonjour-service'
import QRCode from 'qrcode'
import { z } from 'zod'
import type { PairingDisplay, PairingPayload, ServerStatus, WatchStatus } from '../shared/contracts'
import type { AppDatabase } from './database'
import { parseByteRange } from './range'

const START_PORT = 42831
const END_PORT = 42840

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/x-m4v', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mov: 'video/quicktime', wmv: 'video/x-ms-wmv', ts: 'video/mp2t'
}

function lanAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) addresses.push(entry.address)
    }
  }
  const unique = [...new Set(addresses)]
  const isPrivateLan = (address: string) => {
    const [first, second] = address.split('.').map(Number)
    return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31
  }
  // Virtual adapters frequently expose benchmark/VPN ranges (for example 198.18.x.x).
  // Put routable private LAN addresses first so QR pairing works from a phone.
  return unique.sort((a, b) => Number(isPrivateLan(b)) - Number(isPrivateLan(a)))
}

function publicMovie(movie: ReturnType<AppDatabase['getMovie']>) {
  if (!movie) return null
  return {
    ...movie,
    coverUrl: movie.coverUrl ? `/api/v1/images/${movie.id}` : null,
    files: movie.files.map(({ path: _path, ...file }) => file)
  }
}

function publicActor(actor: NonNullable<ReturnType<AppDatabase['getActorProfile']>>) {
  return {
    ...actor,
    avatarUrl: actor.avatarUrl ? `/api/v1/actors/${encodeURIComponent(actor.name)}/image` : null
  }
}

export class LanServer {
  private app: FastifyInstance | null = null
  private bonjour: Bonjour | null = null
  private service: Service | null = null
  private pairings = new Map<string, { expiresAt: number; serverId: string }>()
  private status: ServerStatus

  constructor(
    private readonly database: AppDatabase,
    private readonly onStatus: (status: ServerStatus) => void
  ) {
    this.status = {
      running: false,
      serverId: database.getOrCreateServerId(),
      host: null,
      port: null,
      addresses: [],
      error: null
    }
  }

  getStatus(): ServerStatus {
    return { ...this.status, addresses: [...this.status.addresses] }
  }

  private updateStatus(patch: Partial<ServerStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.getStatus())
  }

  async start(): Promise<void> {
    if (this.app) return
    const app = Fastify({ logger: false, bodyLimit: 64 * 1024 })
    this.registerRoutes(app)
    let selectedPort: number | null = null
    let lastError: unknown
    for (let port = START_PORT; port <= END_PORT; port += 1) {
      try {
        await app.listen({ host: '0.0.0.0', port })
        selectedPort = port
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!selectedPort) {
      const message = lastError instanceof Error ? lastError.message : '没有可用的局域网端口'
      this.updateStatus({ running: false, error: message })
      await app.close().catch(() => undefined)
      return
    }
    this.app = app
    const addresses = lanAddresses()
    this.updateStatus({ running: true, port: selectedPort, addresses, host: addresses[0] ?? null, error: null })
    try {
      this.bonjour = new Bonjour()
      this.service = this.bonjour.publish({
        name: `AVault-${this.status.serverId.slice(0, 8)}`,
        type: 'avault',
        protocol: 'tcp',
        port: selectedPort,
        txt: { serverId: this.status.serverId, version: '1' }
      })
    } catch {
      // The API remains usable through the QR address if mDNS is unavailable.
    }
  }

  async stop(): Promise<void> {
    this.service?.stop?.()
    this.bonjour?.destroy()
    this.service = null
    this.bonjour = null
    await this.app?.close()
    this.app = null
    this.updateStatus({ running: false, port: null, host: null, addresses: [] })
  }

  async createPairing(): Promise<PairingDisplay> {
    const status = this.getStatus()
    if (!status.running || !status.host || !status.port) throw new Error('局域网服务未就绪，请检查网络连接')
    const nonce = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + 5 * 60_000
    this.pairings.set(nonce, { expiresAt, serverId: status.serverId })
    for (const [key, value] of this.pairings) if (value.expiresAt <= Date.now()) this.pairings.delete(key)
    const payload: PairingPayload = {
      version: 1,
      serverId: status.serverId,
      host: status.host,
      port: status.port,
      nonce,
      expiresAt: new Date(expiresAt).toISOString()
    }
    return { payload, qrDataUrl: await QRCode.toDataURL(JSON.stringify(payload), { width: 360, margin: 1 }) }
  }

  private authenticate(request: FastifyRequest): boolean {
    const authorization = request.headers.authorization
    if (!authorization?.startsWith('Bearer ')) return false
    return this.database.authenticateToken(authorization.slice(7)) != null
  }

  private registerRoutes(app: FastifyInstance): void {
    app.get('/api/v1/health', async () => ({
      ok: true,
      serverId: this.status.serverId,
      version: 1,
      name: 'AVault'
    }))

    app.post('/api/v1/pair', async (request, reply) => {
      const parsed = z.object({ nonce: z.string().min(16), deviceName: z.string().trim().min(1).max(80) }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: '配对请求格式无效' })
      const pairing = this.pairings.get(parsed.data.nonce)
      if (!pairing || pairing.expiresAt <= Date.now()) {
        this.pairings.delete(parsed.data.nonce)
        return reply.code(401).send({ error: '配对二维码已失效' })
      }
      this.pairings.delete(parsed.data.nonce)
      const token = randomBytes(32).toString('base64url')
      const device = this.database.saveDevice(parsed.data.deviceName, token)
      return { token, deviceId: device.id, serverId: this.status.serverId }
    })

    app.addHook('preHandler', async (request, reply) => {
      const path = request.routeOptions.url
      if (path === '/api/v1/health' || path === '/api/v1/pair') return
      if (!this.authenticate(request)) return reply.code(401).send({ error: '设备未配对或授权已撤销' })
    })

    app.get('/api/v1/libraries', async () => this.database.listLibraries().map(({ path: _path, ...library }) => library))

    app.get('/api/v1/movies', async (request) => {
      const query = z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
        q: z.string().default(''),
        libraryId: z.string().optional(),
        actor: z.string().trim().min(1).optional(),
        tag: z.string().trim().min(1).optional(),
        status: z.enum(['unwatched', 'watching', 'watched']).optional(),
        sourcePartition: z.enum(['censored', 'fc2', 'uncensored', 'leaked', 'unknown']).optional(),
        sort: z.enum(['added-desc', 'added-asc', 'release-desc', 'release-asc', 'code-asc', 'title-asc']).default('added-desc')
      }).parse(request.query)
      const needle = query.q.trim().toLocaleLowerCase()
      let movies = this.database.listMovies().filter((movie) => {
        const searchMatch = !needle || [movie.code, movie.title, ...movie.actors, ...movie.tags].some((value) => value?.toLocaleLowerCase().includes(needle))
        const libraryMatch = !query.libraryId || movie.files.some((file) => file.libraryId === query.libraryId)
        const actorMatch = !query.actor || movie.actors.includes(query.actor)
        const tagMatch = !query.tag || movie.tags.includes(query.tag)
        return searchMatch && libraryMatch && actorMatch && tagMatch && (!query.status || movie.watchStatus === query.status) && (!query.sourcePartition || movie.sourcePartition === query.sourcePartition)
      })
      movies = movies.sort((a, b) => {
        if (query.sort === 'added-asc') return a.createdAt.localeCompare(b.createdAt)
        if (query.sort === 'release-desc') return (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
        if (query.sort === 'release-asc') return (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '')
        if (query.sort === 'code-asc') return (a.code ?? '').localeCompare(b.code ?? '')
        if (query.sort === 'title-asc') return a.title.localeCompare(b.title)
        return b.createdAt.localeCompare(a.createdAt)
      })
      const total = movies.length
      const start = (query.page - 1) * query.pageSize
      return { items: movies.slice(start, start + query.pageSize).map(publicMovie), page: query.page, pageSize: query.pageSize, total }
    })

    app.get('/api/v1/movies/:id', async (request, reply) => {
      const { id } = request.params as { id: string }
      const movie = publicMovie(this.database.getMovie(id))
      return movie ?? reply.code(404).send({ error: '影片不存在' })
    })

    app.get('/api/v1/actors', async () => {
      const names = new Set(this.database.listMovies().flatMap((movie) => movie.actors))
      return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
        const profile = this.database.getActorProfile(name)
        return profile ? publicActor(profile) : { name, avatarUrl: null, category: null, aliases: [], socialLinks: [] }
      })
    })

    app.get('/api/v1/actors/:name', async (request, reply) => {
      const { name } = request.params as { name: string }
      const isKnown = this.database.listMovies().some((movie) => movie.actors.includes(name))
      if (!isKnown) return reply.code(404).send({ error: '演员不存在' })
      const profile = this.database.getActorProfile(name)
      return profile ? publicActor(profile) : { name, avatarUrl: null, category: null, aliases: [], socialLinks: [] }
    })

    app.get('/api/v1/actors/:name/image', async (request, reply) => {
      const { name } = request.params as { name: string }
      const path = this.database.getActorAvatarPath(name)
      if (!path || !existsSync(path)) return reply.code(404).send({ error: '演员头像不存在' })
      return reply.type(path.toLowerCase().endsWith('.png') ? 'image/png' : path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')
        .header('Cache-Control', 'private, max-age=86400').send(createReadStream(path))
    })

    app.get('/api/v1/tags', async () => {
      const counts = new Map<string, number>()
      for (const movie of this.database.listMovies()) for (const tag of movie.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, movieCount]) => ({ name, movieCount }))
    })

    app.get('/api/v1/images/:id', async (request, reply) => {
      const { id } = request.params as { id: string }
      const path = this.database.getCoverPath(id)
      if (!path || !existsSync(path)) return reply.code(404).send({ error: '封面不存在' })
      return reply.type(path.toLowerCase().endsWith('.png') ? 'image/png' : path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg')
        .header('Cache-Control', 'private, max-age=86400').send(createReadStream(path))
    })

    app.get('/api/v1/files/:id/stream', async (request, reply) => {
      const { id } = request.params as { id: string }
      const file = this.database.getFile(id)
      const library = file ? this.database.getLibrary(file.libraryId) : null
      if (!file || !library || !file.available || !existsSync(file.path)) return reply.code(404).send({ error: '影片文件不可用' })
      const relativePath = relative(resolve(library.path), resolve(file.path))
      if (relativePath.startsWith('..') || relativePath === '') return reply.code(403).send({ error: '文件不属于媒体目录' })
      const info = await stat(file.path)
      reply.header('Accept-Ranges', 'bytes').type(MIME_TYPES[file.extension] ?? 'application/octet-stream')
      try {
        const range = parseByteRange(request.headers.range, info.size)
        if (!range) return reply.header('Content-Length', info.size).send(createReadStream(file.path))
        return reply.code(206)
          .header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)
          .header('Content-Length', range.length)
          .send(createReadStream(file.path, { start: range.start, end: range.end }))
      } catch (error) {
        if (error instanceof RangeError) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send()
        throw error
      }
    })

    app.put('/api/v1/movies/:id/progress', async (request, reply) => {
      const { id } = request.params as { id: string }
      if (!this.database.getMovie(id)) return reply.code(404).send({ error: '影片不存在' })
      const body = z.object({
        progressSeconds: z.number().min(0),
        durationSeconds: z.number().min(0),
        status: z.enum(['unwatched', 'watching', 'watched']).optional()
      }).parse(request.body)
      this.database.updateProgress(id, body.progressSeconds, body.durationSeconds, body.status as WatchStatus | undefined)
      return { ok: true }
    })
  }
}
