import { describe, expect, test } from 'bun:test'
import {
  type CanonicalAnswer,
  EvaluatorError
} from '#modules/engine/evaluator/port'
import type { ResolvedAnswer, ResolvedAnswers } from '#modules/engine/types'
import { type QuestionDef, questionSchema } from '#modules/templates/definition'
import { publicAnswers, resolveAnswer, resolveAnswers } from './answers'

const category = questionSchema.parse({
  type: 'choice',
  instructions: 'What is the ticket about?',
  criteria: { bug: 'Something is broken', billing: null, other: null }
})

const severity = questionSchema.parse({
  type: 'score',
  instructions: 'How severe is the issue?',
  levels: [
    { label: 'low', criteria: null },
    { label: 'medium', criteria: 'Degraded, with a workaround' },
    { label: 'high', criteria: 'Blocked' }
  ]
})

const urgent = questionSchema.parse({
  type: 'boolean',
  instructions: 'Is the customer blocked?'
})

const choice = (
  value: string,
  probabilities: Record<string, number> | null = null
): CanonicalAnswer => ({ type: 'choice', choice: value, probabilities })

const score = (
  value: number,
  probabilities: Record<string, number> | null = null
): CanonicalAnswer => ({ type: 'score', score: value, probabilities })

const boolean = (probability: number): CanonicalAnswer => ({
  type: 'boolean',
  probability
})

/** The `BAD_RESPONSE` error `run` throws (fails the test if it doesn't). */
function badResponse(run: () => unknown): EvaluatorError {
  try {
    run()
  } catch (error) {
    if (!(error instanceof EvaluatorError)) throw error
    expect(error.code).toBe('BAD_RESPONSE')
    expect(error.retryable).toBe(false)
    return error
  }
  throw new Error('Expected BAD_RESPONSE')
}

const resolveScore = (answer: CanonicalAnswer, question = severity) =>
  resolveAnswer(question, answer, 'severity') as Extract<
    ResolvedAnswer,
    { type: 'score' }
  >

describe('resolveAnswer — choice', () => {
  test('normalizes the probabilities and derives the confidence', () => {
    const resolved = resolveAnswer(
      category,
      choice('bug', { bug: 0.61, billing: 0.3, other: 0.09 }),
      'category'
    )
    expect(resolved).toEqual({
      type: 'choice',
      choice: 'bug',
      probabilities: {
        bug: expect.closeTo(0.61, 12),
        billing: expect.closeTo(0.3, 12),
        other: expect.closeTo(0.09, 12)
      },
      confidence: expect.closeTo(0.415, 12)
    })
  })

  test('completes the distribution over every option and drops unknown keys', () => {
    const resolved = resolveAnswer(
      category,
      choice('billing', { billing: 3, bug: 1, refund: 4 }),
      'category'
    )
    expect(resolved).toMatchObject({
      probabilities: { bug: 0.25, billing: 0.75, other: 0 }
    })
    // K = 3 options: (3·0.75 − 1)/2.
    expect(resolved).toMatchObject({ confidence: 0.625 })
  })

  test.each([
    ['none', null],
    ['all zero', { bug: 0, billing: 0, other: 0 }],
    ['only unknown keys', { refund: 1 }],
    ['something that is not a map', 'bug' as unknown as Record<string, number>]
  ])('without usable probabilities (%s) confidence is null', (_, sent) => {
    expect(resolveAnswer(category, choice('bug', sent), 'category')).toEqual({
      type: 'choice',
      choice: 'bug',
      probabilities: null,
      confidence: null
    })
  })

  test('a choice that contradicts its own distribution has no confidence', () => {
    // p_max belongs to `bug`; deciding `other` with 0.55 would auto-decide an
    // option the model gave 10% (fail-closed → null, so the run is reviewed).
    const resolved = resolveAnswer(
      category,
      choice('other', { bug: 0.7, billing: 0.2, other: 0.1 }),
      'category'
    )
    expect(resolved).toEqual({
      type: 'choice',
      choice: 'other',
      probabilities: {
        bug: expect.closeTo(0.7, 12),
        billing: expect.closeTo(0.2, 12),
        other: expect.closeTo(0.1, 12)
      },
      confidence: null
    })
  })

  test('a choice tied for the most probable keeps its confidence', () => {
    const resolved = resolveAnswer(
      category,
      choice('billing', { bug: 0.4, billing: 0.4, other: 0.2 }),
      'category'
    )
    // (3·0.4 − 1)/2.
    expect(resolved).toMatchObject({
      choice: 'billing',
      confidence: expect.closeTo(0.1, 12)
    })
  })

  test.each([
    ['an unknown option', 'refund'],
    ['an inherited property name', 'constructor'],
    ['an empty string', ''],
    ['a non-string', 3 as unknown as string],
    ['a BigInt', 10n as unknown as string],
    ['an object', { bug: true } as unknown as string]
  ])('rejects %s', (_, value) => {
    const error = badResponse(() =>
      resolveAnswer(category, choice(value), 'category')
    )
    expect(error.message).toContain('"category"')
    expect(error.message).toContain('not one of the question')
  })
})

