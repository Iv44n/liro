import { describe, expect, test } from 'bun:test'
import z from 'zod'
import {
  type InputField,
  NEEDS_REVIEW,
  type TemplateDefinition,
  templateDefinitionSchema
} from './definition'
import { lintDefinition } from './lint'
import {
  CLASSIFY_DEFAULTS,
  type ClassifyWizardInput,
  classifyDefinition,
  classifyThreshold,
  DECIDE_DEFAULTS,
  type DecideWizardInput,
  decideDefinition,
  decideThresholds,
  SCORE_DEFAULTS,
  type ScoreWizardInput,
  scoreDefinition,
  type WizardLabel
} from './wizards'

const LABELS: WizardLabel[] = [
  { label: 'bug', description: 'Something in the product is broken' },
  {
    label: 'billing',
    description: 'Money matters',
    criteria: { what: 'Charges and invoices', not_for: 'Login problems' }
  },
  { label: 'other' }
]

const classify = (overrides: Partial<ClassifyWizardInput> = {}) =>
  classifyDefinition({
    instructions: 'What is `text` about?',
    labels: LABELS,
    ...overrides
  })

const decide = (overrides: Partial<DecideWizardInput> = {}) =>
  decideDefinition({
    instructions: 'Does the customer ask for a refund?',
    yes: { label: 'refund', description: 'Asks for money back' },
    no: { label: 'no_refund' },
    ...overrides
  })

const LEVELS: WizardLabel[] = [
  { label: 'low', description: 'Cosmetic or informational' },
  {
    label: 'medium',
    description: 'A workaround exists',
    criteria: { what: 'Slows the customer down', not_for: 'A full outage' }
  },
  { label: 'high' }
]

const score = (overrides: Partial<ScoreWizardInput> = {}) =>
  scoreDefinition({
    instructions: 'How blocked is the customer?',
    levels: LEVELS,
    ...overrides
  })

const FIELDS: InputField[] = [
  { path: 'ticket.message', type: 'string', required: true, maxLength: 500 },
  { path: 'ticket.plan', type: 'enum', required: false, enum: ['free', 'pro'] }
]

/** A boolean's confidence, computed as the engine does (`|2p − 1|`). */
const booleanConfidence = (p: number) => Math.abs(2 * p - 1)

