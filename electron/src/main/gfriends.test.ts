import { describe, expect, it } from 'vitest'
import { findGfriendsAvatar } from './gfriends'

describe('Gfriends avatar lookup', () => {
  it('matches aliases after normalizing Japanese separators and spaces', () => {
    const result = findGfriendsAvatar({ Content: { Studio: { '妃月るい.jpg': '妃月るい.jpg?t=123' } } }, 'Hiduki Rui', ['妃月・るい'])
    expect(result).toBe('https://cdn.jsdelivr.net/gh/gfriends/gfriends@master/Content/Studio/%E5%A6%83%E6%9C%88%E3%82%8B%E3%81%84.jpg?t=123')
  })

  it('uses the later filetree match as the higher-priority image', () => {
    const result = findGfriendsAvatar({ Content: { Low: { '演员.jpg': 'low.jpg' }, High: { '别名.jpg': 'high.jpg' } } }, '演员', ['别名'])
    expect(result).toContain('/High/high.jpg')
  })
})
