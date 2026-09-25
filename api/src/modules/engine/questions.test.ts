import { describe, expect, test } from 'bun:test'
import triageRequest from '#/../test/fixtures/evaluator/support-triage.request.json'
import {
  type QuestionDef,
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import type { CanonicalQuestion } from './evaluator/port'
import { buildQuestions, toCanonicalQuestion } from './questions'

const GATE = {
  op: 'exists',
  left: { input: 'ticket.message' }
} as const

/** Maps to `test/fixtures/evaluator/support-triage.request.json`. */
const triage = templateDefinitionSchema.parse({
  kind: 'custom',
  input: {
    fields: [
      { path: 'ticket.message', type: 'string', required: true },
      {
        path: 'ticket.customer.plan',
        type: 'enum',
        enum: ['free', 'pro', 'enterprise']
      }
    ]
  },
  decisions: [
    { label: 'bug' },
    { label: 'billing' },
    { label: 'feature_request' }
  ],
  questions: {
    category: {
      type: 'choice',
      instructions: 'What is `ticket.message` about?',
      note: 'Options mirror the support queues',
      criteria: {
        bug: 'Something in the product is broken',
        billing: 'Charges, invoices, refunds or payment methods',
        feature_request: null
      }
    },
    severity: {
      type: 'score',
      instructions: 'How much is the customer blocked?',
      levels: [
        {
          label: 'not_blocked',
          criteria: 'Not blocked: cosmetic or informational'
        },
        {
          label: 'partial',
          criteria: 'Partially blocked: a workaround exists'
        },
        { label: 'blocked', criteria: 'Fully blocked: cannot continue' }
      ]
    },
    refund_requested: {
      type: 'boolean',
      instructions: 'Does the customer explicitly ask for a refund?',
      when: GATE,
      criteria: {
        true: 'Asks for money back',
        false: 'No refund requested'
      }
    }
  },
  rules: [
    {
      id: 'by_category',
      when: { all: [] },
      decision: { fromAnswer: 'category' }
    }
  ]
} satisfies TemplateDefinitionInput)

const TRIAGE_IDS = ['category', 'severity', 'refund_requested']

const FIXTURE_QUESTIONS = triageRequest.questions as Record<
  'category' | 'severity' | 'refund_requested',
  CanonicalQuestion
>

describe('toCanonicalQuestion — choice', () => {
  test('sends instructions and criteria unchanged, dropping note and when', () => {
    const question: QuestionDef = {
      type: 'choice',
      instructions: { question: 'Which queue?', focus: ['subject', 'body'] },
      note: 'author only',
      when: GATE,
      criteria: {
        bug: { what: 'Broken behavior', not_for: 'How-to questions' },
        billing: 'Charges and refunds',
        other: null
      }
    }

    expect(toCanonicalQuestion(question)).toStrictEqual({
      type: 'choice',
      instructions: { question: 'Which queue?', focus: ['subject', 'body'] },
      criteria: {
        bug: { what: 'Broken behavior', not_for: 'How-to questions' },
        billing: 'Charges and refunds',
        other: null
      }
    })
  })

  test('keeps the option order the author wrote', () => {
    const question: QuestionDef = {
      type: 'choice',
      instructions: 'Pick one',
      criteria: { zeta: null, alpha: null, mid: 'Middle' }
    }

    const canonical = toCanonicalQuestion(question)

    expect(
      canonical.type === 'choice' && Object.keys(canonical.criteria)
    ).toEqual(['zeta', 'alpha', 'mid'])
  })

  test('an empty criteria record passes through (lint rejects it)', () => {
    expect(
      toCanonicalQuestion({
        type: 'choice',
        instructions: 'Pick',
        criteria: {}
      })
    ).toStrictEqual({ type: 'choice', instructions: 'Pick', criteria: {} })
  })
})

describe('toCanonicalQuestion — score', () => {
  test('sends each level description, lowest first', () => {
    const question: QuestionDef = {
      type: 'score',
      instructions: 'How urgent?',
      note: 'author only',
      when: GATE,
      levels: [
        { label: 'low', criteria: 'Can wait a week' },
        { label: 'mid', criteria: { what: 'Needs an answer today' } },
        { label: 'high', criteria: ['Outage', 'Deadline'] }
      ]
    }

    expect(toCanonicalQuestion(question)).toStrictEqual({
      type: 'score',
      instructions: 'How urgent?',
      criteria: [
        'Can wait a week',
        { what: 'Needs an answer today' },
        ['Outage', 'Deadline']
      ]
    })
  })

  test('a level without a description is sent as its label', () => {
    const question: QuestionDef = {
      type: 'score',
      instructions: 'Rate it',
      levels: [
        { label: '1', criteria: null },
        { label: 'good', criteria: 'Works well' },
        { label: 'excellent', criteria: null }
      ]
    }

    expect(toCanonicalQuestion(question)).toStrictEqual({
      type: 'score',
      instructions: 'Rate it',
      criteria: ['1', 'Works well', 'excellent']
    })
  })

  test('no levels → empty criteria (lint rejects it)', () => {
    expect(
      toCanonicalQuestion({ type: 'score', instructions: 'Rate', levels: [] })
    ).toStrictEqual({ type: 'score', instructions: 'Rate', criteria: [] })
  })
})

describe('toCanonicalQuestion — boolean', () => {
  test.each<{
    name: string
    criteria: Extract<QuestionDef, { type: 'boolean' }>['criteria']
    expected: Record<string, unknown> | undefined
  }>([
    { name: 'no criteria', criteria: undefined, expected: undefined },
    { name: 'an empty object', criteria: {}, expected: undefined },
    {
      name: 'both entries undefined',
      criteria: { true: undefined, false: undefined },
      expected: undefined
    },
    { name: 'only true', criteria: { true: 'Yes' }, expected: { true: 'Yes' } },
    {
      name: 'only false',
      criteria: { false: 'No' },
      expected: { false: 'No' }
    },
    {
      name: 'both',
      criteria: { true: 'Yes', false: { what: 'No' } },
      expected: { true: 'Yes', false: { what: 'No' } }
    },
    {
      name: 'an explicit null',
      criteria: { true: null, false: 'No' },
      expected: { true: null, false: 'No' }
    },
    {
      name: 'only nulls',
      criteria: { true: null, false: null },
      expected: { true: null, false: null }
    }
  ])('criteria with $name', ({ criteria, expected }) => {
    const canonical = toCanonicalQuestion({
      type: 'boolean',
      instructions: 'Is it urgent?',
      note: 'author only',
      when: GATE,
      ...(criteria === undefined ? {} : { criteria })
    })

    expect(canonical).toStrictEqual(
      expected === undefined
        ? { type: 'boolean', instructions: 'Is it urgent?' }
        : { type: 'boolean', instructions: 'Is it urgent?', criteria: expected }
    )
    expect('criteria' in canonical).toBe(expected !== undefined)
  })

  test('criteria are sent true first, whatever order the author used', () => {
    const canonical = toCanonicalQuestion({
      type: 'boolean',
      instructions: 'Refund?',
      criteria: { false: 'No', true: 'Yes' }
    })

    expect(
      canonical.type === 'boolean' && Object.keys(canonical.criteria ?? {})
    ).toEqual(['true', 'false'])
  })
})

describe('toCanonicalQuestion — purity', () => {
  test.each(Object.keys(triage.questions))(
    'the result shares nothing with the %s question',
    id => {
      const question = triage.questions[id] as QuestionDef
      const before = structuredClone(question)

      const canonical = toCanonicalQuestion(question)
      mutateDeep(canonical)

      expect(question).toStrictEqual(before)
    }
  )
})

describe('buildQuestions', () => {
  test('reproduces the support-triage fixture questions exactly', () => {
    const questions = buildQuestions(triage, TRIAGE_IDS)

    expect(questions).toStrictEqual(FIXTURE_QUESTIONS)
    expect(JSON.stringify(questions)).toBe(JSON.stringify(FIXTURE_QUESTIONS))
  })

  test('only the asked ids, in the given order', () => {
    const questions = buildQuestions(triage, ['refund_requested', 'category'])

    expect(Object.keys(questions)).toEqual(['refund_requested', 'category'])
    expect(questions).toStrictEqual({
      refund_requested: FIXTURE_QUESTIONS.refund_requested,
      category: FIXTURE_QUESTIONS.category
    })
  })

  test('nothing asked → no questions', () => {
    expect(buildQuestions(triage, [])).toStrictEqual({})
  })

  test('a repeated id is sent once, at its first position', () => {
    const questions = buildQuestions(triage, [
      'severity',
      'category',
      'severity'
    ])

    expect(Object.keys(questions)).toEqual(['severity', 'category'])
    expect(questions.severity).toStrictEqual(FIXTURE_QUESTIONS.severity)
  })

  test.each(['urgency', 'constructor', 'toString', '__proto__', ''])(
    'an undeclared id (%p) throws',
    id => {
      expect(() => buildQuestions(triage, ['category', id])).toThrow(
        `Unknown question "${id}"`
      )
    }
  )

  test('a definition without questions only accepts an empty list', () => {
    const empty = templateDefinitionSchema.parse({
      kind: 'custom',
      input: { fields: [] },
      decisions: [{ label: 'ok' }]
    })

    expect(buildQuestions(empty, [])).toStrictEqual({})
    expect(() => buildQuestions(empty, ['category'])).toThrow(Error)
  })

  test('never mutates the definition', () => {
    const before = structuredClone(triage)

    mutateDeep(buildQuestions(triage, TRIAGE_IDS))

    expect(triage).toStrictEqual(before)
  })
})

/** Overwrites every string/array/object reachable from `value`. */
function mutateDeep(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      mutateDeep(item)
      value[index] = 'mutated'
    })
    value.push('extra')
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      mutateDeep(record[key])
      record[key] = 'mutated'
    }
    record.extra = 'mutated'
  }
}

describe('unvalidated definitions', () => {
  test('an unknown question type throws instead of dropping the question', () => {
    const question = {
      type: 'ranking',
      instructions: 'Order them'
    } as unknown as QuestionDef

    expect(() => toCanonicalQuestion(question)).toThrow(
      'Unknown question type "ranking"'
    )
    expect(() =>
      buildQuestions({ questions: { order: question } }, ['order'])
    ).toThrow('Unknown question type "ranking"')
  })

  test('an own `__proto__` id is sent as a key, never as the prototype', () => {
    const questions = JSON.parse(
      '{"__proto__": {"type": "boolean", "instructions": "Urgent?"}}'
    ) as Record<string, QuestionDef>

    const built = buildQuestions({ questions }, ['__proto__'])

    expect(Object.getPrototypeOf(built)).toBe(Object.prototype)
    expect(Object.hasOwn(built, '__proto__')).toBe(true)
    expect(JSON.stringify(built)).toBe(
      '{"__proto__":{"type":"boolean","instructions":"Urgent?"}}'
    )
  })
})
