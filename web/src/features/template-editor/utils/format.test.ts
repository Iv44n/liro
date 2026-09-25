import { describe, expect, it } from 'vitest'
import { formatPercent, formatRelative, plural } from './format'

describe('formatPercent()', () => {
  it('rounds a fraction to a whole percentage', () => {
    expect(formatPercent(0.8)).toBe('80 %')
    expect(formatPercent(0.055)).toBe('6 %')
  })
})

describe('plural()', () => {
  it('picks the singular/plural noun by count', () => {
    expect(plural(1, 'error', 'errores')).toBe('1 error')
    expect(plural(2, 'error', 'errores')).toBe('2 errores')
    expect(plural(0, 'error', 'errores')).toBe('0 errores')
  })
})

describe('formatRelative()', () => {
  const now = new Date('2026-09-23T12:00:00Z').getTime()

  it('describes a past moment in Spanish, using the closest unit', () => {
    expect(
      formatRelative(new Date(now - 5 * 60 * 1000).toISOString(), now)
    ).toBe('hace 5 minutos')
    expect(
      formatRelative(new Date(now - 3 * 60 * 60 * 1000).toISOString(), now)
    ).toBe('hace 3 horas')
  })

  it('returns "—" for a missing or invalid date', () => {
    expect(formatRelative(null, now)).toBe('—')
    expect(formatRelative('not a date', now)).toBe('—')
  })
})
