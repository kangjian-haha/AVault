import { describe, expect, it } from 'vitest'
import { parseByteRange } from './range'

describe('parseByteRange', () => {
  it('parses a bounded range', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19, length: 10 })
  })

  it('parses open and suffix ranges', () => {
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99, length: 10 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, length: 10 })
  })

  it('rejects unsatisfiable ranges', () => {
    expect(() => parseByteRange('bytes=100-101', 100)).toThrow(RangeError)
  })
})