describe('resolveAnswer — score', () => {
  test('keys the probabilities by level label and derives every field', () => {
    const resolved = resolveScore(score(1.6, { 0: 0.1, 1: 0.2, 2: 0.7 }))
    expect(resolved).toEqual({
      type: 'score',
      score: 1.6,
      scoreNorm: 0.8,
      level: 'high',
      levelIndex: 2,
      probabilities: {
        low: expect.closeTo(0.1, 12),
        medium: expect.closeTo(0.2, 12),
        high: expect.closeTo(0.7, 12)
      },
      // K = 3 levels: (3·0.7 − 1)/2.
      confidence: expect.closeTo(0.55, 12)
    })
  })

  test('the level is the argmax, not round(score)', () => {
    // score 0.95 rounds to `medium`, but `low` is the most probable level.
    const resolved = resolveScore(score(0.95, { 0: 0.4, 1: 0.25, 2: 0.35 }))
    expect(resolved.level).toBe('low')
    expect(resolved.levelIndex).toBe(0)
    expect(resolved.score).toBe(0.95)
  })

  test.each([
    ['closest to the score (high side)', 1.4, 2, 'high'],
    ['closest to the score (low side)', 0.6, 0, 'low'],
    ['the lowest when equally close', 1, 0, 'low']
  ])('a tie goes to the level %s', (_, value, index, label) => {
    const resolved = resolveScore(score(value, { 0: 0.4, 1: 0.2, 2: 0.4 }))
    expect(resolved.levelIndex).toBe(index)
    expect(resolved.level).toBe(label)
  })

  test.each([
    [1.5, 2, 'high'],
    [1.49, 1, 'medium'],
    [0.5, 1, 'medium'],
    [0.2, 0, 'low']
  ])(
    'without probabilities, score %d → round(score) = level %i',
    (value, index, label) => {
      const resolved = resolveScore(score(value))
      expect(resolved).toEqual({
        type: 'score',
        score: value,
        scoreNorm: value / 2,
        level: label,
        levelIndex: index,
        probabilities: null,
        confidence: null
      })
    }
  )

  test('all-zero probabilities count as none', () => {
    const resolved = resolveScore(score(1.2, { 0: 0, 1: 0, 2: 0 }))
    expect(resolved.probabilities).toBeNull()
    expect(resolved.confidence).toBeNull()
    expect(resolved.level).toBe('medium')
  })

  test('normalizes by index: missing levels get 0, unknown keys are dropped', () => {
    const resolved = resolveScore(
      score(1.8, { 1: 1, 2: 1, 3: 5, high: 5, '-1': 5 })
    )
    expect(resolved.probabilities).toEqual({ low: 0, medium: 0.5, high: 0.5 })
    expect(resolved.levelIndex).toBe(2)
  })

  test('confidence uses K = number of levels, not the keys the provider sent', () => {
    const four = questionSchema.parse({
      type: 'score',
      instructions: 'Priority?',
      levels: ['p4', 'p3', 'p2', 'p1'].map(label => ({ label, criteria: null }))
    })
    const resolved = resolveScore(score(0.5, { 0: 0.5, 1: 0.5 }), four)
    expect(resolved.probabilities).toEqual({ p4: 0.5, p3: 0.5, p2: 0, p1: 0 })
    // (4·0.5 − 1)/3, not (2·0.5 − 1)/1.
    expect(resolved.confidence).toBeCloseTo(1 / 3, 12)
  })

  test.each([
    ['below 0', -1, 0],
    ['above levels − 1', 7, 2],
    ['+Infinity', Number.POSITIVE_INFINITY, 2],
    ['-Infinity', Number.NEGATIVE_INFINITY, 0]
  ])('clamps a score %s', (_, value, expected) => {
    const resolved = resolveScore(score(value))
    expect(resolved.score).toBe(expected)
    expect(resolved.scoreNorm).toBe(expected / 2)
    expect(resolved.levelIndex).toBe(expected)
  })

  test.each([
    ['NaN', Number.NaN],
    ['a string', '1' as unknown as number],
    ['missing', undefined as unknown as number]
  ])('rejects a %s score', (_, value) => {
    const error = badResponse(() => resolveScore(score(value)))
    expect(error.message).toContain('"severity"')
    expect(error.message).toContain('score is not a number')
  })

  test('duplicate level labels add up (the label map cannot hold both)', () => {
    const duplicated = questionSchema.parse({
      type: 'score',
      instructions: 'Risk?',
      levels: [
        { label: 'low', criteria: null },
        { label: 'low', criteria: null },
        { label: 'high', criteria: null }
      ]
    })
    const resolved = resolveScore(
      score(0.9, { 0: 0.3, 1: 0.3, 2: 0.4 }),
      duplicated
    )
    expect(resolved.probabilities).toEqual({
      low: expect.closeTo(0.6, 12),
      high: expect.closeTo(0.4, 12)
    })
    // Still the argmax level by index, with K = 3.
    expect(resolved.level).toBe('high')
    expect(resolved.confidence).toBeCloseTo(0.1, 12)
  })

  test('a single level has nothing to normalize over', () => {
    const single = questionSchema.parse({
      type: 'score',
      instructions: 'Only one?',
      levels: [{ label: 'only', criteria: null }]
    })
    expect(resolveScore(score(0.7, { 0: 1 }), single)).toEqual({
      type: 'score',
      score: 0,
      scoreNorm: 0,
      level: 'only',
      levelIndex: 0,
      probabilities: { only: 1 },
      confidence: 1
    })
  })

  test('a question without levels cannot be answered', () => {
    const empty = questionSchema.parse({
      type: 'score',
      instructions: 'Nothing?',
      levels: []
    })
    const error = badResponse(() => resolveScore(score(0), empty))
    expect(error.message).toContain('no levels')
  })
})

