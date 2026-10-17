export function parseCutTime(value: string): number | null {
  const parts = value.trim().split(':')
  if (!value.trim() || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null
  const values = parts.map(Number)
  const seconds = values.length === 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values.length === 2 ? values[0] * 60 + values[1] : values[0]
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

export function formatCutTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '未检测'
  const value = Math.max(0, Math.floor(seconds))
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60].map((part) => String(part).padStart(2, '0')).join(':')
}
