import { describe, expect, it } from 'vitest'
import { formatEntityTag, parseEntityTag } from './etag'

describe('parseEntityTag()', () => {
  it('unquotes strong and weak tags', () => {
    expect(parseEntityTag('"abc123"')).toBe('abc123')
    expect(parseEntityTag('W/"abc123"')).toBe('abc123')
    expect(parseEntityTag('  "abc"  ')).toBe('abc')
  })

  it('keeps bare tags', () => {
    expect(parseEntityTag('abc123')).toBe('abc123')
  })

  it('returns null for missing or empty tags', () => {
    expect(parseEntityTag(null)).toBeNull()
    expect(parseEntityTag(undefined)).toBeNull()
    expect(parseEntityTag('')).toBeNull()
    expect(parseEntityTag('""')).toBeNull()
  })
})

describe('formatEntityTag()', () => {
  it('quotes a bare tag', () => {
    expect(formatEntityTag('abc123')).toBe('"abc123"')
  })

  it('leaves quoted tags as they are', () => {
    expect(formatEntityTag('"abc123"')).toBe('"abc123"')
    expect(formatEntityTag('W/"abc123"')).toBe('W/"abc123"')
  })

  it('round-trips with parseEntityTag', () => {
    expect(parseEntityTag(formatEntityTag('h4sh'))).toBe('h4sh')
  })
})