describe('resolveAnswer — boolean', () => {
  test.each([
    [0.9, 0.9, 0.8],
    [0.1, 0.1, 0.8],
    [0.5, 0.5, 0],
    [1, 1, 1],
    [0, 0, 1],
    [1.2, 1, 1],
    [-0.3, 0, 1],
    [Number.POSITIVE_INFINITY, 1, 1]
  ])(
    'P(true) = %d → probability %d, confidence |2p − 1| = %d',
    (sent, probability, confidence) => {
      const resolved = resolveAnswer(urgent, boolean(sent), 'urgent')
      expect(resolved).toEqual({
        type: 'boolean',
        probability,
        confidence: expect.closeTo(confidence, 12)
      })
    }
  )

  test.each([
    ['NaN', Number.NaN],
    ['a string', '0.9' as unknown as number],
    ['null', null as unknown as number]
  ])('rejects a %s probability', (_, value) => {
    const error = badResponse(() =>
      resolveAnswer(urgent, boolean(value), 'urgent')
    )
    expect(error.message).toContain('"urgent"')
    expect(error.message).toContain('probability is not a number')
  })
})

describe('resolveAnswer — type mismatches', () => {
  test.each([
    ['choice', category, score(1)],
    ['choice', category, boolean(0.5)],
    ['score', severity, choice('low')],
    ['score', severity, boolean(0.5)],
    ['boolean', urgent, choice('bug')],
    ['boolean', urgent, score(0)]
  ])('a %s question rejects a %o answer', (type, question, answer) => {
    const error = badResponse(() => resolveAnswer(question, answer, 'q'))
    expect(error.message).toContain(`expected a ${type} answer`)
    expect(error.message).toContain(`got "${answer.type}"`)
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'bug']
  ])('rejects %s instead of an answer', (_, value) => {
    const error = badResponse(() =>
      resolveAnswer(category, value as unknown as CanonicalAnswer, 'category')
    )
    expect(error.message).toContain('expected a choice answer, got nothing')
  })

  test.each([
    ['a BigInt', 1n, 'got 1'],
    ['an object', {}, 'got an object'],
    ['an array', ['boolean'], 'got an array']
  ])('rejects %s type without crashing on the message', (_, type, got) => {
    const error = badResponse(() =>
      resolveAnswer(urgent, { type } as unknown as CanonicalAnswer, 'urgent')
    )
    expect(error.message).toContain(`expected a boolean answer, ${got}`)
  })

  test('rejects an answer without a type', () => {
    const error = badResponse(() =>
      resolveAnswer(
        urgent,
        { probability: 0.5 } as unknown as CanonicalAnswer,
        'urgent'
      )
    )
    expect(error.message).toContain('expected a boolean answer, got undefined')
  })
})

