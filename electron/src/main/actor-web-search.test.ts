import { describe, expect, it } from 'vitest'
import { isPublicIpAddress, wikipediaActorFacts, wikipediaInfoboxText } from './actor-web-search'

describe('isPublicIpAddress', () => {
  it('rejects loopback, private, link-local and reserved IPv4 ranges', () => {
    for (const address of ['127.0.0.1', '10.0.0.4', '169.254.1.1', '172.16.0.1', '192.168.0.1', '0.0.0.0', '100.64.0.1']) {
      expect(isPublicIpAddress(address)).toBe(false)
    }
  })

  it('accepts public addresses and rejects local IPv6 addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('::1')).toBe(false)
    expect(isPublicIpAddress('fd00::1')).toBe(false)
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('keeps Japanese Wikipedia infobox dimensions prominent for AI extraction', () => {
    const html = `<table class="infobox"><tr><th>生年月日</th><td>1998年1月2日</td></tr><tr><th>身長</th><td>160 cm</td></tr><tr><th>スリーサイズ</th><td>B88 / W59 / H85 cm</td></tr><tr><th>所属</th><td>Example</td></tr></table>`
    expect(wikipediaInfoboxText(html)).toBe('生年月日: 1998年1月2日\n身長: 160 cm\nスリーサイズ: B88 / W59 / H85 cm')
    expect(wikipediaActorFacts(html)).toMatchObject({ birthday: '1998-01-02', height: 160, bust: 88, waist: 59, hip: 85 })
  })
})
