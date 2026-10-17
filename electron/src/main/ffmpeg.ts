import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, extname, join } from 'node:path'
import { rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { FfmpegStatus, MediaInfo, ToolEncodeOptions, ToolTask, TranscodeKind, TranscodeProgress } from '../shared/contracts'

const execFileAsync = promisify(execFile)

type ProbeStream = { codec_type?: string; codec_name?: string; codec_tag_string?: string; profile?: string; tags?: Record<string, string>; width?: number; height?: number; avg_frame_rate?: string; bit_rate?: string; pix_fmt?: string; color_transfer?: string; channels?: number }
type ProbeResult = { format?: { format_name?: string; duration?: string; bit_rate?: string }; streams?: ProbeStream[] }

export function validateAppleHevcOutput(result: ProbeResult, audioExpected: boolean): void {
  const video = result.streams?.find((stream) => stream.codec_type === 'video')
  const audio = result.streams?.find((stream) => stream.codec_type === 'audio')
  if (!result.format?.format_name?.split(',').includes('mp4') || video?.codec_name !== 'hevc' || video.codec_tag_string !== 'hvc1' || video.profile !== 'Main' || video.pix_fmt !== 'yuv420p' ||
    (audioExpected && !audio) || (audio && (audio.codec_name !== 'aac' || audio.profile !== 'LC' || audio.channels !== 2))) {
    throw new Error('转码输出不符合 Apple HEVC 格式要求（MP4 / hvc1 / Main 8-bit / AAC-LC 双声道）')
  }
}

function numeric(value: string | undefined): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function frameRate(value: string | undefined): number | null {
  if (!value || value === '0/0') return null
  const [numerator, denominator] = value.split('/').map(Number)
  const rate = denominator ? numerator / denominator : numerator
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) / 100 : null
}

export function formatCutTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join('-')
}

export function parseProbe(result: ProbeResult): MediaInfo {
  const video = result.streams?.find((stream) => stream.codec_type === 'video')
  const audio = result.streams?.find((stream) => stream.codec_type === 'audio')
  return {
    container: result.format?.format_name?.split(',')[0] ?? null,
    videoCodec: video?.codec_name ?? null,
    videoProfile: video?.profile ?? null,
    videoEncoder: video?.tags?.encoder ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    frameRate: frameRate(video?.avg_frame_rate),
    videoBitrate: numeric(video?.bit_rate) ?? numeric(result.format?.bit_rate),
    pixelFormat: video?.pix_fmt ?? null,
    hdr: Boolean(video?.color_transfer && !['bt709', 'unknown', 'unspecified'].includes(video.color_transfer.toLowerCase())),
    audioCodec: audio?.codec_name ?? null,
    audioBitrate: numeric(audio?.bit_rate),
    audioChannels: audio?.channels ?? null,
    durationSeconds: numeric(result.format?.duration)
  }
}

export class FfmpegService {
  private status: FfmpegStatus = { available: false, nvencAvailable: false, ffmpegPath: null, ffprobePath: null, version: null, message: '尚未检测' }
  private active: ReturnType<typeof spawn> | null = null

  async detect(): Promise<FfmpegStatus> {
    try {
      const version = await execFileAsync('ffmpeg.exe', ['-version'], { windowsHide: true })
      const encoders = await execFileAsync('ffmpeg.exe', ['-hide_banner', '-encoders'], { windowsHide: true })
      await execFileAsync('ffprobe.exe', ['-version'], { windowsHide: true })
      this.status = {
        available: true, nvencAvailable: /\bhevc_nvenc\b/.test(encoders.stdout),
        ffmpegPath: 'ffmpeg.exe', ffprobePath: 'ffprobe.exe',
        version: version.stdout.split(/\r?\n/)[0]?.trim() ?? null,
        message: /\bhevc_nvenc\b/.test(encoders.stdout) ? null : '已找到 FFmpeg，但未检测到 NVIDIA HEVC 编码器'
      }
    } catch {
      this.status = { available: false, nvencAvailable: false, ffmpegPath: null, ffprobePath: null, version: null, message: '未在系统 PATH 中找到可用的 ffmpeg.exe 或 ffprobe.exe' }
    }
    return this.status
  }