describe('classifyDefinition', () => {
  test('produces a definition the schema accepts unchanged', () => {
    const definition = classify()
    expect(templateDefinitionSchema.parse(definition)).toEqual(definition)
  })

  test('builds the always-match rule, per-label minConfidence and a review fallback', () => {
    expect(classify()).toEqual({
      kind: 'classify',
      model: { family: 'jev' },
      input: {
        fields: [
          {
            path: 'text',
            type: 'string',
            required: true,
            description: 'The text to classify'
          }
        ]
      },
      state: {},
      decisions: [
        {
          label: 'bug',
          description: 'Something in the product is broken',
          minConfidence: 0.8
        },
        { label: 'billing', description: 'Money matters', minConfidence: 0.8 },
        { label: 'other', minConfidence: 0.8 }
      ],
      preconditions: [],
      questions: {
        category: {
          type: 'choice',
          instructions: 'What is `text` about?',
          criteria: {
            bug: 'Something in the product is broken',
            billing: {
              what: 'Charges and invoices',
              not_for: 'Login problems'
            },
            other: null
          }
        }
      },
      signals: [],
      flagRules: [],
      rules: [
        {
          id: 'classify',
          when: { all: [] },
          decision: { fromAnswer: 'category' }
        }
      ],
      fallback: { decision: NEEDS_REVIEW }
    })
  })

  test('keeps the labels order for options and decisions', () => {
    const labels = ['zeta', 'alpha', 'mid'].map(label => ({ label }))
    const definition = classify({ labels })
    const question = definition.questions.category
    expect(
      question?.type === 'choice' && Object.keys(question.criteria)
    ).toEqual(['zeta', 'alpha', 'mid'])
    expect(definition.decisions.map(decision => decision.label)).toEqual([
      'zeta',
      'alpha',
      'mid'
    ])
  })

  test.each<[string, WizardLabel, unknown, string | undefined]>([
    [
      'object criteria win over the description',
      { label: 'a', description: 'Desc', criteria: { what: 'W' } },
      { what: 'W' },
      'Desc'
    ],
    [
      'string criteria win over the description',
      { label: 'a', description: 'Desc', criteria: 'Crit' },
      'Crit',
      'Desc'
    ],
    [
      'array criteria are kept',
      { label: 'a', criteria: ['one', 'two'] },
      ['one', 'two'],
      undefined
    ],
    [
      'null criteria fall back to the description',
      { label: 'a', description: 'Desc', criteria: null },
      'Desc',
      'Desc'
    ],
    [
      'no criteria fall back to the description',
      { label: 'a', description: 'Desc' },
      'Desc',
      'Desc'
    ],
    ['neither gives null', { label: 'a' }, null, undefined],
    [
      'a blank description is treated as absent',
      { label: 'a', description: '   ' },
      null,
      undefined
    ],
    [
      'blank string criteria fall back to the description',
      { label: 'a', description: 'Desc', criteria: ' ' },
      'Desc',
      'Desc'
    ]
  ])('criteria: %s', (_, label, criteria, description) => {
    const definition = classify({ labels: [label, { label: 'b' }] })
    const question = definition.questions.category
    expect(question?.type).toBe('choice')
    if (question?.type !== 'choice') return
    expect(question.criteria.a).toEqual(criteria as never)
    expect(definition.decisions[0]?.description).toBe(description)
    expect(
      definition.decisions[0] && 'description' in definition.decisions[0]
    ).toBe(description !== undefined)
  })

  test('takes custom fields, question id and minConfidence', () => {
    const definition = classify({
      fields: FIELDS,
      questionId: 'topic',
      minConfidence: 0.65
    })
    expect(definition.input.fields).toEqual(FIELDS)
    expect(Object.keys(definition.questions)).toEqual(['topic'])
    expect(definition.rules[0]?.decision).toEqual({ fromAnswer: 'topic' })
    expect(
      definition.decisions.map(decision => decision.minConfidence)
    ).toEqual([0.65, 0.65, 0.65])
  })

  test('is publishable as is: no lint issues', () => {
    expect(lintDefinition(classify(), { maxContextTokens: 32_000 })).toEqual([])
  })

  test('exposes its defaults', () => {
    expect(CLASSIFY_DEFAULTS).toEqual({
      minConfidence: 0.8,
      questionId: 'category'
    })
  })

  test.each([0, 0.5, 1])('accepts minConfidence %p', minConfidence => {
    expect(classifyThreshold(classify({ minConfidence }))).toBe(minConfidence)
  })

  test.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects minConfidence %p with a RangeError',
    minConfidence => {
      expect(() => classify({ minConfidence })).toThrow(RangeError)
    }
  )

  test.each<[string, unknown]>([
    ['a numeric string', '0.8'],
    ['a boolean', true],
    ['an array', [0.8]]
  ])(
    'rejects a non-number minConfidence (%s) with a RangeError, not coercion',
    (_, minConfidence) => {
      expect(() =>
        classify({ minConfidence: minConfidence as number })
      ).toThrow(RangeError)
    }
  )

  test.each<[string, Partial<ClassifyWizardInput>]>([
    ['an invalid label', { labels: [{ label: 'Bug Report' }] }],
    ['an invalid question id', { questionId: 'Category' }],
    ['empty instructions', { instructions: '' }],
    [
      'an invalid field',
      { fields: [{ path: 'a..b', type: 'string', required: true }] }
    ]
  ])('lets the schema reject %s', (_, overrides) => {
    expect(() => classify(overrides)).toThrow(z.ZodError)
  })

  test('leaves semantic checks to lint: duplicate, reserved or too few labels pass', () => {
    const duplicated = classify({
      labels: [{ label: 'a' }, { label: 'a' }, { label: NEEDS_REVIEW }]
    })
    expect(duplicated.decisions.map(decision => decision.label)).toEqual([
      'a',
      'a',
      NEEDS_REVIEW
    ])

    const empty = classify({ labels: [] })
    expect(empty.decisions).toEqual([])
    expect(empty.questions.category).toEqual({
      type: 'choice',
      instructions: 'What is `text` about?',
      criteria: {}
    })
  })

  test('shares no objects with its input or between calls', () => {
    const labels: WizardLabel[] = [
      { label: 'a', criteria: { what: 'W', examples: ['x'] } },
      { label: 'b' }
    ]
    const instructions = { question: 'Which?', inspect: ['`text`'] }
    const fields: InputField[] = [
      { path: 'text', type: 'string', required: true }
    ]
    const definition = classify({ labels, instructions, fields })

    const question = definition.questions.category
    if (question?.type !== 'choice') throw new Error('Expected a choice')
    ;(question.criteria.a as { what: string }).what = 'changed'
    ;(question.instructions as { question: string }).question = 'changed'
    definition.input.fields[0] = {
      path: 'other',
      type: 'number',
      required: false
    }

    expect(labels[0]?.criteria).toEqual({ what: 'W', examples: ['x'] })
    expect(instructions.question).toBe('Which?')
    expect(fields[0]?.path).toBe('text')

    const first = classify()
    first.input.fields.pop()
    expect(classify().input.fields).toHaveLength(1)
  })
})

