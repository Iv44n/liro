import { describe, expect, it } from 'vitest'
import {
  createApiKeySchema,
  toCreateApiKeyRequest
} from '../schemas/create-api-key'
import { apiKeyState, maskedApiKey } from './api-key'

describe('maskedApiKey()', () => {
  it('shows the start of the key followed by an ellipsis', () => {
    expect(maskedApiKey({ start: 'lr_live_ab', mode: 'live' })).toBe(
      'lr_live_ab…'
    )
    expect(maskedApiKey({ start: null, mode: 'test' })).toBe('lr_test_…')
  })
})

describe('apiKeyState()', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  const inDays = (days: number) =>
    new Date(now + days * 86_400_000).toISOString()

  it('tells active, expiring, expired and disabled keys apart', () => {
    expect(apiKeyState({ enabled: true, expiresAt: null }, now)).toBe('active')
    expect(apiKeyState({ enabled: null, expiresAt: inDays(30) }, now)).toBe(
      'active'
    )
    expect(apiKeyState({ enabled: true, expiresAt: inDays(3) }, now)).toBe(
      'expiring'
    )
    expect(apiKeyState({ enabled: true, expiresAt: inDays(-1) }, now)).toBe(
      'expired'
    )
    expect(apiKeyState({ enabled: false, expiresAt: null }, now)).toBe(
      'disabled'
    )
  })
})

describe('createApiKeySchema', () => {
  it('trims the name and enforces 1..32 characters', () => {
    expect(
      createApiKeySchema.safeParse({
        name: '   ',
        mode: 'live',
        expiration: 'never'
      }).success
    ).toBe(false)
    expect(
      createApiKeySchema.safeParse({
        name: 'x'.repeat(33),
        mode: 'live',
        expiration: 'never'
      }).success
    ).toBe(false)
    expect(
      createApiKeySchema.parse({
        name: '  Backend  ',
        mode: 'test',
        expiration: '30'
      }).name
    ).toBe('Backend')
  })
})

describe('toCreateApiKeyRequest()', () => {
  it('omits expiresIn for keys that never expire', () => {
    expect(
      toCreateApiKeyRequest({
        name: ' CI ',
        mode: 'test',
        expiration: 'never'
      })
    ).toEqual({ name: 'CI', mode: 'test' })
  })

  it('converts days into seconds', () => {
    expect(
      toCreateApiKeyRequest({
        name: 'Backend',
        mode: 'live',
        expiration: '30'
      })
    ).toEqual({ name: 'Backend', mode: 'live', expiresIn: 30 * 86_400 })
  })
})
