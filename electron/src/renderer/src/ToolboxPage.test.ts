import { describe, expect, it } from 'vitest'
import { formatCutTime, parseCutTime } from './tool-cut-time'

describe('toolbox cut time input', () => {
  it('accepts seconds, minute notation, and hour notation', () => {
    expect(parseCutTime('90')).toBe(90)
    expect(parseCutTime('01:30')).toBe(90)
    expect(parseCutTime('1:01:30')).toBe(3690)
    expect(formatCutTime(3690.8)).toBe('01:01:30')
  })

  it('rejects malformed time values', () => {
    expect(parseCutTime('1:2:3:4')).toBeNull()
    expect(parseCutTime('-1')).toBeNull()
    expect(parseCutTime('abc')).toBeNull()
  })
})
