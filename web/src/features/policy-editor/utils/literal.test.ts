import { describe, expect, it } from 'vitest'
import {
  formatLiteralDate,
  formatLiteralNumber,
  formatLiteralText,
  literalAsBoolean,
  parseLiteralDate,
  parseLiteralNumber,
  parseLiteralText,
  widgetFor
} from './literal'

describe('widgetFor()', () => {
  it('picks select when there are options', () => {
    expect(widgetFor({ json: 'string', options: ['a', 'b'] })).toBe('select')
  })

  it('picks boolean/number/date from the json kind', () => {
    expect(widgetFor({ json: 'boolean' })).toBe('boolean')
    expect(widgetFor({ json: 'number' })).toBe('number')
    expect(widgetFor({ json: 'string', date: true })).toBe('date')
  })

  it('falls back to text for unknown or plain-string types', () => {
    expect(widgetFor(undefined)).toBe('text')
    expect(widgetFor({})).toBe('text')
    expect(widgetFor({ json: 'string' })).toBe('text')
  })
})

describe('text literal', () => {
  it('round-trips a plain string', () => {
    expect(parseLiteralText(formatLiteralText('hola'))).toBe('hola')
  })

  it('parses numbers and booleans typed as text', () => {
    expect(parseLiteralText('42')).toBe(42)
    expect(parseLiteralText('true')).toBe(true)
    expect(parseLiteralText('false')).toBe(false)
    expect(parseLiteralText('')).toBeNull()
  })

  it('formats non-string JSON as its JSON text', () => {
    expect(formatLiteralText(42)).toBe('42')
    expect(formatLiteralText(true)).toBe('true')
    expect(formatLiteralText(null)).toBe('')
  })
})

describe('number literal', () => {
  it('round-trips a finite number', () => {
    expect(parseLiteralNumber(formatLiteralNumber(3.5))).toBe(3.5)
  })

  it('rejects non-numeric text as null', () => {
    expect(parseLiteralNumber('abc')).toBeNull()
    expect(parseLiteralNumber('')).toBeNull()
  })

  it('shows a blank field for a non-number value', () => {
    expect(formatLiteralNumber('nope')).toBe('')
    expect(formatLiteralNumber(null)).toBe('')
  })
})

describe('date literal', () => {
  it('round-trips a date-only string', () => {
    expect(parseLiteralDate(formatLiteralDate('2026-01-05'))).toBe('2026-01-05')
  })

  it('takes only the date prefix of a full ISO datetime', () => {
    expect(formatLiteralDate('2026-01-05T10:00:00Z')).toBe('2026-01-05')
  })

  it('parses an empty field as null', () => {
    expect(parseLiteralDate('')).toBeNull()
  })
})

describe('literalAsBoolean()', () => {
  it('is true only for the literal true', () => {
    expect(literalAsBoolean(true)).toBe(true)
    expect(literalAsBoolean(false)).toBe(false)
    expect(literalAsBoolean(null)).toBe(false)
    expect(literalAsBoolean('true')).toBe(false)
  })
})
