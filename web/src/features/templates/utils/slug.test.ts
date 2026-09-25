import { describe, expect, it } from 'vitest'
import { isSlug, SLUG_MAX_LENGTH } from '../types/definition'
import { slugify, suggestSlug, toLabel, uniqueSlug } from './slug'

describe('slugify()', () => {
  it('folds accents and special letters like the API', () => {
    expect(slugify('Reseñas de clientes')).toBe('resenas-de-clientes')
    expect(slugify('Straße & Œuvre')).toBe('strasse-oeuvre')
    expect(slugify('  ¿Aprobar reembolso?  ')).toBe('aprobar-reembolso')
    expect(slugify('Tickets_de soporte (v2)')).toBe('tickets-de-soporte-v2')
  })

  it('falls back to `template` when nothing is left', () => {
    expect(slugify('¿?')).toBe('template')
    expect(slugify('')).toBe('template')
  })

  it('never exceeds the max length nor ends with a hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} b`)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(isSlug(slug)).toBe(true)
  })
})

describe('suggestSlug()', () => {
  it('stays empty until the name has text', () => {
    expect(suggestSlug('')).toBe('')
    expect(suggestSlug('   ')).toBe('')
    expect(suggestSlug('Soporte')).toBe('soporte')
  })
})

describe('uniqueSlug()', () => {
  it('keeps a free slug', () => {
    expect(uniqueSlug('soporte', new Set(['otro']))).toBe('soporte')
    expect(uniqueSlug('', new Set(['']))).toBe('')
  })

  it('appends the first free counter', () => {
    expect(uniqueSlug('soporte', new Set(['soporte']))).toBe('soporte-2')
    expect(
      uniqueSlug('soporte', new Set(['soporte', 'soporte-2', 'soporte-3']))
    ).toBe('soporte-4')
  })

  it('shortens long slugs so the suffix fits', () => {
    const long = 'a'.repeat(SLUG_MAX_LENGTH)
    const unique = uniqueSlug(long, new Set([long]))
    expect(unique).toHaveLength(SLUG_MAX_LENGTH)
    expect(unique.endsWith('-2')).toBe(true)
    expect(isSlug(unique)).toBe(true)
  })
})

describe('toLabel()', () => {
  it('turns free text into a valid label', () => {
    expect(toLabel('Facturación urgente')).toBe('facturacion_urgente')
    expect(toLabel('feature-request')).toBe('feature-request')
    expect(toLabel('  Bug!! ')).toBe('bug')
    expect(toLabel('a - b')).toBe('a_b')
    expect(toLabel('ya__está')).toBe('ya_esta')
  })

  it('returns an empty string when no valid label is left', () => {
    expect(toLabel('¿?')).toBe('')
    expect(toLabel('needs_review')).toBe('')
    expect(toLabel('constructor')).toBe('')
  })
})
