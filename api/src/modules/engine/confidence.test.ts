import { describe, expect, test } from 'bun:test'
import {
  booleanConfidence,
  distributionConfidence,
  normalizeProbabilities
} from './confidence'

const sum = (values: Record<string, number>) =>
  Object.values(values).reduce((total, p) => total + p, 0)

describe('normalizeProbabilities', () => {
  test('keeps an already normalized distribution', () => {
    const result = normalizeProbabilities({ a: 0.2, b: 0.3, c: 0.5 }, [
      'a',
      'b',
      'c'
    ])
    expect(result).toEqual({ a: 0.2, b: 0.3, c: 0.5 })
  })

  test('divides by the sum', () => {
    expect(normalizeProbabilities({ a: 2, b: 6 }, ['a', 'b'])).toEqual({
      a: 0.25,
      b: 0.75
    })
    const result = normalizeProbabilities({ a: 1, b: 1, c: 1 }, ['a', 'b', 'c'])
    expect(result?.a).toBeCloseTo(1 / 3, 12)
    expect(sum(result ?? {})).toBeCloseTo(1, 12)
  })

  test('has exactly the requested keys, in their order', () => {
    const result = normalizeProbabilities({ c: 0.5, x: 0.9, a: 0.5 }, [
      'a',
      'b',
      'c'
    ])
    expect(result).toEqual({ a: 0.5, b: 0, c: 0.5 })
    expect(Object.keys(result ?? {})).toEqual(['a', 'b', 'c'])
  })

  test('drops unknown keys before normalizing', () => {
    // `x` would otherwise take half of the mass.
    expect(normalizeProbabilities({ a: 0.25, x: 0.5 }, ['a', 'b'])).toEqual({
      a: 1,
      b: 0
    })
  })

  test.each([
    ['negative', -0.4],
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a string', '0.4' as unknown as number],
    ['null', null as unknown as number]
  ])('treats a %s weight as 0', (_, weight) => {
    expect(normalizeProbabilities({ a: weight, b: 0.4 }, ['a', 'b'])).toEqual({
      a: 0,
      b: 1
    })
  })

  test.each([
    ['every weight is 0', { a: 0, b: 0 }, ['a', 'b']],
    ['every weight is unusable', { a: -1, b: Number.NaN }, ['a', 'b']],
    ['the provider sent no keys', {}, ['a', 'b']],
    ['only unknown keys carry weight', { x: 1 }, ['a', 'b']],
    ['there are no keys', { a: 1 }, []]
  ])('returns null when %s', (_, probabilities, keys) => {
    expect(normalizeProbabilities(probabilities, keys)).toBeNull()
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'a']
  ])('returns null (not a TypeError) for %s instead of a map', (_, value) => {
    expect(
      normalizeProbabilities(value as unknown as Record<string, number>, ['a'])
    ).toBeNull()
  })

  test('ignores inherited properties', () => {
    expect(
      normalizeProbabilities({ a: 1 }, ['constructor', 'toString', 'a'])
    ).toEqual({ constructor: 0, toString: 0, a: 1 })
  })

  test('collapses duplicate keys instead of double counting them', () => {
    expect(normalizeProbabilities({ a: 1, b: 1 }, ['a', 'a', 'b'])).toEqual({
      a: 0.5,
      b: 0.5
    })
  })

  test('survives weights whose sum overflows', () => {
    const huge = Number.MAX_VALUE
    expect(
      normalizeProbabilities({ a: huge, b: huge, c: 0 }, ['a', 'b', 'c'])
    ).toEqual({ a: 0.5, b: 0.5, c: 0 })
  })

  test('does not mutate its input', () => {
    const probabilities = { a: 2, b: 2, x: 1 }
    normalizeProbabilities(probabilities, ['a', 'b'])
    expect(probabilities).toEqual({ a: 2, b: 2, x: 1 })
  })
})

