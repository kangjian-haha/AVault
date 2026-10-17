import { describe, expect, it } from 'vitest'
import { FfmpegService, formatCutTimestamp, parseProbe, validateAppleHevcOutput } from './ffmpeg'

describe('FFprobe parser', () => {
  it('maps video and audio fields for display', () => {
    expect(parseProbe({
      format: { format_name: 'matroska,webm', duration: '3600.5', bit_rate: '8000000' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080, avg_frame_rate: '24000/1001', pix_fmt: 'yuv420p', tags: { encoder: 'x264' } },
        { codec_type: 'audio', codec_name: 'aac', bit_rate: '160000', channels: 2 }
      ]
    })).toMatchObject({ container: 'matroska', videoCodec: 'h264', videoProfile: 'High', videoEncoder: 'x264', width: 1920, height: 1080, frameRate: 23.98, audioCodec: 'aac', audioChannels: 2, durationSeconds: 3600.5 })
  })

  it('stores a generated preview beside the source video', () => {
    const service = new FfmpegService()
    expect(service.previewPath('F:\\Videos\\ABP-123.mp4')).toBe('F:\\Videos\\ABP-123.avault-preview.jpg')
    expect(service.previewPath('F:\\Videos\\ABP-123 [HEVC].mp4')).toBe('F:\\Videos\\ABP-123.avault-preview.jpg')
  })

  it('builds collision-safe cut names from the selected time range', () => {
    const service = new FfmpegService()
    expect(formatCutTimestamp(90.9)).toBe('00-01-30')
    expect(service.cutOutputPath('F:\\Videos\\ABP-123.mp4', 90, 180)).toBe('F:\\Videos\\ABP-123 [剪切 00-01-30 至 00-03-00].mp4')
  })
})


describe('Apple HEVC output validation', () => {
  const video = { codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'hvc1', profile: 'Main', pix_fmt: 'yuv420p' }
  const audio = { codec_type: 'audio', codec_name: 'aac', profile: 'LC', channels: 2 }
  const output = (streams = [video, audio]) => ({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams })

  it('accepts Apple HEVC with optional AAC-LC audio', () => {
    expect(() => validateAppleHevcOutput(output(), true)).not.toThrow()
    expect(() => validateAppleHevcOutput(output([video]), false)).not.toThrow()
  })

  it.each([
    { codec_tag_string: 'hev1' }, { profile: 'Main 10' },
    { pix_fmt: 'yuv420p10le' }, { codec_name: 'h264' }
  ])('rejects incompatible video %j', (changes) => {
    expect(() => validateAppleHevcOutput(output([{ ...video, ...changes }, audio]), true)).toThrow()
  })

  it('rejects missing or incompatible audio and non-MP4 containers', () => {
    expect(() => validateAppleHevcOutput(output([video]), true)).toThrow()
    expect(() => validateAppleHevcOutput(output([video, { ...audio, profile: 'HE-AAC' }]), true)).toThrow()
    expect(() => validateAppleHevcOutput({ ...output(), format: { format_name: 'matroska' } }, true)).toThrow()
  })
})
