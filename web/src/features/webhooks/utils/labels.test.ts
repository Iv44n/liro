import { describe, expect, it } from 'vitest'
import { disabledReasonText, urlHost } from './labels'

describe('urlHost()', () => {
  it('extracts the host of a valid URL', () => {
    expect(urlHost('https://example.com/webhooks/liro')).toBe('example.com')
    expect(urlHost('https://sub.example.com:8443/x')).toBe(
      'sub.example.com:8443'
    )
  })

  it('returns null for an invalid URL', () => {
    expect(urlHost('not a url')).toBeNull()
  })
})

describe('disabledReasonText()', () => {
  it('names the known reasons in Spanish', () => {
    expect(disabledReasonText('too_many_failures')).toBe(
      'Demasiados fallos consecutivos'
    )
  })

  it('falls back to the raw code for an unknown reason', () => {
    expect(disabledReasonText('some_future_reason')).toBe('some_future_reason')
  })
})