describe('resolveAnswers', () => {
  const questions: Record<string, QuestionDef> = { category, severity, urgent }

  test('resolves the asked questions and nulls the rest, in definition order', () => {
    const resolved = resolveAnswers(questions, ['urgent', 'category'], {
      category: choice('bug', { bug: 1 }),
      urgent: boolean(0.8)
    })
    expect(Object.keys(resolved)).toEqual(['category', 'severity', 'urgent'])
    expect(resolved).toEqual({
      category: {
        type: 'choice',
        choice: 'bug',
        probabilities: { bug: 1, billing: 0, other: 0 },
        confidence: 1
      },
      severity: null,
      urgent: {
        type: 'boolean',
        probability: 0.8,
        confidence: expect.closeTo(0.6, 12)
      }
    })
  })

  test('ignores extra answers and asked ids the definition does not have', () => {
    const resolved = resolveAnswers(questions, ['severity', 'ghost'], {
      severity: score(0),
      // Answered but not asked → still null.
      category: choice('bug'),
      ghost: boolean(1),
      stray: boolean(0)
    })
    expect(Object.keys(resolved)).toEqual(['category', 'severity', 'urgent'])
    expect(resolved.category).toBeNull()
    expect(resolved.urgent).toBeNull()
    expect(resolved.severity).toMatchObject({ level: 'low' })
    expect(resolved).not.toHaveProperty('ghost')
    expect(resolved).not.toHaveProperty('stray')
  })

  test('nothing asked → every answer is null, none is required', () => {
    expect(resolveAnswers(questions, [], {})).toEqual({
      category: null,
      severity: null,
      urgent: null
    })
  })

  test('a definition without questions resolves to {}', () => {
    expect(resolveAnswers({}, [], { category: choice('bug') })).toEqual({})
  })

  test.each([
    ['missing', {}],
    ['null', { urgent: null as unknown as CanonicalAnswer }],
    ['only inherited', Object.create({ urgent: boolean(1) })],
    ['in no map at all', null as unknown as Record<string, CanonicalAnswer>]
  ])('an asked question whose answer is %s is BAD_RESPONSE', (_, answers) => {
    const error = badResponse(() =>
      resolveAnswers(questions, ['urgent'], answers)
    )
    expect(error.message).toContain('"urgent"')
    expect(error.message).toContain('did not answer')
  })

  test('an invalid answer fails the whole resolution', () => {
    const error = badResponse(() =>
      resolveAnswers(questions, ['category', 'urgent'], {
        category: choice('refund'),
        urgent: boolean(1)
      })
    )
    expect(error.message).toContain('"category"')
  })

  test('duplicate asked ids resolve once', () => {
    const resolved = resolveAnswers(questions, ['urgent', 'urgent'], {
      urgent: boolean(1)
    })
    expect(resolved.urgent).toEqual({
      type: 'boolean',
      probability: 1,
      confidence: 1
    })
  })
})