  getStatus(): FfmpegStatus { return this.status }

  async analyze(filePath: string): Promise<MediaInfo | null> {
    if (!this.status.available) return null
    try {
      const { stdout } = await execFileAsync('ffprobe.exe', ['-v', 'error', '-show_entries', 'format=format_name,duration,bit_rate:stream=codec_type,codec_name,profile,width,height,avg_frame_rate,bit_rate,pix_fmt,color_transfer,channels:stream_tags=encoder', '-of', 'json', filePath], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      return parseProbe(JSON.parse(stdout) as ProbeResult)
    } catch { return null }
  }

  outputPath(inputPath: string, kind: TranscodeKind): string {
    const extension = extname(inputPath)
    // A 720p version may be created from an existing HEVC master after the
    // original has been replaced. Remove prior AVault version suffixes so the
    // final name still represents one clean alternative of the same source.
    const stem = basename(inputPath, extension).replace(/\s*\[(?:HEVC|720p HEVC)\]\s*/gi, ' ').trim()
    return join(dirname(inputPath), `${stem} [${kind === 'hevc' ? 'HEVC' : '720p HEVC'}].mp4`)
  }

  previewPath(inputPath: string): string {
    const extension = extname(inputPath)
    const stem = basename(inputPath, extension).replace(/\s*\[(?:HEVC|720p HEVC)\]\s*/gi, ' ').trim()
    return join(dirname(inputPath), `${stem}.avault-preview.jpg`)
  }

  async generatePreview(inputPath: string, onCommand?: (command: string) => void): Promise<{ outputPath: string }> {
    if (!this.status.available) throw new Error(this.status.message ?? 'FFmpeg 不可用')
    if (this.active) throw new Error('已有 FFmpeg 任务正在运行')
    const info = await this.analyze(inputPath)
    const duration = info?.durationSeconds
    if (!duration || duration < 2) throw new Error('无法读取足够的影片时长，不能生成预览图')
    const outputPath = this.previewPath(inputPath)
    const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.tmp.jpg`)
    const timestamps = [0.08, 0.24, 0.4, 0.56, 0.72, 0.88].map((ratio) => Math.max(0, Math.min(duration - 0.1, duration * ratio)).toFixed(3))
    const args = ['-y']
    for (const timestamp of timestamps) args.push('-ss', timestamp, '-i', inputPath)
    const filters = timestamps.map((_, index) => `[${index}:v:0]scale=320:-2:flags=lanczos,setpts=PTS-STARTPTS[v${index}]`)
    filters.push('[v0][v1][v2]hstack=inputs=3[top]', '[v3][v4][v5]hstack=inputs=3[bottom]', '[top][bottom]vstack=inputs=2[preview]')
    args.push('-filter_complex', filters.join(';'), '-map', '[preview]', '-frames:v', '1', '-q:v', '2', '-an', temporaryPath)
    onCommand?.(`ffmpeg.exe ${args.map((arg) => /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ')}`)
    await rm(temporaryPath, { force: true })
    try {
      await this.run(args, null, () => undefined)
      if (!existsSync(temporaryPath)) throw new Error('FFmpeg 未生成预览图')
      await rm(outputPath, { force: true })
      await rename(temporaryPath, outputPath)
      return { outputPath }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      this.active = null
    }
  }

  async transcode(inputPath: string, fileId: string, kind: TranscodeKind, onProgress: (progress: Omit<TranscodeProgress, 'fileId' | 'kind'>) => void, onCommand?: (command: string) => void): Promise<{ outputPath: string; mediaInfo: MediaInfo }> {
    if (!this.status.available || !this.status.nvencAvailable) throw new Error(this.status.message ?? 'NVIDIA HEVC 转码不可用')
    if (this.active) throw new Error('已有转码任务正在运行')
    const sourceInfo = await this.analyze(inputPath)
    const outputPath = this.outputPath(inputPath, kind)
    const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${fileId}.tmp.mp4`)
    if (existsSync(outputPath)) throw new Error('目标转码版本已存在，不会覆盖已有文件')
    const args = ['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0', '-c:v', 'hevc_nvenc', '-profile:v', 'main', '-tier:v', 'main', '-preset', 'p5', '-tune', 'hq', '-rc:v', 'vbr', '-cq:v', '28', '-spatial_aq', '1', '-aq-strength', '8', '-rc-lookahead', '16', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1']
    if (kind === 'hevc-720p') args.push('-vf', "scale=-2:'min(720,ih)'")
    args.push('-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporaryPath)
    onCommand?.(`ffmpeg.exe ${args.map((arg) => /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ')}`)
    await rm(temporaryPath, { force: true })
    let duration = sourceInfo?.durationSeconds ?? null
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('ffmpeg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        this.active = child
        let buffer = ''
        child.stdout?.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''
          const values: Record<string, string> = {}
          for (const line of lines) { const index = line.indexOf('='); if (index > 0) values[line.slice(0, index)] = line.slice(index + 1) }
          const rawTime = values.out_time_us ?? values.out_time_ms
          if (rawTime && duration) {
            const seconds = Number(rawTime) / 1_000_000
            const percent = Math.min(100, Math.max(0, seconds / duration * 100))
            const speed = values.speed ?? null
            const multiplier = speed ? Number(speed.replace('x', '')) : NaN
            onProgress({ state: 'running', percent, speed, etaSeconds: Number.isFinite(multiplier) && multiplier > 0 ? Math.max(0, (duration - seconds) / multiplier) : null })
          }
        })
        child.on('error', reject)
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(code === null ? '转码已取消' : `FFmpeg 转码失败（退出码 ${code}）`)))
      })
      const mediaInfo = await this.analyze(temporaryPath)
      if (!mediaInfo?.videoCodec || !mediaInfo.durationSeconds || (duration && Math.abs(mediaInfo.durationSeconds - duration) > Math.max(10, duration * 0.1))) throw new Error('转码文件校验失败')
      const { stdout } = await execFileAsync('ffprobe.exe', ['-v', 'error', '-show_entries', 'format=format_name:stream=codec_type,codec_name,codec_tag_string,profile,pix_fmt,channels', '-of', 'json', temporaryPath], { windowsHide: true })
      validateAppleHevcOutput(JSON.parse(stdout) as ProbeResult, Boolean(sourceInfo?.audioCodec))
      await rename(temporaryPath, outputPath)
      onProgress({ state: 'completed', percent: 100, speed: null, etaSeconds: 0, outputPath })
      return { outputPath, mediaInfo }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally { this.active = null; duration = null }
  }