describe('decideDefinition', () => {
  test('produces a definition the schema accepts unchanged', () => {
    const definition = decide()
    expect(templateDefinitionSchema.parse(definition)).toEqual(definition)
  })

  test('builds the P(yes) split, confidence-gated labels and a review fallback', () => {
    expect(decide()).toEqual({
      kind: 'decide',
      model: { family: 'jev' },
      input: {
        fields: [
          {
            path: 'text',
            type: 'string',
            required: true,
            description: 'The text to decide on'
          }
        ]
      },
      state: {},
      decisions: [
        {
          label: 'refund',
          description: 'Asks for money back',
          minConfidence: 0.8
        },
        { label: 'no_refund', minConfidence: 0.8 }
      ],
      preconditions: [],
      questions: {
        answer: {
          type: 'boolean',
          instructions: 'Does the customer ask for a refund?',
          criteria: { true: 'Asks for money back' }
        }
      },
      signals: [],
      flagRules: [],
      rules: [
        {
          id: 'yes',
          when: {
            op: 'gte',
            left: { answer: 'answer', field: 'probability' },
            right: { value: 0.5 }
          },
          decision: 'refund',
          confidenceFrom: 'answer'
        },
        {
          id: 'no',
          when: { all: [] },
          decision: 'no_refund',
          confidenceFrom: 'answer'
        }
      ],
      fallback: { decision: NEEDS_REVIEW }
    })
  })

  test.each<[string, WizardLabel, WizardLabel, unknown]>([
    [
      'both sides',
      { label: 'y', criteria: { what: 'Yes' } },
      { label: 'n', description: 'No' },
      { true: { what: 'Yes' }, false: 'No' }
    ],
    [
      'only the no side',
      { label: 'y' },
      { label: 'n', criteria: 'No' },
      { false: 'No' }
    ],
    ['neither side', { label: 'y' }, { label: 'n', criteria: null }, undefined]
  ])('boolean criteria: %s', (_, yes, no, criteria) => {
    const question = decide({ yes, no }).questions.answer
    expect(question?.type).toBe('boolean')
    if (question?.type !== 'boolean') return
    expect(question.criteria).toEqual(criteria as never)
    expect('criteria' in question).toBe(criteria !== undefined)
  })

  test('takes custom fields and question id', () => {
    const definition = decide({ fields: FIELDS, questionId: 'refund_asked' })
    expect(definition.input.fields).toEqual(FIELDS)
    expect(Object.keys(definition.questions)).toEqual(['refund_asked'])
    expect(definition.rules.map(rule => rule.confidenceFrom)).toEqual([
      'refund_asked',
      'refund_asked'
    ])
    expect(definition.rules[0]?.when).toEqual({
      op: 'gte',
      left: { answer: 'refund_asked', field: 'probability' },
      right: { value: 0.5 }
    })
  })

  test('is publishable as is: no lint issues', () => {
    const definition = decide({
      instructions: 'Does `text` ask for a refund?',
      yesThreshold: 0.8,
      noThreshold: 0.3
    })
    expect(lintDefinition(definition, { maxContextTokens: 32_000 })).toEqual([])
  })

  test('exposes its defaults', () => {
    expect(DECIDE_DEFAULTS).toEqual({
      yesThreshold: 0.9,
      noThreshold: 0.1,
      questionId: 'answer'
    })
  })

  test.each([
    [0.9, 0.1, 0.8, 0.8],
    [0.75, 0.25, 0.5, 0.5],
    [0.6, 0.45, 0.2, 0.1],
    [0.99, 0.3, 0.98, 0.4],
    [1, 0, 1, 1]
  ])(
    'thresholds %p / %p → minConfidence %p / %p',
    (yesThreshold, noThreshold, yesMin, noMin) => {
      const [yes, no] = decide({ yesThreshold, noThreshold }).decisions
      expect(yes?.minConfidence).toBeCloseTo(yesMin, 12)
      expect(no?.minConfidence).toBeCloseTo(noMin, 12)
    }
  )

  test.each([
    [0.9, 0.1],
    [0.95, 0.05],
    [0.85, 0.15],
    [0.7, 0.3],
    [0.55, 0.45],
    [0.51, 0.49],
    [0.999, 0.001],
    [1, 0]
  ])(
    'P ≥ %p decides yes and P ≤ %p decides no, thresholds included',
    (yesThreshold, noThreshold) => {
      const definition = decide({ yesThreshold, noThreshold })
      const [yesMin, noMin] = definition.decisions.map(
        decision => decision.minConfidence ?? Number.NaN
      ) as [number, number]
      // The wizard's rules: P ≥ 0.5 proposes yes, anything else proposes no;
      // the label decides only when its minConfidence is met.
      const decidesYes = (p: number) =>
        p >= 0.5 && booleanConfidence(p) >= yesMin
      const decidesNo = (p: number) => p < 0.5 && booleanConfidence(p) >= noMin

      for (let step = 0; step <= 1000; step++) {
        const p = step / 1000
        expect(decidesYes(p)).toBe(p >= yesThreshold)
        expect(decidesNo(p)).toBe(p <= noThreshold)
      }
      expect(decidesYes(yesThreshold)).toBe(true)
      expect(decidesYes(yesThreshold - 1e-9)).toBe(false)
      expect(decidesNo(noThreshold)).toBe(true)
      expect(decidesNo(noThreshold + 1e-9)).toBe(false)
    }
  )

  test.each([
    ['yesThreshold', 0.5],
    ['yesThreshold', 0.3],
    ['yesThreshold', 1.01],
    ['yesThreshold', Number.NaN],
    ['yesThreshold', Number.POSITIVE_INFINITY],
    ['noThreshold', 0.5],
    ['noThreshold', 0.7],
    ['noThreshold', -0.01],
    ['noThreshold', Number.NaN],
    ['noThreshold', Number.NEGATIVE_INFINITY]
  ] as const)('rejects %s = %p with a RangeError', (name, value) => {
    expect(() => decide({ [name]: value })).toThrow(RangeError)
    expect(() => decide({ [name]: value })).toThrow(name)
  })

  test.each<[string, unknown]>([
    ['yesThreshold', '0.9'],
    ['yesThreshold', true],
    ['yesThreshold', [0.9]],
    ['noThreshold', '0.1'],
    ['noThreshold', false],
    ['noThreshold', [0.1]]
  ])(
    'rejects a non-number %s (%p) with a RangeError, not coercion',
    (name, value) => {
      expect(() => decide({ [name]: value as number })).toThrow(RangeError)
    }
  )

  test('lets the schema reject invalid labels', () => {
    expect(() => decide({ yes: { label: 'Yes!' } })).toThrow(z.ZodError)
  })
})

