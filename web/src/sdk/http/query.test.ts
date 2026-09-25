import { describe, expect, it } from 'vitest'
import { segment, withQuery } from './query'

describe('withQuery()', () => {
  it('returns the path unchanged without params', () => {
    expect(withQuery('/runs')).toBe('/runs')
    expect(withQuery('/runs', {})).toBe('/runs')
  })

  it('skips undefined, null and empty values', () => {
    expect(
      withQuery('/runs', {
        templateId: 'tpl_1',
        decision: undefined,
        mode: null,
        source: '',
        limit: 20
      })
    ).toBe('/runs?templateId=tpl_1&limit=20')
  })

  it('serializes booleans and encodes values', () => {
    expect(withQuery('/x', { flag: false, q: 'a b&c' })).toBe(
      '/x?flag=false&q=a+b%26c'
    )
  })

  it('appends to a path that already has a query string', () => {
    expect(withQuery('/x?a=1', { b: 2 })).toBe('/x?a=1&b=2')
  })
})

describe('segment()', () => {
  it('encodes reserved characters of refs and ids', () => {
    expect(segment('ticket-triage@1.2')).toBe('ticket-triage%401.2')
    expect(segment('a/b')).toBe('a%2Fb')
  })
})