  cancel(): void { this.active?.kill() }

  toolOutputPath(inputPath: string, suffix: string): string {
    const stem = basename(inputPath, extname(inputPath)).replace(/\s*\[工具[^\]]*\]\s*/gi, ' ').trim()
    return join(dirname(inputPath), `${stem} [工具 ${suffix}].mp4`)
  }

  private encodeArgs(options: ToolEncodeOptions): string[] {
    const encoder = options.codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc'
    const args = ['-c:v', encoder, '-preset', 'p5', '-tune', 'hq', '-rc:v', 'vbr', '-cq:v', String(options.cq), '-spatial_aq', '1', '-aq-strength', '8', '-rc-lookahead', '16', '-pix_fmt', 'yuv420p']
    if (options.maxBitrateKbps) args.push('-maxrate:v', `${options.maxBitrateKbps}k`, '-bufsize:v', `${options.maxBitrateKbps * 2}k`)
    if (options.codec === 'hevc') args.push('-tag:v', 'hvc1')
    if (options.height) args.push('-vf', `scale=-2:min(${options.height}\\,ih)`)
    if (options.frameRate) args.push('-r', options.frameRate, '-fps_mode', 'cfr')
    return args
  }

  async toolTranscode(inputPath: string, options: ToolEncodeOptions, onProgress: (progress: Omit<ToolTask, 'id' | 'type' | 'inputPaths' | 'outputName' | 'options'>) => void, onCommand?: (command: string) => void): Promise<{ outputPath: string }> {
    if (!this.status.available || !this.status.nvencAvailable) throw new Error(this.status.message ?? 'NVIDIA 编码器不可用')
    if (this.active) throw new Error('已有 FFmpeg 任务正在运行')
    const suffix = `${options.codec === 'hevc' ? 'H265' : 'H264'}${options.height ? ` ${options.height}p` : ' 原分辨率'} CQ${options.cq}`
    const outputPath = this.toolOutputPath(inputPath, suffix)
    if (existsSync(outputPath)) throw new Error(`目标文件已存在：${basename(outputPath)}`)
    const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.tmp.mp4`)
    const sourceInfo = await this.analyze(inputPath)
    const duration = sourceInfo?.durationSeconds ?? null
    const args = ['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?', ...this.encodeArgs(options), '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporaryPath]
    onCommand?.(`ffmpeg.exe ${args.map((arg) => /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ')}`)
    try {
      await this.run(args, duration, onProgress)
      const info = await this.analyze(temporaryPath)
      if (!info?.videoCodec || !info.durationSeconds) throw new Error('转码文件校验失败')
      await rename(temporaryPath, outputPath)
      return { outputPath }
    } catch (error) { await rm(temporaryPath, { force: true }).catch(() => undefined); throw error }
    finally { this.active = null }
  }

  cutOutputPath(inputPath: string, startSeconds: number, endSeconds: number): string {
    const stem = basename(inputPath, extname(inputPath)).replace(/\s*\[剪切[^\]]*\]\s*/gi, ' ').trim()
    const suffix = `[剪切 ${formatCutTimestamp(startSeconds)} 至 ${formatCutTimestamp(endSeconds)}]`
    let attempt = 1
    let outputPath = join(dirname(inputPath), `${stem} ${suffix}.mp4`)
    while (existsSync(outputPath)) {
      attempt += 1
      outputPath = join(dirname(inputPath), `${stem} ${suffix} (${attempt}).mp4`)
    }
    return outputPath
  }

  async cut(inputPath: string, startSeconds: number, endSeconds: number, mode: 'copy' | 'transcode', options: ToolEncodeOptions | null, onProgress: (progress: Pick<ToolTask, 'state' | 'percent' | 'speed' | 'etaSeconds'>) => void, onCommand?: (command: string) => void): Promise<{ outputPath: string }> {
    if (!this.status.available) throw new Error(this.status.message ?? 'FFmpeg 不可用')
    if (mode === 'transcode' && !this.status.nvencAvailable) throw new Error(this.status.message ?? 'NVIDIA 编码器不可用')
    if (this.active) throw new Error('已有 FFmpeg 任务正在运行')
    const sourceInfo = await this.analyze(inputPath)
    const sourceDuration = sourceInfo?.durationSeconds
    if (!sourceDuration || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > sourceDuration + 0.01) throw new Error('剪切时间范围无效')
    const duration = endSeconds - startSeconds
    const outputPath = this.cutOutputPath(inputPath, startSeconds, endSeconds)
    const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.tmp.mp4`)
    const time = (value: number) => value.toFixed(3)
    const args = mode === 'copy'
      ? ['-y', '-ss', time(startSeconds), '-i', inputPath, '-t', time(duration), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporaryPath]
      : ['-y', '-i', inputPath, '-ss', time(startSeconds), '-t', time(duration), '-map', '0:v:0', '-map', '0:a:0?', ...this.encodeArgs(options!), '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporaryPath]
    onCommand?.(`ffmpeg.exe ${args.map((arg) => /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ')}`)
    try {
      await this.run(args, duration, onProgress)
      const info = await this.analyze(temporaryPath)
      if (!info?.videoCodec || !info.durationSeconds) throw new Error('剪切文件校验失败')
      await rename(temporaryPath, outputPath)
      return { outputPath }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally { this.active = null }
  }

  private async run(args: string[], duration: number | null, onProgress: (progress: Pick<ToolTask, 'state' | 'percent' | 'speed' | 'etaSeconds'>) => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); this.active = child
      let buffer = ''
      child.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; const values: Record<string, string> = {}; for (const line of lines) { const index = line.indexOf('='); if (index > 0) values[line.slice(0, index)] = line.slice(index + 1) }; const seconds = Number(values.out_time_us ?? values.out_time_ms) / 1_000_000; if (duration && Number.isFinite(seconds)) { const speed = values.speed ?? null; const multiplier = speed ? Number(speed.replace('x', '')) : NaN; onProgress({ state: 'running', percent: Math.min(100, seconds / duration * 100), speed, etaSeconds: Number.isFinite(multiplier) && multiplier > 0 ? Math.max(0, (duration - seconds) / multiplier) : null }) } })
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(code === null ? '任务已取消' : `FFmpeg 失败（退出码 ${code}）`)))
    })
  }

  async merge(inputPaths: string[], outputName: string, mode: 'copy' | 'transcode', options: ToolEncodeOptions, onProgress: (progress: Pick<ToolTask, 'state' | 'percent' | 'speed' | 'etaSeconds'>) => void, onCommand?: (command: string) => void): Promise<{ outputPath: string }> {
    if (!this.status.available) throw new Error(this.status.message ?? 'FFmpeg 不可用')
    if (this.active) throw new Error('已有 FFmpeg 任务正在运行')
    if (inputPaths.length < 2) throw new Error('请至少选择两个视频文件')
    if (mode === 'transcode' && !this.status.nvencAvailable) throw new Error(this.status.message ?? 'NVIDIA 编码器不可用')
    const extension = '.mp4'
    const safeName = basename(outputName, extname(outputName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim() || '合并影片'
    const outputPath = join(dirname(inputPaths[0]), `${safeName}${extension}`)
    if (existsSync(outputPath)) throw new Error('目标文件已存在，请更换输出名称')
    const listPath = join(dirname(outputPath), `.${safeName}.${Date.now()}.concat.txt`)
    const temporaryPath = join(dirname(outputPath), `.${safeName}.${Date.now()}.tmp.mp4`)
    const escape = (value: string) => value.replaceAll("'", "'\\\\''")
    const sourceInfo = await Promise.all(inputPaths.map((path) => this.analyze(path)))
    const duration = sourceInfo.reduce((total, info) => total + (info?.durationSeconds ?? 0), 0) || null
    const args = ['-y']
    if (mode === 'copy') {
      await writeFile(listPath, inputPaths.map((path) => `file '${escape(path)}'`).join('\n'), 'utf8')
      args.push('-f', 'concat', '-safe', '0', '-i', listPath, '-map', '0', '-c', 'copy', '-movflags', '+faststart')
    } else {
      const first = sourceInfo[0]
      const targetHeight = options.height ?? first?.height
      if (!first?.width || !first.height || !targetHeight || sourceInfo.some((info) => !info?.width || !info.height || !info.audioCodec || !info.audioChannels)) throw new Error('转码合并要求每个文件都有可检测的视频与音频流')
      if (options.height === null && sourceInfo.some((info) => info!.width !== first.width || info!.height !== first.height)) throw new Error('输入分辨率不同，请选择 720p 或 1080p 作为转码合并高度')
      const targetWidth = Math.max(2, Math.round((first.width * targetHeight / first.height) / 2) * 2)
      for (const path of inputPaths) args.push('-i', path)
      const filters: string[] = []
      for (let index = 0; index < inputPaths.length; index += 1) {
        filters.push(`[${index}:v:0]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v${index}]`)
        filters.push(`[${index}:a:0]aresample=48000,asetpts=PTS-STARTPTS[a${index}]`)
      }
      args.push('-filter_complex', `${filters.join(';')};${inputPaths.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${inputPaths.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', ...this.encodeArgs({ ...options, height: null }), '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart')
    }
    args.push('-progress', 'pipe:1', '-nostats', temporaryPath)
    onCommand?.(`ffmpeg.exe ${args.map((arg) => /[\s"]/u.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg).join(' ')}`)
    try {
      await this.run(args, duration, onProgress)
      const info = await this.analyze(temporaryPath)
      if (!info?.videoCodec || !info.durationSeconds) throw new Error('合并文件校验失败')
      await rename(temporaryPath, outputPath)
      return { outputPath }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally { await rm(listPath, { force: true }).catch(() => undefined); this.active = null }
  }
}