describe('scoreDefinition', () => {
  test('produces a definition the schema accepts unchanged', () => {
    const definition = score()
    expect(templateDefinitionSchema.parse(definition)).toEqual(definition)
  })

  test('builds the always-match rule, per-label minConfidence and a review fallback', () => {
    expect(score()).toEqual({
      kind: 'score',
      model: { family: 'jev' },
      input: {
        fields: [
          {
            path: 'text',
            type: 'string',
            required: true,
            description: 'The text to score'
          }
        ]
      },
      state: {},
      decisions: [
        {
          label: 'low',
          description: 'Cosmetic or informational',
          minConfidence: 0.8
        },
        {
          label: 'medium',
          description: 'A workaround exists',
          minConfidence: 0.8
        },
        { label: 'high', minConfidence: 0.8 }
      ],
      preconditions: [],
      questions: {
        level: {
          type: 'score',
          instructions: 'How blocked is the customer?',
          levels: [
            { label: 'low', criteria: 'Cosmetic or informational' },
            {
              label: 'medium',
              criteria: {
                what: 'Slows the customer down',
                not_for: 'A full outage'
              }
            },
            { label: 'high', criteria: null }
          ]
        }
      },
      signals: [],
      flagRules: [],
      rules: [
        {
          id: 'score',
          when: { all: [] },
          decision: { fromAnswer: 'level' }
        }
      ],
      fallback: { decision: NEEDS_REVIEW }
    })
  })

  test('keeps the levels order for the question and the decisions', () => {
    const levels = ['zeta', 'alpha', 'mid'].map(label => ({ label }))
    const definition = score({ levels })
    const question = definition.questions.level
    expect(
      question?.type === 'score' && question.levels.map(l => l.label)
    ).toEqual(['zeta', 'alpha', 'mid'])
    expect(definition.decisions.map(decision => decision.label)).toEqual([
      'zeta',
      'alpha',
      'mid'
    ])
  })

  test.each<[string, WizardLabel, unknown, string | undefined]>([
    [
      'object criteria win over the description',
      { label: 'a', description: 'Desc', criteria: { what: 'W' } },
      { what: 'W' },
      'Desc'
    ],
    [
      'string criteria win over the description',
      { label: 'a', description: 'Desc', criteria: 'Crit' },
      'Crit',
      'Desc'
    ],
    [
      'array criteria are kept',
      { label: 'a', criteria: ['one', 'two'] },
      ['one', 'two'],
      undefined
    ],
    [
      'null criteria fall back to the description',
      { label: 'a', description: 'Desc', criteria: null },
      'Desc',
      'Desc'
    ],
    [
      'no criteria fall back to the description',
      { label: 'a', description: 'Desc' },
      'Desc',
      'Desc'
    ],
    ['neither gives null', { label: 'a' }, null, undefined],
    [
      'a blank description is treated as absent',
      { label: 'a', description: '   ' },
      null,
      undefined
    ],
    [
      'blank string criteria fall back to the description',
      { label: 'a', description: 'Desc', criteria: ' ' },
      'Desc',
      'Desc'
    ]
  ])('criteria: %s', (_, level, criteria, description) => {
    const definition = score({ levels: [level, { label: 'b' }] })
    const question = definition.questions.level
    expect(question?.type).toBe('score')
    if (question?.type !== 'score') return
    expect(question.levels[0]?.criteria).toEqual(criteria as never)
    expect(definition.decisions[0]?.description).toBe(description)
    expect(
      definition.decisions[0] && 'description' in definition.decisions[0]
    ).toBe(description !== undefined)
  })

  test('takes custom fields, question id and minConfidence', () => {
    const definition = score({
      fields: FIELDS,
      questionId: 'severity',
      minConfidence: 0.65
    })
    expect(definition.input.fields).toEqual(FIELDS)
    expect(Object.keys(definition.questions)).toEqual(['severity'])
    expect(definition.rules[0]?.decision).toEqual({ fromAnswer: 'severity' })
    expect(
      definition.decisions.map(decision => decision.minConfidence)
    ).toEqual([0.65, 0.65, 0.65])
  })

  test('is publishable as is: no lint issues', () => {
    expect(lintDefinition(score(), { maxContextTokens: 32_000 })).toEqual([])
  })

  test('exposes its defaults', () => {
    expect(SCORE_DEFAULTS).toEqual({
      minConfidence: 0.8,
      questionId: 'level'
    })
  })

  test.each([0, 0.5, 1])('accepts minConfidence %p', minConfidence => {
    expect(classifyThreshold(score({ minConfidence }))).toBe(minConfidence)
  })

  test.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects minConfidence %p with a RangeError',
    minConfidence => {
      expect(() => score({ minConfidence })).toThrow(RangeError)
    }
  )

  test.each<[string, unknown]>([
    ['a numeric string', '0.8'],
    ['a boolean', true],
    ['an array', [0.8]]
  ])(
    'rejects a non-number minConfidence (%s) with a RangeError, not coercion',
    (_, minConfidence) => {
      expect(() => score({ minConfidence: minConfidence as number })).toThrow(
        RangeError
      )
    }
  )

  test.each<[string, Partial<ScoreWizardInput>]>([
    ['an invalid level label', { levels: [{ label: 'Not Valid' }] }],
    ['an invalid question id', { questionId: 'Level' }],
    ['empty instructions', { instructions: '' }],
    [
      'an invalid field',
      { fields: [{ path: 'a..b', type: 'string', required: true }] }
    ]
  ])('lets the schema reject %s', (_, overrides) => {
    expect(() => score(overrides)).toThrow(z.ZodError)
  })

  test('leaves semantic checks to lint: duplicate, reserved or too few levels pass', () => {
    const duplicated = score({
      levels: [{ label: 'a' }, { label: 'a' }, { label: NEEDS_REVIEW }]
    })
    expect(duplicated.decisions.map(decision => decision.label)).toEqual([
      'a',
      'a',
      NEEDS_REVIEW
    ])
    const question = duplicated.questions.level
    expect(
      question?.type === 'score' && question.levels.map(l => l.label)
    ).toEqual(['a', 'a', NEEDS_REVIEW])

    const empty = score({ levels: [] })
    expect(empty.decisions).toEqual([])
    expect(empty.questions.level).toEqual({
      type: 'score',
      instructions: 'How blocked is the customer?',
      levels: []
    })

    const single = score({ levels: [{ label: 'only' }] })
    expect(single.decisions).toHaveLength(1)
  })

  test('shares no objects with its input or between calls', () => {
    const levels: WizardLabel[] = [
      { label: 'a', criteria: { what: 'W', examples: ['x'] } },
      { label: 'b' }
    ]
    const instructions = { question: 'How much?', inspect: ['`text`'] }
    const fields: InputField[] = [
      { path: 'text', type: 'string', required: true }
    ]
    const definition = score({ levels, instructions, fields })

    const question = definition.questions.level
    if (question?.type !== 'score') throw new Error('Expected a score')
    ;(question.levels[0]?.criteria as { what: string }).what = 'changed'
    ;(question.instructions as { question: string }).question = 'changed'
    definition.input.fields[0] = {
      path: 'other',
      type: 'number',
      required: false
    }

    expect(levels[0]?.criteria).toEqual({ what: 'W', examples: ['x'] })
    expect(instructions.question).toBe('How much?')
    expect(fields[0]?.path).toBe('text')

    const first = score()
    first.input.fields.pop()
    expect(score().input.fields).toHaveLength(1)
  })
})

