import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatProbability,
  formatRelativeTime,
  formatTimeUntil,
  pluralize
} from './format'

const NBSP = ' '

describe('formatPercent()', () => {
  it('formats ratios as Spanish percentages', () => {
    expect(formatPercent(0.873)).toBe(`87${NBSP}%`)
    expect(formatPercent(1)).toBe(`100${NBSP}%`)
    expect(formatPercent(0.8765, 1)).toBe(`87,7${NBSP}%`)
  })

  it('shows a dash when there is no value', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(undefined)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
  })
})

describe('formatProbability()', () => {
  it('never rounds a non-extreme probability to 0 % or 100 %', () => {
    expect(formatProbability(0.003)).toBe(`<1${NBSP}%`)
    expect(formatProbability(0.997)).toBe(`>99${NBSP}%`)
    expect(formatProbability(0)).toBe(`0${NBSP}%`)
    expect(formatProbability(1)).toBe(`100${NBSP}%`)
    expect(formatProbability(0.42)).toBe(`42${NBSP}%`)
  })
})

describe('formatNumber()', () => {
  it('uses the Spanish decimal comma', () => {
    expect(formatNumber(0.1234, 2)).toBe('0,12')
    expect(formatNumber(2)).toBe('2')
    expect(formatNumber(null)).toBe('—')
  })
})

describe('formatDuration()', () => {
  it('picks ms, s or min', () => {
    expect(formatDuration(850)).toBe(`850${NBSP}ms`)
    expect(formatDuration(1234)).toBe(`1,2${NBSP}s`)
    expect(formatDuration(2000)).toBe(`2${NBSP}s`)
    expect(formatDuration(75_000)).toBe(`1${NBSP}min 15${NBSP}s`)
    expect(formatDuration(120_000)).toBe(`2${NBSP}min`)
    expect(formatDuration(null)).toBe('—')
  })
})

describe('formatRelativeTime()', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('describes recent moments in Spanish', () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe('hace un momento')
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('hace 5 min')
    expect(formatRelativeTime(ago(3 * 3_600_000 + 60_000), now)).toBe(
      'hace 3 h'
    )
    expect(formatRelativeTime(ago(30 * 3_600_000), now)).toBe('ayer')
    expect(formatRelativeTime(ago(4 * 86_400_000), now)).toBe('hace 4 días')
  })

  it('treats a clock slightly ahead as "now"', () => {
    expect(formatRelativeTime(ago(-5_000), now)).toBe('hace un momento')
  })

  it('shows the date after a week, and a dash for bad input', () => {
    expect(formatRelativeTime(ago(10 * 86_400_000), now)).not.toMatch(/^hace/)
    expect(formatRelativeTime('not a date', now)).toBe('—')
    expect(formatRelativeTime(null, now)).toBe('—')
  })
})

describe('formatTimeUntil()', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  const inMs = (ms: number) => new Date(now + ms).toISOString()

  it('describes the remaining time, or null once past', () => {
    expect(formatTimeUntil(inMs(10 * 60_000), now)).toBe('en 10 min')
    expect(formatTimeUntil(inMs(5 * 3_600_000), now)).toBe('en 5 h')
    expect(formatTimeUntil(inMs(86_400_000 + 1000), now)).toBe('en 1 día')
    expect(formatTimeUntil(inMs(3 * 86_400_000 + 1000), now)).toBe('en 3 días')
    expect(formatTimeUntil(inMs(-1000), now)).toBeNull()
    expect(formatTimeUntil(null, now)).toBeNull()
  })
})

describe('pluralize()', () => {
  it('agrees with the count', () => {
    expect(pluralize(1, 'ejecución', 'ejecuciones')).toBe('1 ejecución')
    expect(pluralize(0, 'ejecución', 'ejecuciones')).toBe('0 ejecuciones')
    expect(pluralize(12, 'ejecución', 'ejecuciones')).toBe('12 ejecuciones')
  })
})