describe('publicAnswers', () => {
  const resolved: ResolvedAnswers = {
    category: {
      type: 'choice',
      choice: 'bug',
      probabilities: { bug: 0.123456, billing: 2 / 3, other: 0.21 },
      confidence: 0.415_049
    },
    severity: {
      type: 'score',
      score: 1.666_666,
      scoreNorm: 0.833_333,
      level: 'high',
      levelIndex: 2,
      probabilities: { low: 0.1, medium: 0.111_16, high: 0.788_84 },
      confidence: 0.683_275
    },
    urgent: { type: 'boolean', probability: 0.912_345, confidence: 0.82469 },
    skipped: null
  }

  test('exposes the diagnostic shape of each type, rounded to 4 decimals', () => {
    expect(publicAnswers(resolved)).toEqual({
      category: {
        type: 'choice',
        choice: 'bug',
        probabilities: { bug: 0.1235, billing: 0.6667, other: 0.21 },
        confidence: 0.415
      },
      severity: {
        type: 'score',
        score: 1.6667,
        level: 'high',
        probabilities: { low: 0.1, medium: 0.1112, high: 0.7888 },
        confidence: 0.6833
      },
      urgent: { type: 'boolean', probability: 0.9123, confidence: 0.8247 },
      skipped: null
    })
  })

  test('has exactly the documented keys (no internal fields)', () => {
    const exposed = publicAnswers(resolved)
    expect(Object.keys(exposed.category ?? {})).toEqual([
      'type',
      'choice',
      'probabilities',
      'confidence'
    ])
    expect(Object.keys(exposed.severity ?? {})).toEqual([
      'type',
      'score',
      'level',
      'probabilities',
      'confidence'
    ])
    expect(Object.keys(exposed.urgent ?? {})).toEqual([
      'type',
      'probability',
      'confidence'
    ])
    expect(Object.keys(exposed)).toEqual([
      'category',
      'severity',
      'urgent',
      'skipped'
    ])
  })

  test('keeps null probabilities and confidence as null', () => {
    expect(
      publicAnswers({
        category: {
          type: 'choice',
          choice: 'other',
          probabilities: null,
          confidence: null
        },
        severity: {
          type: 'score',
          score: 1,
          scoreNorm: 0.5,
          level: 'medium',
          levelIndex: 1,
          probabilities: null,
          confidence: null
        }
      })
    ).toEqual({
      category: {
        type: 'choice',
        choice: 'other',
        probabilities: null,
        confidence: null
      },
      severity: {
        type: 'score',
        score: 1,
        level: 'medium',
        probabilities: null,
        confidence: null
      }
    })
  })

  test('does not mutate or share the resolved answers', () => {
    const snapshot = structuredClone(resolved)
    const exposed = publicAnswers(resolved)
    expect(resolved).toEqual(snapshot)

    const probabilitiesOf = (answer: unknown) =>
      (answer as { probabilities: unknown }).probabilities
    expect(exposed.category).not.toBe(resolved.category)
    expect(probabilitiesOf(exposed.category)).not.toBe(
      probabilitiesOf(resolved.category)
    )
  })

  test('no answers → {}', () => {
    expect(publicAnswers({})).toEqual({})
  })

  test('round-trips what resolveAnswers produces', () => {
    const answers = resolveAnswers(
      { category, severity, urgent },
      ['category', 'severity', 'urgent'],
      {
        category: choice('bug', { bug: 0.61, billing: 0.3, other: 0.09 }),
        severity: score(1.6, { 0: 0.1, 1: 0.2, 2: 0.7 }),
        urgent: boolean(0.9)
      }
    )
    expect(publicAnswers(answers)).toEqual({
      category: {
        type: 'choice',
        choice: 'bug',
        probabilities: { bug: 0.61, billing: 0.3, other: 0.09 },
        confidence: 0.415
      },
      severity: {
        type: 'score',
        score: 1.6,
        level: 'high',
        probabilities: { low: 0.1, medium: 0.2, high: 0.7 },
        confidence: 0.55
      },
      urgent: { type: 'boolean', probability: 0.9, confidence: 0.8 }
    })
  })
})
