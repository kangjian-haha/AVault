export interface ByteRange {
  start: number
  end: number
  length: number
}

export function parseByteRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) throw new RangeError('Invalid Range')
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) throw new RangeError('Invalid Range')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    throw new RangeError('Unsatisfiable Range')
  }
  end = Math.min(end, size - 1)
  return { start, end, length: end - start + 1 }
}
