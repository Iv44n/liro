import { describe, expect, it } from 'vitest'
import {
  countLabel,
  foldText,
  formatRelativeTime,
  matchesTemplateQuery
} from './format'

describe('formatRelativeTime()', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('describes recent times in Spanish', () => {
    expect(formatRelativeTime(ago(10 * 1000), now)).toBe('ahora')
    expect(formatRelativeTime(ago(5 * 60 * 1000), now)).toBe('hace 5 minutos')
    expect(formatRelativeTime(ago(3 * 60 * 60 * 1000), now)).toBe(
      'hace 3 horas'
    )
    expect(formatRelativeTime(ago(26 * 60 * 60 * 1000), now)).toBe('ayer')
    expect(formatRelativeTime(ago(4 * 24 * 60 * 60 * 1000), now)).toBe(
      'hace 4 días'
    )
  })

  it('treats a slightly future time as now', () => {
    expect(formatRelativeTime(new Date(now + 5000).toISOString(), now)).toBe(
      'ahora'
    )
  })

  it('shows the date after a month and nothing for invalid input', () => {
    expect(formatRelativeTime(ago(45 * 24 * 60 * 60 * 1000), now)).toMatch(
      /2026/
    )
    expect(formatRelativeTime('not a date', now)).toBe('')
  })
})

describe('matchesTemplateQuery()', () => {
  const template = {
    name: 'Clasificación de reseñas',
    slug: 'resenas',
    description: 'Detecta quejas de envío'
  }

  it('matches every word, ignoring case and accents', () => {
    expect(matchesTemplateQuery(template, '')).toBe(true)
    expect(matchesTemplateQuery(template, 'clasificacion')).toBe(true)
    expect(matchesTemplateQuery(template, 'RESEÑAS envio')).toBe(true)
    expect(matchesTemplateQuery(template, 'resenas pagos')).toBe(false)
  })

  it('handles a missing description', () => {
    expect(
      matchesTemplateQuery({ ...template, description: null }, 'quejas')
    ).toBe(false)
  })
})

describe('text helpers', () => {
  it('folds accents', () => {
    expect(foldText('Ñandú ÁRBOL')).toBe('nandu arbol')
  })

  it('pluralizes counts', () => {
    expect(countLabel(1, 'decisión', 'decisiones')).toBe('1 decisión')
    expect(countLabel(0, 'decisión', 'decisiones')).toBe('0 decisiones')
  })
})