describe('distributionConfidence', () => {
  test("matches the docs' example: p_max 0.61 over 3 options → 0.415", () => {
    expect(
      distributionConfidence({ bug: 0.61, billing: 0.3, other: 0.09 })
    ).toBeCloseTo(0.415, 12)
  })

  test.each([
    ['2 options, p_max 0.75', { a: 0.75, b: 0.25 }, 0.5],
    ['2 options, p_max 0.95', { a: 0.05, b: 0.95 }, 0.9],
    ['4 options, p_max 0.4', { a: 0.4, b: 0.2, c: 0.2, d: 0.2 }, 0.2],
    ['a certain answer', { a: 0, b: 1, c: 0 }, 1]
  ])('computes (K·p_max − 1)/(K − 1) for %s', (_, probabilities, expected) => {
    expect(distributionConfidence(probabilities)).toBeCloseTo(expected, 12)
  })

  test.each([2, 3, 4, 10, 255])(
    'is 0 for a uniform distribution over %i options',
    k => {
      const uniform = Object.fromEntries(
        Array.from({ length: k }, (_, i) => [`o${i}`, 1 / k])
      )
      expect(distributionConfidence(uniform)).toBeCloseTo(0, 12)
      expect(distributionConfidence(uniform)).toBeGreaterThanOrEqual(0)
    }
  )

  test('K is the number of keys, zeros included', () => {
    // Same p_max, more options → more confident (the top one stands out more).
    expect(distributionConfidence({ a: 0.5, b: 0.5 })).toBe(0)
    expect(distributionConfidence({ a: 0.5, b: 0.5, c: 0, d: 0 })).toBeCloseTo(
      1 / 3,
      12
    )
  })

  test('is clamped to [0, 1]', () => {
    // Not normalized: (3·0.1 − 1)/2 < 0 and (2·2 − 1)/1 > 1.
    expect(distributionConfidence({ a: 0.1, b: 0.1, c: 0.1 })).toBe(0)
    expect(distributionConfidence({ a: 2, b: 0 })).toBe(1)
  })

  test.each([
    ['no options', {}],
    ['a single option', { a: 0.3 }]
  ])('is 1 with %s', (_, probabilities) => {
    expect(distributionConfidence(probabilities)).toBe(1)
  })

  test('ignores non-finite values when looking for p_max', () => {
    // K still counts every key: (3·0.5 − 1)/2.
    expect(
      distributionConfidence({ a: Number.NaN, b: 0.5, c: 0.5 })
    ).toBeCloseTo(0.25, 12)
    expect(distributionConfidence({ a: Number.POSITIVE_INFINITY, b: 0 })).toBe(
      0
    )
  })
})

describe('booleanConfidence', () => {
  test.each([
    [0, 1],
    [1, 1],
    [0.5, 0],
    [0.9, 0.8],
    [0.1, 0.8],
    [0.75, 0.5],
    [0.25, 0.5],
    [0.7, 0.4]
  ])('P(true) = %d → |2p − 1| = %d', (probability, expected) => {
    expect(booleanConfidence(probability)).toBeCloseTo(expected, 12)
  })

  test('is symmetric around 0.5', () => {
    for (const p of [0, 0.05, 0.2, 0.33, 0.49]) {
      expect(booleanConfidence(p)).toBeCloseTo(booleanConfidence(1 - p), 12)
    }
  })

  test.each([
    [1.5, 1],
    [-0.2, 1],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 1]
  ])('clamps P(true) = %d to [0, 1] first', (probability, expected) => {
    expect(booleanConfidence(probability)).toBe(expected)
  })

  test('agrees with the threshold arithmetic the decide wizard relies on', () => {
    // minConfidence = 2·yesThreshold − 1 must be met exactly at P = yesThreshold.
    expect(booleanConfidence(0.9)).toBeGreaterThanOrEqual(2 * 0.9 - 1)
    expect(booleanConfidence(0.1)).toBeGreaterThanOrEqual(1 - 2 * 0.1)
  })
})