describe('decideThresholds', () => {
  test('reads the default thresholds back', () => {
    expect(decideThresholds(decide())).toEqual({
      yesThreshold: 0.9,
      noThreshold: 0.1
    })
  })

  test.each([
    [0.95, 0.05],
    [0.85, 0.15],
    [0.55, 0.45],
    [0.51, 0.49],
    [0.999, 0.001],
    [0.8765, 0.0123],
    [0.6, 0.2],
    [1, 0]
  ])('round-trips %p / %p exactly', (yesThreshold, noThreshold) => {
    expect(decideThresholds(decide({ yesThreshold, noThreshold }))).toEqual({
      yesThreshold,
      noThreshold
    })
  })

  test('round-trips every threshold with up to 3 decimals', () => {
    for (let step = 501; step <= 1000; step++) {
      const yesThreshold = step / 1000
      expect(decideThresholds(decide({ yesThreshold }))?.yesThreshold).toBe(
        yesThreshold
      )
    }
    for (let step = 0; step < 500; step++) {
      const noThreshold = step / 1000
      expect(decideThresholds(decide({ noThreshold }))?.noThreshold).toBe(
        noThreshold
      )
    }
  })

  test.each([
    [0.5 + Math.PI / 10, Math.E / 100],
    [0.500000000001, 1e-10],
    [0.7234567890123457, 0.4999999999999]
  ])(
    'any thresholds %p / %p rebuild the same definition',
    (yesThreshold, noThreshold) => {
      const definition = decide({ yesThreshold, noThreshold })
      const thresholds = decideThresholds(definition)
      expect(thresholds).not.toBeNull()
      expect(decide({ ...thresholds })).toEqual(definition)
    }
  )

  test('shows hand-edited minConfidence values as the nearest short threshold', () => {
    const definition = decide()
    definition.decisions[0] = { label: 'refund', minConfidence: 0.7 }
    definition.decisions[1] = { label: 'no_refund', minConfidence: 0.3 }
    expect(decideThresholds(definition)).toEqual({
      yesThreshold: 0.85,
      noThreshold: 0.35
    })
  })

  test('ignores the other sections and the rule ids', () => {
    const definition = templateDefinitionSchema.parse({
      ...decide({ yesThreshold: 0.8, noThreshold: 0.2 }),
      preconditions: [
        {
          id: 'empty',
          when: { op: 'len_lt', left: { input: 'text' }, right: { value: 3 } },
          decision: 'no_refund'
        }
      ],
      flagRules: [
        {
          id: 'angry',
          when: {
            op: 'gte',
            left: { answer: 'angry', field: 'probability' },
            right: { value: 0.7 }
          },
          flags: ['angry']
        }
      ],
      questions: {
        answer: { type: 'boolean', instructions: 'Refund?' },
        angry: { type: 'boolean', instructions: 'Angry?' }
      },
      rules: decide().rules.map((rule, index) => ({
        ...rule,
        id: `rule_${index}`
      })),
      fallback: { decision: 'no_refund' }
    })
    expect(decideThresholds(definition)).toEqual({
      yesThreshold: 0.8,
      noThreshold: 0.2
    })
  })

  type Mutation = (definition: TemplateDefinition) => void
  const [yesRule, noRule] = decide().rules as [
    TemplateDefinition['rules'][number],
    TemplateDefinition['rules'][number]
  ]
  const yesWhen = (right: unknown, overrides: object = {}) => ({
    op: 'gte' as const,
    left: { answer: 'answer', field: 'probability' as const },
    right: right as { value: number },
    ...overrides
  })

  test.each<[string, Mutation]>([
    ['a single rule', d => d.rules.pop()],
    [
      'an extra rule',
      d => d.rules.unshift({ ...noRule, id: 'first', decision: 'refund' })
    ],
    ['no rules', d => d.rules.splice(0)],
    [
      'a non-boolean question',
      d => {
        d.questions.answer = {
          type: 'choice',
          instructions: 'Which?',
          criteria: { refund: null, no_refund: null }
        }
      }
    ],
    [
      'a missing question',
      d => {
        delete d.questions.answer
      }
    ],
    [
      'a split other than 0.5',
      d => (d.rules[0] = { ...yesRule, when: yesWhen({ value: 0.6 }) })
    ],
    [
      'a non-numeric split',
      d => (d.rules[0] = { ...yesRule, when: yesWhen({ value: '0.5' }) })
    ],
    [
      'a split against an input',
      d => (d.rules[0] = { ...yesRule, when: yesWhen({ input: 'text' }) })
    ],
    [
      'gt instead of gte',
      d =>
        (d.rules[0] = {
          ...yesRule,
          when: yesWhen({ value: 0.5 }, { op: 'gt' })
        })
    ],
    [
      'a split on confidence',
      d =>
        (d.rules[0] = {
          ...yesRule,
          when: yesWhen(
            { value: 0.5 },
            { left: { answer: 'answer', field: 'confidence' } }
          )
        })
    ],
    [
      'a split on another question',
      d =>
        (d.rules[0] = {
          ...yesRule,
          when: yesWhen(
            { value: 0.5 },
            { left: { answer: 'other', field: 'probability' } }
          )
        })
    ],
    [
      'a split on a signal',
      d =>
        (d.rules[0] = {
          ...yesRule,
          when: yesWhen({ value: 0.5 }, { left: { signal: 'answer' } })
        })
    ],
    [
      'a composite yes condition',
      d =>
        (d.rules[0] = { ...yesRule, when: { all: [yesWhen({ value: 0.5 })] } })
    ],
    [
      'a no rule that is not a catch-all',
      d => (d.rules[1] = { ...noRule, when: { any: [] } })
    ],
    [
      'a no rule with conditions',
      d =>
        (d.rules[1] = { ...noRule, when: { all: [yesWhen({ value: 0.5 })] } })
    ],
    [
      'no confidenceFrom on the yes rule',
      d => (d.rules[0] = { ...yesRule, confidenceFrom: undefined })
    ],
    [
      'another confidenceFrom on the no rule',
      d => (d.rules[1] = { ...noRule, confidenceFrom: 'other' })
    ],
    [
      'a fromAnswer yes decision',
      d => (d.rules[0] = { ...yesRule, decision: { fromAnswer: 'answer' } })
    ],
    [
      'a fromAnswer no decision',
      d => (d.rules[1] = { ...noRule, decision: { fromAnswer: 'answer' } })
    ],
    [
      'the same label on both rules',
      d => (d.rules[1] = { ...noRule, decision: 'refund' })
    ],
    [
      'a needs_review yes rule',
      d => (d.rules[0] = { ...yesRule, decision: NEEDS_REVIEW })
    ],
    ['an undeclared no label', d => d.decisions.pop()],
    ['no minConfidence on yes', d => (d.decisions[0] = { label: 'refund' })],
    ['no minConfidence on no', d => (d.decisions[1] = { label: 'no_refund' })],
    [
      'minConfidence 0 on yes (threshold 0.5)',
      d => (d.decisions[0] = { label: 'refund', minConfidence: 0 })
    ],
    [
      'minConfidence 0 on no (threshold 0.5)',
      d => (d.decisions[1] = { label: 'no_refund', minConfidence: 0 })
    ]
  ])('null for %s', (_, mutate) => {
    const definition = structuredClone(decide())
    mutate(definition)
    const valid = templateDefinitionSchema.parse(
      JSON.parse(JSON.stringify(definition))
    )
    expect(decideThresholds(valid)).toBeNull()
  })

  test('null for a Classify definition', () => {
    expect(decideThresholds(classify())).toBeNull()
  })
})

