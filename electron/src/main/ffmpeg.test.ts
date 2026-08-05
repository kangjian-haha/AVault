import { describe, expect, it } from 'vitest'
import { FfmpegService, parseProbe } from './ffmpeg'

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
})
