import { describe, expect, it } from 'vitest'
import { isPublicIpAddress } from './actor-web-search'

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
})