describe('classifyThreshold', () => {
  test.each([0.8, 0.65, 0])(
    'reads the shared minConfidence %p',
    minConfidence => {
      expect(classifyThreshold(classify({ minConfidence }))).toBe(minConfidence)
    }
  )

  test('reads the default threshold', () => {
    expect(classifyThreshold(classify())).toBe(0.8)
  })

  test('works on any definition whose labels share one', () => {
    expect(classifyThreshold(decide())).toBe(0.8)
    expect(classifyThreshold(decide({ yesThreshold: 0.95 }))).toBeNull()
    expect(classifyThreshold(score())).toBe(0.8)
    expect(classifyThreshold(score({ minConfidence: 0.6 }))).toBe(0.6)
  })

  test.each<[string, TemplateDefinition['decisions']]>([
    ['no labels', []],
    [
      'different values',
      [
        { label: 'a', minConfidence: 0.8 },
        { label: 'b', minConfidence: 0.7 }
      ]
    ],
    [
      'a label without one',
      [{ label: 'a', minConfidence: 0.8 }, { label: 'b' }]
    ],
    [
      'the first label without one',
      [{ label: 'a' }, { label: 'b', minConfidence: 0.8 }]
    ],
    ['no label with one', [{ label: 'a' }, { label: 'b' }]]
  ])('null for %s', (_, decisions) => {
    expect(classifyThreshold({ ...classify(), decisions })).toBeNull()
  })
})
