import { describe, expect, it } from 'vitest'
import { inferSourcePartition, normalizeMovieCode, parseVideoFilename } from './scanner'

describe('uncensored filename recognition', () => {
  it('recognizes the additional uncensored catalogue formats', () => {
    expect(normalizeMovieCode('N0659.mp4')).toBe('N0659')
    expect(normalizeMovieCode('MKBD-S03.mp4')).toBe('MKBD-S03')
    expect(normalizeMovieCode('150123-YUME.wmv')).toBe('150123-YUME')
    expect(normalizeMovieCode('031515-828-C.mp4')).toBe('031515-828')
    expect(normalizeMovieCode('100616_399-C.mp4')).toBe('100616_399')
  })

  it('categorizes them as uncensored', () => {
    for (const code of ['N0659', 'MKBD-S03', '150123-YUME', '031515-828', '100616_399']) {
      expect(inferSourcePartition(code)).toBe('uncensored')
    }
  })

  it('keeps leaked and unknown separate and treats -C as subtitles', () => {
    expect(inferSourcePartition('SSIS-826', 'SSIS-826-LEAK')).toBe('leaked')
    expect(inferSourcePartition(null, 'random-video')).toBe('unknown')
    expect(inferSourcePartition('SSIS-826')).toBe('censored')
    expect(parseVideoFilename('031515-828-C.mp4').versionLabel).toContain('字幕')
  })
})
