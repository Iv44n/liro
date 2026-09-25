import { describe, expect, it } from 'vitest'
import { isJsonObject, parseJsonText, stringifyJson } from './json-text'

describe('parseJsonText()', () => {
  it('treats blank text as an absent value', () => {
    expect(parseJsonText('')).toEqual({ ok: true })
    expect(parseJsonText('   \n  ')).toEqual({ ok: true })
  })

  it('parses valid JSON', () => {
    expect(parseJsonText('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJsonText('[1, 2, 3]')).toEqual({ ok: true, value: [1, 2, 3] })
  })

  it('reports an error for invalid JSON', () => {
    const result = parseJsonText('{a: 1}')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('stringifyJson()', () => {
  it('pretty-prints, and prints nothing for undefined', () => {
    expect(stringifyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(stringifyJson(undefined)).toBe('')
  })

  it('round-trips through parseJsonText', () => {
    const value = { a: [1, 2], b: 'x' }
    expect(parseJsonText(stringifyJson(value))).toEqual({ ok: true, value })
  })
})

describe('isJsonObject()', () => {
  it('accepts plain objects only', () => {
    expect(isJsonObject({})).toBe(true)
    expect(isJsonObject({ a: 1 })).toBe(true)
    expect(isJsonObject([])).toBe(false)
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject('x')).toBe(false)
    expect(isJsonObject(1)).toBe(false)
  })
})
