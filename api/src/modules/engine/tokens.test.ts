import { describe, expect, test } from 'bun:test'
import type { CanonicalQuestion } from './evaluator/port'
import {
  checkTokenBudget,
  estimateRequestTokens,
  estimateTokens
} from './tokens'

describe('estimateTokens', () => {
  test.each([
    ['empty string', '', 0],
    ['one character', 'a', 1],
    ['exactly four characters', 'abcd', 1],
    ['five characters', 'abcde', 2],
    ['a raw string is not quoted', 'x'.repeat(8), 2]
  ])('%s', (_, value, expected) => {
    expect(estimateTokens(value)).toBe(expected)
  })

  test.each([
    ['null', null, 1], // "null"
    ['a number', 12_345, 2], // "12345"
    ['a boolean', true, 1], // "true"
    ['an empty object', {}, 1], // "{}"
    ['an empty array', [], 1], // "[]"
    ['an object', { a: 'bc' }, 3] // {"a":"bc"} → 10 chars
  ])('%s is measured as canonical JSON', (_, value, expected) => {
    expect(estimateTokens(value)).toBe(expected)
  })

  test('key order does not change the estimate', () => {
    expect(estimateTokens({ b: 1, a: [1, 2, { z: 'x', y: null }] })).toBe(
      estimateTokens({ a: [1, 2, { y: null, z: 'x' }], b: 1 })
    )
  })

  test('undefined properties are ignored like in JSON', () => {
    expect(estimateTokens({ a: 1, b: undefined })).toBe(
      estimateTokens({ a: 1 })
    )
  })

  test('values JSON cannot represent count as 0', () => {
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens(() => 1)).toBe(0)
  })

  test('grows linearly (~4 characters per token)', () => {
    expect(estimateTokens('x'.repeat(4_000))).toBe(1_000)
    expect(estimateTokens('x'.repeat(4_001))).toBe(1_001)
  })
})

describe('estimateRequestTokens', () => {
  const short: CanonicalQuestion = {
    type: 'boolean',
    instructions: 'Urgent?'
  }
  const long: CanonicalQuestion = {
    type: 'choice',
    instructions: 'Classify the ticket. '.repeat(20),
    criteria: { bug: 'Something is broken', billing: null }
  }

  test('total is the state plus the longest question, not the sum', () => {
    const state = { ticket: { message: 'My invoice is wrong' } }
    const estimate = estimateRequestTokens(state, { short, long })

    expect(estimate.state).toBe(estimateTokens(state))
    expect(estimate.longestQuestion).toBe(estimateTokens(long))
    expect(estimate.longestQuestion).toBeGreaterThan(estimateTokens(short))
    expect(estimate.total).toBe(estimate.state + estimate.longestQuestion)
  })

  test('question order does not matter', () => {
    expect(estimateRequestTokens({}, { long, short })).toEqual(
      estimateRequestTokens({}, { short, long })
    )
  })

  test('no questions → only the state counts', () => {
    expect(estimateRequestTokens('abcdefgh', {})).toEqual({
      state: 2,
      longestQuestion: 0,
      total: 2
    })
  })

  test('an absent state counts as 0', () => {
    const estimate = estimateRequestTokens(undefined, { short })
    expect(estimate.state).toBe(0)
    expect(estimate.total).toBe(estimate.longestQuestion)
  })
})

describe('checkTokenBudget', () => {
  test.each([
    [0, 'ok'],
    [799, 'ok'],
    [800, 'ok'], // exactly 80% is still fine
    [801, 'warn'],
    [1_000, 'warn'], // at the limit: the estimate is rough, only warn
    [1_200, 'warn'], // exactly 120%
    [1_201, 'reject']
  ] as const)('%d of 1000 tokens → %s', (estimate, expected) => {
    expect(checkTokenBudget(estimate, 1_000)).toBe(expected)
  })

  test('thresholds are exact for limits that are not multiples of 5', () => {
    // 80% of 7 = 5.6, 120% of 7 = 8.4
    expect(checkTokenBudget(5, 7)).toBe('ok')
    expect(checkTokenBudget(6, 7)).toBe('warn')
    expect(checkTokenBudget(8, 7)).toBe('warn')
    expect(checkTokenBudget(9, 7)).toBe('reject')
  })

  test('an infinite limit never warns', () => {
    expect(checkTokenBudget(10 ** 9, Number.POSITIVE_INFINITY)).toBe('ok')
  })

  test.each([0, -1, Number.NaN])('limit %p is a RangeError', limit => {
    expect(() => checkTokenBudget(1, limit)).toThrow(RangeError)
  })

  test.each([Number.NaN, -1])(
    'estimate %p is a RangeError, not a silent ok',
    estimate => {
      expect(() => checkTokenBudget(estimate, 1_000)).toThrow(RangeError)
    }
  )
})
