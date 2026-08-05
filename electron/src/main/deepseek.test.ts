import { describe, expect, it } from 'vitest'
import { parseDeepSeekActorDetails, socialLinks } from './deepseek'

describe('DeepSeek actor details', () => {
  it('keeps only validated public social links', () => {
    expect(socialLinks([
      { platform: 'X', url: 'https://x.com/example' },
      { platform: 'Duplicate', url: 'https://x.com/example' },
      { platform: 'Bad', url: 'javascript:alert(1)' }
    ])).toEqual([{ platform: 'X', url: 'https://x.com/example' }])
  })

  it('leaves unknown model fields empty instead of inventing values', () => {
    expect(parseDeepSeekActorDetails('Test Actor', JSON.stringify({ aliases: ['テスト', 'テスト'], height: 160, socialLinks: [] }))).toMatchObject({
      name: 'Test Actor', aliases: ['テスト'], height: 160, birthday: null, socialLinks: [], metadataSource: 'deepseek'
    })
  })

  it('accepts a JSON response accidentally wrapped in a code fence', () => {
    expect(parseDeepSeekActorDetails('Test Actor', '```json\n{"birthday":"2000-01-01"}\n```').birthday).toBe('2000-01-01')
  })
})
