import { describe, expect, test } from 'bun:test'
import { extractApiKey } from './actor'

describe('extractApiKey()', () => {
  test('reads x-api-key', () => {
    expect(extractApiKey(new Headers({ 'x-api-key': ' lr_live_abc ' }))).toBe(
      'lr_live_abc'
    )
  })

  test('reads Authorization: Bearer, case-insensitively', () => {
    expect(
      extractApiKey(new Headers({ authorization: 'bearer lr_test_abc' }))
    ).toBe('lr_test_abc')
  })

  test('prefers x-api-key over Authorization', () => {
    const headers = new Headers({
      'x-api-key': 'lr_live_a',
      authorization: 'Bearer lr_live_b'
    })
    expect(extractApiKey(headers)).toBe('lr_live_a')
  })

  test('ignores other schemes and empty values', () => {
    expect(
      extractApiKey(new Headers({ authorization: 'Basic dXNlcjpwYXNz' }))
    ).toBeNull()
    expect(extractApiKey(new Headers({ 'x-api-key': '   ' }))).toBeNull()
    expect(extractApiKey(new Headers())).toBeNull()
  })
})
