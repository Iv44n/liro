import { describe, expect, test } from 'bun:test'
import {
  type Condition,
  DEFINITION_LIMITS,
  type Operand,
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from './definition'
import {
  hasLintErrors,
  type LintIssue,
  type LintOptions,
  lintDefinition
} from './lint'

type Draft = Required<TemplateDefinitionInput>

const categoryQuestion = () => ({
  type: 'choice' as const,
  instructions: {
    question: 'What is `ticket.message` about?',
    focus: [
      'Refunds follow `company.refund_days`',
      'Ignore greetings in `ticket.subject`'
    ]
  },
  criteria: {
    bug: 'Something is broken',
    billing: { what: 'Invoices and refunds', not_for: 'Plan questions' },
    other: null
  }
})

const severityQuestion = () => ({
  type: 'score' as const,
  instructions: 'How severe is the problem?',
  levels: [
    { label: 'low', criteria: 'Cosmetic' },
    { label: 'medium', criteria: null },
    { label: 'high', criteria: 'Blocks work' }
  ]
})

const urgentQuestion = () => ({
  type: 'boolean' as const,
  instructions: 'Is the customer blocked or facing a deadline?',
  criteria: { true: 'Blocked, an outage or a deadline' },
  when: { op: 'exists' as const, left: { input: 'ticket.message' } }
})

/** Exercises every section; lints clean. */
const base = (): Draft => ({
  kind: 'custom',
  model: { family: 'jev' },
  input: {
    fields: [
      { path: 'ticket.subject', type: 'string' },
      {
        path: 'ticket.message',
        type: 'string',
        required: true,
        maxLength: 5_000
      },
      { path: 'ticket.created_at', type: 'datetime' },
      {
        path: 'customer.plan',
        type: 'enum',
        enum: ['free', 'pro', 'enterprise']
      },
      { path: 'customer.seats', type: 'integer' },
      { path: 'customer.email', type: 'string', pii: true },
      { path: 'tags', type: 'array' }
    ]
  },
  state: {
    include: ['ticket', 'customer.plan', 'tags'],
    context: { company: { name: 'Acme', refund_days: 30 } }
  },
  decisions: [
    { label: 'bug', minConfidence: 0.8 },
    { label: 'billing', minConfidence: 0.8 },
    { label: 'other' },
    { label: 'escalate', alwaysReview: true }
  ],
  preconditions: [
    {
      id: 'empty',
      when: {
        op: 'len_lt',
        left: { input: 'ticket.message' },
        right: { value: 3 }
      },
      decision: 'other'
    }
  ],
  questions: {
    category: categoryQuestion(),
    severity: severityQuestion(),
    urgent: urgentQuestion()
  },
  signals: [
    {
      name: 'risk',
      kind: 'weighted',
      terms: [
        { operand: { answer: 'urgent', field: 'probability' }, weight: 2 },
        { operand: { answer: 'severity', field: 'score_norm' }, weight: 1 },
        {
          operand: { answer: 'category', field: 'prob', option: 'bug' },
          weight: 1,
          invert: true
        }
      ]
    },
    {
      name: 'peak',
      kind: 'max',
      of: [{ signal: 'risk' }, { answer: 'category', field: 'confidence' }]
    }
  ],
  flagRules: [
    {
      id: 'urgent',
      when: {
        op: 'gte',
        left: { answer: 'urgent', field: 'probability' },
        right: { value: 0.7 }
      },
      flags: ['urgent']
    },
    {
      id: 'hot',
      when: {
        all: [
          { op: 'eq', left: { flag: 'urgent' }, right: { value: true } },
          {
            op: 'in',
            left: { answer: 'severity', field: 'level' },
            right: [{ value: 'medium' }, { value: 'high' }]
          }
        ]
      },
      flags: ['hot', 'urgent']
    },
    {
      id: 'stale',
      when: {
        op: 'days_since_gt',
        left: { input: 'ticket.created_at' },
        right: { value: 30 }
      },
      flags: ['stale']
    }
  ],
  rules: [
    {
      id: 'escalate',
      when: {
        any: [
          { op: 'eq', left: { flag: 'hot' }, right: { value: true } },
          { op: 'gt', left: { signal: 'peak' }, right: { value: 0.95 } },
          {
            op: 'eq',
            left: { input: 'customer.plan' },
            right: { value: 'enterprise' }
          }
        ]
      },
      decision: 'escalate'
    },
    { id: 'classify', when: { all: [] }, decision: { fromAnswer: 'category' } }
  ],
  fallback: { decision: 'needs_review' }
})

function lint(
  change?: (draft: Draft) => void,
  options?: LintOptions
): LintIssue[] {
  const draft = base()
  change?.(draft)
  return lintDefinition(templateDefinitionSchema.parse(draft), options)
}

/** Paths of the issues with `code`. */
const pathsOf = (issues: readonly LintIssue[], code: string) =>
  issues.filter(issue => issue.code === code).map(issue => issue.path)

const withIssue = (issues: readonly LintIssue[], code: string) =>
  issues.find(issue => issue.code === code)

const many = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index))

/** A probe rule placed first, so its condition sits at `rules.0.when`. */
const probe =
  (when: Condition, decision = 'escalate') =>
  (draft: Draft) => {
    draft.rules.unshift({ id: 'probe', when, decision })
  }

const exists = (left: Operand): Condition => ({ op: 'exists', left })

describe('a clean definition', () => {
  test('has no issues', () => {
    expect(lint()).toEqual([])
    expect(lint(undefined, { maxContextTokens: 100_000 })).toEqual([])
  })

  test('is deterministic', () => {
    const change = (draft: Draft) => {
      draft.decisions.push({ label: 'bug' }, { label: 'needs_review' })
      draft.fallback = { decision: 'nope' }
    }
    expect(lint(change)).toEqual(lint(change))
  })

  test('parses the minimal wizard shape without issues', () => {
    const definition = templateDefinitionSchema.parse({
      kind: 'classify',
      input: {
        fields: [{ path: 'text', type: 'string', required: true }]
      },
      decisions: [
        { label: 'yes', minConfidence: 0.8 },
        { label: 'no', minConfidence: 0.8 }
      ],
      questions: {
        answer: {
          type: 'choice',
          instructions: 'Answer about the `text`',
          criteria: { yes: null, no: null }
        }
      },
      rules: [
        {
          id: 'classify',
          when: { all: [] },
          decision: { fromAnswer: 'answer' }
        }
      ]
    })
    expect(lintDefinition(definition)).toEqual([])
  })
})

describe('hasLintErrors', () => {
  test('only errors block publishing', () => {
    expect(hasLintErrors([])).toBe(false)
    const warnings = lint(draft => {
      draft.questions.extra = { type: 'boolean', instructions: 'Extra?' }
    })
    expect(warnings.map(issue => issue.severity)).toEqual(['warning'])
    expect(hasLintErrors(warnings)).toBe(false)
    expect(
      hasLintErrors(
        lint(draft => {
          draft.decisions = []
        })
      )
    ).toBe(true)
  })

  test('errors come before warnings, each in definition order', () => {
    const issues = lint(draft => {
      // Warnings found early (questions), errors found late (fallback).
      draft.questions.extra = { type: 'boolean', instructions: 'Extra?' }
      draft.fallback = { decision: 'nope' }
      draft.rules[0] = { id: 'escalate', when: { all: [] }, decision: 'nopa' }
    })
    expect(issues.map(issue => [issue.severity, issue.code])).toEqual([
      ['error', 'UNKNOWN_LABEL'],
      ['error', 'UNKNOWN_LABEL'],
      ['warning', 'UNUSED_QUESTION'],
      ['warning', 'UNREACHABLE_RULE']
    ])
    expect(pathsOf(issues, 'UNKNOWN_LABEL')).toEqual([
      'rules.0.decision',
      'fallback.decision'
    ])
  })
})

describe('decisions', () => {
  test('NO_DECISIONS', () => {
    const issues = lint(draft => {
      draft.decisions = []
    })
    expect(pathsOf(issues, 'NO_DECISIONS')).toEqual(['decisions'])
  })

  test('DUPLICATE_LABEL flags the repeated declaration only', () => {
    const issues = lint(draft => {
      draft.decisions.push({ label: 'bug' }, { label: 'bug' })
    })
    expect(pathsOf(issues, 'DUPLICATE_LABEL')).toEqual([
      'decisions.4.label',
      'decisions.5.label'
    ])
  })

  test('RESERVED_LABEL: needs_review cannot be declared', () => {
    const issues = lint(draft => {
      draft.decisions.push({ label: 'needs_review' })
    })
    expect(pathsOf(issues, 'RESERVED_LABEL')).toEqual(['decisions.4.label'])
    expect(pathsOf(issues, 'DUPLICATE_LABEL')).toEqual([])
  })

  test.each([
    [
      'a rule',
      (draft: Draft) => probe({ all: [] }, 'refund')(draft),
      'rules.0.decision'
    ],
    [
      'a precondition',
      (draft: Draft) => {
        draft.preconditions = [
          { id: 'p', when: { any: [] }, decision: 'refund' }
        ]
      },
      'preconditions.0.decision'
    ],
    [
      'the fallback',
      (draft: Draft) => {
        draft.fallback = { decision: 'refund' }
      },
      'fallback.decision'
    ]
  ])('UNKNOWN_LABEL in %s', (_, change, path) => {
    expect(pathsOf(lint(change), 'UNKNOWN_LABEL')).toEqual([path])
  })

  test('needs_review is always a valid decision', () => {
    const issues = lint(draft => {
      draft.preconditions = [
        { id: 'p', when: { any: [] }, decision: 'needs_review' }
      ]
      draft.rules.unshift({
        id: 'probe',
        when: { any: [] },
        decision: 'needs_review'
      })
      draft.fallback = { decision: 'needs_review' }
    })
    expect(pathsOf(issues, 'UNKNOWN_LABEL')).toEqual([])
  })

  test('FROM_ANSWER_UNKNOWN_QUESTION', () => {
    const issues = lint(draft => {
      draft.rules[1] = {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: 'topic' }
      }
    })
    expect(pathsOf(issues, 'FROM_ANSWER_UNKNOWN_QUESTION')).toEqual([
      'rules.1.decision.fromAnswer'
    ])
  })

  test('FROM_ANSWER_BOOLEAN', () => {
    const issues = lint(draft => {
      draft.rules[1] = {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: 'urgent' }
      }
    })
    expect(pathsOf(issues, 'FROM_ANSWER_BOOLEAN')).toEqual([
      'rules.1.decision.fromAnswer'
    ])
    expect(pathsOf(issues, 'FROM_ANSWER_LABEL_MISSING')).toEqual([])
  })

  test('FROM_ANSWER_LABEL_MISSING for a choice option', () => {
    const issues = lint(draft => {
      draft.questions.category = {
        ...categoryQuestion(),
        criteria: { bug: null, billing: null, refund: null, other: null }
      }
    })
    const issue = withIssue(issues, 'FROM_ANSWER_LABEL_MISSING')
    expect(issue?.path).toBe('rules.1.decision.fromAnswer')
    expect(issue?.message).toContain('`refund`')
    expect(issue?.message).not.toContain('`bug`')
  })

  test('FROM_ANSWER_LABEL_MISSING for score levels', () => {
    const issues = lint(draft => {
      draft.rules[1] = {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: 'severity' }
      }
    })
    const issue = withIssue(issues, 'FROM_ANSWER_LABEL_MISSING')
    expect(issue?.path).toBe('rules.1.decision.fromAnswer')
    expect(issue?.message).toContain('`low`, `medium`, `high`')
  })

  test('FROM_ANSWER_LABEL_MISSING names a repeated level once', () => {
    const issues = lint(draft => {
      draft.questions.severity = {
        ...severityQuestion(),
        levels: [
          { label: 'low', criteria: null },
          { label: 'low', criteria: null },
          { label: 'bug', criteria: null }
        ]
      }
      draft.rules[1] = {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: 'severity' }
      }
    })
    expect(withIssue(issues, 'FROM_ANSWER_LABEL_MISSING')?.message).toBe(
      '`severity` can answer `low`, not declared as a decision'
    )
  })

  test('a needs_review option may route to review on purpose', () => {
    const issues = lint(draft => {
      draft.questions.category = {
        ...categoryQuestion(),
        criteria: { bug: null, billing: null, needs_review: 'Unsure' }
      }
    })
    expect(pathsOf(issues, 'FROM_ANSWER_LABEL_MISSING')).toEqual([])
  })

  test('FROM_ANSWER_IN_PRECONDITION', () => {
    const issues = lint(draft => {
      draft.preconditions = [
        { id: 'p', when: { any: [] }, decision: { fromAnswer: 'category' } }
      ]
    })
    expect(pathsOf(issues, 'FROM_ANSWER_IN_PRECONDITION')).toEqual([
      'preconditions.0.decision'
    ])
  })

  test('CONFIDENCE_FROM_UNKNOWN_QUESTION in rules and preconditions', () => {
    const issues = lint(draft => {
      draft.preconditions = [
        {
          id: 'p',
          when: { any: [] },
          decision: 'other',
          confidenceFrom: 'nope'
        }
      ]
      draft.rules.unshift({
        id: 'probe',
        when: { any: [] },
        decision: 'bug',
        confidenceFrom: 'topic'
      })
    })
    expect(pathsOf(issues, 'CONFIDENCE_FROM_UNKNOWN_QUESTION')).toEqual([
      'preconditions.0.confidenceFrom',
      'rules.0.confidenceFrom'
    ])
  })
})

describe('operands', () => {
  test('INPUT_ONLY_OPERAND in preconditions and question `when`s', () => {
    const issues = lint(draft => {
      draft.preconditions = [
        {
          id: 'p',
          when: {
            all: [
              exists({ answer: 'category', field: 'choice' }),
              // An unknown question here reports the section, not the reference.
              exists({ answer: 'nope', field: 'choice' }),
              exists({ input: 'ticket.message' }),
              { op: 'eq', left: { value: 1 }, right: { value: 1 } }
            ]
          },
          decision: 'other'
        }
      ]
      draft.questions.urgent = {
        ...urgentQuestion(),
        when: {
          any: [exists({ signal: 'risk' }), exists({ flag: 'urgent' })]
        }
      }
    })
    expect(pathsOf(issues, 'INPUT_ONLY_OPERAND')).toEqual([
      'preconditions.0.when.all.0.left',
      'preconditions.0.when.all.1.left',
      'questions.urgent.when.any.0.left',
      'questions.urgent.when.any.1.left'
    ])
    expect(pathsOf(issues, 'UNKNOWN_QUESTION')).toEqual([])
  })

  test('UNKNOWN_QUESTION', () => {
    const issues = lint(probe(exists({ answer: 'topic', field: 'choice' })))
    expect(pathsOf(issues, 'UNKNOWN_QUESTION')).toEqual(['rules.0.when.left'])
  })

  test('a question named like an Object.prototype key is still unknown', () => {
    const draft = base()
    probe(exists({ answer: 'category', field: 'choice' }))(draft)
    const definition = templateDefinitionSchema.parse(draft)
    // The schema rejects `constructor` as a key; injected after parsing, so
    // this checks that lint's own lookup never reaches `Object.prototype`.
    const probed = definition.rules[0]
    if (!probed) throw new Error('No probe rule')
    probed.when = exists({ answer: 'constructor', field: 'choice' })
    expect(pathsOf(lintDefinition(definition), 'UNKNOWN_QUESTION')).toEqual([
      'rules.0.when.left'
    ])
  })

  test.each([
    ['category', 'level'],
    ['category', 'score'],
    ['category', 'score_norm'],
    ['category', 'probability'],
    ['severity', 'choice'],
    ['severity', 'probability'],
    ['urgent', 'choice'],
    ['urgent', 'level'],
    ['urgent', 'score'],
    ['urgent', 'score_norm']
  ] as const)('ANSWER_FIELD_MISMATCH: %s.%s', (answer, field) => {
    const issues = lint(probe(exists({ answer, field })))
    expect(pathsOf(issues, 'ANSWER_FIELD_MISMATCH')).toEqual([
      'rules.0.when.left'
    ])
  })

  test('ANSWER_FIELD_MISMATCH: prob on a boolean', () => {
    const issues = lint(
      probe(exists({ answer: 'urgent', field: 'prob', option: 'yes' }))
    )
    expect(pathsOf(issues, 'ANSWER_FIELD_MISMATCH')).toEqual([
      'rules.0.when.left'
    ])
    expect(pathsOf(issues, 'UNKNOWN_OPTION')).toEqual([])
  })

  test.each([
    ['category', 'choice'],
    ['category', 'confidence'],
    ['severity', 'level'],
    ['severity', 'score'],
    ['severity', 'score_norm'],
    ['severity', 'confidence'],
    ['urgent', 'probability'],
    ['urgent', 'confidence']
  ] as const)('%s.%s is a valid field', (answer, field) => {
    expect(lint(probe(exists({ answer, field })))).toEqual([])
  })

  test('UNKNOWN_OPTION on a prob option', () => {
    const issues = lint(
      probe({
        all: [
          exists({ answer: 'category', field: 'prob', option: 'refund' }),
          exists({ answer: 'severity', field: 'prob', option: 'critical' }),
          exists({ answer: 'severity', field: 'prob', option: 'high' })
        ]
      })
    )
    expect(pathsOf(issues, 'UNKNOWN_OPTION')).toEqual([
      'rules.0.when.all.0.left.option',
      'rules.0.when.all.1.left.option'
    ])
  })

  test('UNKNOWN_OPTION on values compared with a choice or level', () => {
    const choice: Operand = { answer: 'category', field: 'choice' }
    const level: Operand = { answer: 'severity', field: 'level' }
    const issues = lint(
      probe({
        all: [
          { op: 'eq', left: choice, right: { value: 'refund' } },
          { op: 'neq', left: { value: 'critical' }, right: level },
          {
            op: 'in',
            left: choice,
            right: [{ value: 'bug' }, { value: 'refnd' }]
          },
          { op: 'in', left: level, right: { value: ['low', 'huge'] } },
          { op: 'eq', left: choice, right: { value: 'bug' } }
        ]
      })
    )
    expect(pathsOf(issues, 'UNKNOWN_OPTION')).toEqual([
      'rules.0.when.all.0.right',
      'rules.0.when.all.1.left',
      'rules.0.when.all.2.right.1',
      'rules.0.when.all.3.right.value.1'
    ])
    expect(pathsOf(issues, 'OPERATOR_TYPE')).toEqual([])
  })

  test('UNKNOWN_SIGNAL', () => {
    const issues = lint(
      probe({ op: 'gt', left: { signal: 'spam' }, right: { value: 0.5 } })
    )
    expect(pathsOf(issues, 'UNKNOWN_SIGNAL')).toEqual(['rules.0.when.left'])
  })

  test('SIGNAL_FORWARD_REFERENCE: a later signal, or itself', () => {
    const issues = lint(draft => {
      draft.signals = [
        { name: 'first', kind: 'min', of: [{ signal: 'second' }] },
        { name: 'second', kind: 'mean', of: [{ signal: 'second' }] },
        {
          name: 'third',
          kind: 'weighted',
          terms: [{ operand: { signal: 'first' }, weight: 1 }]
        }
      ]
    })
    expect(pathsOf(issues, 'SIGNAL_FORWARD_REFERENCE')).toEqual([
      'signals.0.of.0',
      'signals.1.of.0'
    ])
  })

  test('UNKNOWN_FLAG', () => {
    const issues = lint(
      probe({ op: 'eq', left: { flag: 'vip' }, right: { value: true } })
    )
    expect(pathsOf(issues, 'UNKNOWN_FLAG')).toEqual(['rules.0.when.left'])
  })

  test('FLAG_IN_FLAG_RULE: a flag raised by the same or a later flag rule', () => {
    const issues = lint(draft => {
      draft.flagRules.unshift(
        {
          id: 'reads_later',
          when: { op: 'eq', left: { flag: 'stale' }, right: { value: true } },
          flags: ['a']
        },
        {
          id: 'reads_itself',
          when: { op: 'eq', left: { flag: 'b' }, right: { value: true } },
          flags: ['b']
        }
      )
    })
    expect(pathsOf(issues, 'FLAG_IN_FLAG_RULE')).toEqual([
      'flagRules.0.when.left',
      'flagRules.1.when.left'
    ])
    // Reading a flag raised by an earlier flag rule is fine (base `hot`).
    expect(pathsOf(lint(), 'FLAG_IN_FLAG_RULE')).toEqual([])
  })

  test('UNKNOWN_INPUT_PATH: a declared field or an ancestor of one', () => {
    const issues = lint(
      probe({
        all: [
          exists({ input: 'ticket.body' }),
          exists({ input: 'ticket' }),
          exists({ input: 'customer.plan' }),
          exists({ input: 'tags.first' }),
          exists({ input: 'ticket.message.length' })
        ]
      })
    )
    expect(pathsOf(issues, 'UNKNOWN_INPUT_PATH')).toEqual([
      'rules.0.when.all.0.left',
      'rules.0.when.all.3.left',
      'rules.0.when.all.4.left'
    ])
  })

  test('input paths are checked in every section', () => {
    const issues = lint(draft => {
      draft.preconditions = [
        { id: 'p', when: exists({ input: 'nope' }), decision: 'other' }
      ]
      draft.questions.urgent = {
        ...urgentQuestion(),
        when: exists({ input: 'nope' })
      }
      draft.signals.push({ name: 's', kind: 'mean', of: [{ input: 'nope' }] })
      draft.flagRules.push({
        id: 'f',
        when: exists({ input: 'nope' }),
        flags: ['f']
      })
    })
    expect(pathsOf(issues, 'UNKNOWN_INPUT_PATH')).toEqual([
      'preconditions.0.when.left',
      'questions.urgent.when.left',
      'signals.2.of.0',
      'flagRules.3.when.left'
    ])
  })
})

describe('input fields and state', () => {
  test('DUPLICATE_FIELD', () => {
    const issues = lint(draft => {
      draft.input.fields.push({ path: 'tags', type: 'array' })
    })
    expect(pathsOf(issues, 'DUPLICATE_FIELD')).toEqual(['input.fields.7.path'])
    expect(pathsOf(issues, 'OVERLAPPING_FIELDS')).toEqual([])
  })

  test('OVERLAPPING_FIELDS: a path that is both a leaf and a parent', () => {
    const issues = lint(draft => {
      draft.input.fields.push(
        { path: 'ticket', type: 'object' },
        { path: 'tags.first', type: 'string' }
      )
    })
    expect(pathsOf(issues, 'OVERLAPPING_FIELDS')).toEqual([
      'input.fields.6.path',
      'input.fields.7.path'
    ])
    expect(withIssue(issues, 'OVERLAPPING_FIELDS')?.message).toContain(
      '`tags.first`'
    )
  })

  test('STATE_INCLUDE_UNKNOWN', () => {
    const issues = lint(draft => {
      draft.state = {
        include: ['ticket', 'customer', 'ticket.body', 'customer.plan.x']
      }
    })
    expect(pathsOf(issues, 'STATE_INCLUDE_UNKNOWN')).toEqual([
      'state.include.2',
      'state.include.3'
    ])
  })

  test('STATE_CONTEXT_COLLISION with an included path', () => {
    const issues = lint(draft => {
      draft.state = {
        include: ['ticket.message'],
        context: { ticket: 'shadowed', customer: 'not sent', company: {} }
      }
    })
    expect(pathsOf(issues, 'STATE_CONTEXT_COLLISION')).toEqual([
      'state.context.ticket'
    ])
  })

  test('STATE_CONTEXT_COLLISION with every field when include is absent', () => {
    const issues = lint(draft => {
      draft.state = { context: { customer: 'x', tags: [], company: {} } }
    })
    expect(pathsOf(issues, 'STATE_CONTEXT_COLLISION')).toEqual([
      'state.context.customer',
      'state.context.tags'
    ])
  })
})

describe('questions', () => {
  const options = (count: number) =>
    Object.fromEntries(many(count, index => [`o${index}`, null] as const))

  test.each([
    [1, true],
    [2, false],
    [DEFINITION_LIMITS.choiceOptions.max, false],
    [DEFINITION_LIMITS.choiceOptions.max + 1, true],
    [0, true]
  ])('CHOICE_OPTIONS with %d options → %p', (count, reported) => {
    const issues = lint(draft => {
      draft.questions.extra = {
        type: 'choice',
        instructions: 'Pick one',
        criteria: options(count)
      }
    })
    expect(pathsOf(issues, 'CHOICE_OPTIONS')).toEqual(
      reported ? ['questions.extra.criteria'] : []
    )
  })

  test.each([
    [1, true],
    [2, false],
    [10, false],
    [11, true],
    [0, true]
  ])('SCORE_LEVELS with %d levels → %p', (count, reported) => {
    const issues = lint(draft => {
      draft.questions.extra = {
        type: 'score',
        instructions: 'Rate it',
        levels: many(count, index => ({
          label: `l${index}`,
          criteria: `Level ${index}`
        }))
      }
    })
    expect(pathsOf(issues, 'SCORE_LEVELS')).toEqual(
      reported ? ['questions.extra.levels'] : []
    )
  })

  test('DUPLICATE_LEVEL', () => {
    const issues = lint(draft => {
      draft.questions.severity = {
        ...severityQuestion(),
        levels: [
          { label: 'low', criteria: 'a' },
          { label: 'high', criteria: 'b' },
          { label: 'low', criteria: 'c' }
        ]
      }
    })
    expect(pathsOf(issues, 'DUPLICATE_LEVEL')).toEqual([
      'questions.severity.levels.2.label'
    ])
  })

  test('NUMERIC_LEVELS: only bare numbers without criteria', () => {
    const issues = lint(draft => {
      draft.questions.severity = {
        ...severityQuestion(),
        levels: [
          { label: '1', criteria: null },
          { label: '2', criteria: 'Moderate' },
          { label: '3', criteria: null },
          { label: 'high', criteria: null }
        ]
      }
    })
    const issue = withIssue(issues, 'NUMERIC_LEVELS')
    expect(issue).toMatchObject({
      severity: 'warning',
      path: 'questions.severity.levels'
    })
    expect(issue?.message).toContain('`1`, `3`')
    expect(issue?.message).not.toContain('`2`')

    const described = lint(draft => {
      draft.questions.severity = {
        ...severityQuestion(),
        levels: [
          { label: '1', criteria: 'Low' },
          { label: '2', criteria: 'High' }
        ]
      }
    })
    expect(pathsOf(described, 'NUMERIC_LEVELS')).toEqual([])
  })

  test('UNUSED_QUESTION', () => {
    const issues = lint(draft => {
      draft.questions.extra = { type: 'boolean', instructions: 'Extra?' }
    })
    expect(withIssue(issues, 'UNUSED_QUESTION')).toMatchObject({
      severity: 'warning',
      path: 'questions.extra'
    })
  })

  test('a question read only through fromAnswer or confidenceFrom is used', () => {
    const issues = lint(draft => {
      draft.signals = []
      draft.flagRules = []
      draft.rules = [
        {
          id: 'yes',
          when: { any: [] },
          decision: 'bug',
          confidenceFrom: 'urgent'
        },
        {
          id: 'classify',
          when: { all: [] },
          decision: { fromAnswer: 'category' }
        }
      ]
    })
    expect(pathsOf(issues, 'UNUSED_QUESTION')).toEqual(['questions.severity'])
  })

  test('a precondition fromAnswer does not use the question', () => {
    const issues = lint(draft => {
      draft.questions.extra = {
        type: 'choice',
        instructions: 'Pick',
        criteria: { bug: null, other: null }
      }
      draft.preconditions = [
        {
          id: 'p',
          when: { any: [] },
          decision: { fromAnswer: 'extra' },
          confidenceFrom: 'extra'
        }
      ]
    })
    expect(pathsOf(issues, 'UNUSED_QUESTION')).toEqual(['questions.extra'])
  })
})

describe('rule ids, signals and limits', () => {
  test('DUPLICATE_RULE_ID across preconditions, rules and flag rules', () => {
    const issues = lint(draft => {
      draft.rules.push({ id: 'empty', when: { any: [] }, decision: 'other' })
      draft.rules.push({ id: 'classify', when: { any: [] }, decision: 'bug' })
      draft.flagRules.push({ id: 'escalate', when: { any: [] }, flags: ['x'] })
    })
    expect(pathsOf(issues, 'DUPLICATE_RULE_ID')).toEqual([
      'rules.2.id',
      'rules.3.id',
      'flagRules.3.id'
    ])
  })

  test('DUPLICATE_SIGNAL', () => {
    const issues = lint(draft => {
      draft.signals.push({ name: 'risk', kind: 'min', of: [{ value: 1 }] })
    })
    expect(pathsOf(issues, 'DUPLICATE_SIGNAL')).toEqual(['signals.2.name'])
  })

  const nested = (depth: number): Condition =>
    depth <= 1 ? exists({ input: 'tags' }) : { not: nested(depth - 1) }

  test.each([
    [DEFINITION_LIMITS.conditionDepth, []],
    [DEFINITION_LIMITS.conditionDepth + 1, ['rules.0.when']]
  ])('CONDITION_TOO_DEEP at depth %d', (depth, expected) => {
    expect(pathsOf(lint(probe(nested(depth))), 'CONDITION_TOO_DEEP')).toEqual(
      expected
    )
  })

  test('CONDITION_TOO_DEEP in every kind of condition', () => {
    const deep = nested(DEFINITION_LIMITS.conditionDepth + 1)
    const issues = lint(draft => {
      draft.preconditions = [{ id: 'p', when: deep, decision: 'other' }]
      draft.questions.urgent = { ...urgentQuestion(), when: deep }
      draft.flagRules.push({ id: 'f', when: deep, flags: ['f'] })
      draft.rules.unshift({ id: 'r', when: deep, decision: 'other' })
    })
    expect(pathsOf(issues, 'CONDITION_TOO_DEEP')).toEqual([
      'preconditions.0.when',
      'questions.urgent.when',
      'flagRules.3.when',
      'rules.0.when'
    ])
  })

  test('DEFINITION_TOO_LARGE counts bytes, not characters', () => {
    const half = DEFINITION_LIMITS.bytes / 2
    const small = lint(draft => {
      draft.questions.urgent = {
        ...urgentQuestion(),
        instructions: 'x'.repeat(half)
      }
    })
    expect(pathsOf(small, 'DEFINITION_TOO_LARGE')).toEqual([])

    // Same character count, but 'é' is two bytes in UTF-8.
    const large = lint(draft => {
      draft.questions.urgent = {
        ...urgentQuestion(),
        instructions: 'é'.repeat(half)
      }
    })
    expect(pathsOf(large, 'DEFINITION_TOO_LARGE')).toEqual([''])
  })

  const limitCases: [
    string,
    number,
    string,
    (draft: Draft, n: number) => void
  ][] = [
    [
      'fields',
      DEFINITION_LIMITS.fields,
      'input.fields',
      (draft, n) => {
        draft.input.fields = many(n, index => ({
          path: `f${index}`,
          type: 'string' as const
        }))
      }
    ],
    [
      'questions',
      DEFINITION_LIMITS.questions,
      'questions',
      (draft, n) => {
        draft.questions = Object.fromEntries(
          many(
            n,
            index =>
              [
                `q${index}`,
                { type: 'boolean' as const, instructions: 'Yes?' }
              ] as const
          )
        )
      }
    ],
    [
      'decisions',
      DEFINITION_LIMITS.decisions,
      'decisions',
      (draft, n) => {
        draft.decisions = many(n, index => ({ label: `l${index}` }))
      }
    ],
    [
      'preconditions',
      DEFINITION_LIMITS.rules,
      'preconditions',
      (draft, n) => {
        draft.preconditions = many(n, index => ({
          id: `p${index}`,
          when: { any: [] },
          decision: 'other'
        }))
      }
    ],
    [
      'rules',
      DEFINITION_LIMITS.rules,
      'rules',
      (draft, n) => {
        draft.rules = many(n, index => ({
          id: `r${index}`,
          when: { any: [] },
          decision: 'other'
        }))
      }
    ],
    [
      'flag rules',
      DEFINITION_LIMITS.rules,
      'flagRules',
      (draft, n) => {
        draft.flagRules = many(n, index => ({
          id: `f${index}`,
          when: { any: [] },
          flags: ['x']
        }))
      }
    ],
    [
      'signals',
      DEFINITION_LIMITS.signals,
      'signals',
      (draft, n) => {
        draft.signals = many(n, index => ({
          name: `s${index}`,
          kind: 'mean' as const,
          of: [{ value: 1 }]
        }))
      }
    ],
    [
      'weighted terms',
      DEFINITION_LIMITS.signalTerms,
      'signals.0.terms',
      (draft, n) => {
        draft.signals = [
          {
            name: 's',
            kind: 'weighted',
            terms: many(n, () => ({ operand: { value: 1 }, weight: 1 }))
          }
        ]
      }
    ],
    [
      'min/max/mean terms',
      DEFINITION_LIMITS.signalTerms,
      'signals.0.of',
      (draft, n) => {
        draft.signals = [
          { name: 's', kind: 'min', of: many(n, () => ({ value: 1 })) }
        ]
      }
    ]
  ]

  test.each(limitCases)('TOO_MANY %s (limit %d)', (_, max, path, fill) => {
    const atLimit = lint(draft => fill(draft, max))
    expect(pathsOf(atLimit, 'TOO_MANY')).toEqual([])
    const over = lint(draft => fill(draft, max + 1))
    expect(pathsOf(over, 'TOO_MANY')).toEqual([path])
    expect(withIssue(over, 'TOO_MANY')?.message).toContain(`${max + 1}`)
  })
})

describe('operator types', () => {
  const choice: Operand = { answer: 'category', field: 'choice' }
  const level: Operand = { answer: 'severity', field: 'level' }
  const flag: Operand = { flag: 'urgent' }
  const text: Operand = { input: 'ticket.message' }
  const created: Operand = { input: 'ticket.created_at' }
  const seats: Operand = { input: 'customer.seats' }
  const tags: Operand = { input: 'tags' }
  const n = (value: number): Operand => ({ value })
  const s = (value: string): Operand => ({ value })

  const invalid: [string, Condition, string[]][] = [
    ['gt on a choice', { op: 'gt', left: choice, right: n(1) }, ['left']],
    ['gte on a level', { op: 'gte', left: level, right: n(1) }, ['left']],
    ['lt on a flag', { op: 'lt', left: flag, right: n(1) }, ['left']],
    ['lte on a string input', { op: 'lte', left: text, right: n(1) }, ['left']],
    ['gt on a date input', { op: 'gt', left: created, right: n(1) }, ['left']],
    [
      'gt against a string',
      { op: 'gt', left: seats, right: s('3') },
      ['right']
    ],
    [
      'between with a string bound',
      { op: 'between', left: seats, right: [n(1), s('9')] },
      ['right.1']
    ],
    [
      'between on a choice',
      { op: 'between', left: choice, right: [n(0), n(1)] },
      ['left']
    ],
    [
      'eq on a probability',
      {
        op: 'eq',
        left: { answer: 'urgent', field: 'probability' },
        right: n(1)
      },
      ['left']
    ],
    [
      'eq on a confidence',
      {
        op: 'eq',
        left: { answer: 'category', field: 'confidence' },
        right: n(1)
      },
      ['left']
    ],
    [
      'eq on a prob',
      {
        op: 'eq',
        left: { answer: 'category', field: 'prob', option: 'bug' },
        right: n(1)
      },
      ['left']
    ],
    [
      'eq on a score',
      { op: 'eq', left: { answer: 'severity', field: 'score' }, right: n(2) },
      ['left']
    ],
    [
      'neq on a score_norm',
      {
        op: 'neq',
        left: { answer: 'severity', field: 'score_norm' },
        right: n(0)
      },
      ['left']
    ],
    [
      'eq with a signal on the right',
      { op: 'eq', left: n(1), right: { signal: 'risk' } },
      ['right']
    ],
    [
      'in on a continuous value',
      { op: 'in', left: { signal: 'risk' }, right: [n(0), n(1)] },
      ['left']
    ],
    [
      'eq with null',
      { op: 'eq', left: text, right: { value: null } },
      ['right']
    ],
    [
      'in with a null left',
      { op: 'in', left: { value: null }, right: [s('a')] },
      ['left']
    ],
    ['eq flag vs string', { op: 'eq', left: flag, right: s('yes') }, ['right']],
    ['eq choice vs number', { op: 'eq', left: choice, right: n(3) }, ['right']],
    [
      'neq number input vs string',
      { op: 'neq', left: seats, right: s('3') },
      ['right']
    ],
    [
      'eq number vs array input',
      { op: 'eq', left: n(1), right: tags },
      ['right']
    ],
    [
      'in against a scalar',
      { op: 'in', left: choice, right: s('bug') },
      ['right']
    ],
    [
      'in against a string input',
      { op: 'in', left: choice, right: text },
      ['right']
    ],
    [
      'in with an array literal inside the list',
      { op: 'in', left: choice, right: [{ value: ['bug', 'billing'] }] },
      ['right.0']
    ],
    [
      'in with a mistyped item of an array literal',
      { op: 'in', left: seats, right: { value: [1, '2', null] } },
      ['right.value.1']
    ],
    [
      'contains on a number',
      { op: 'contains', left: seats, right: n(1) },
      ['left']
    ],
    [
      'contains on a flag',
      { op: 'contains', left: flag, right: s('x') },
      ['left']
    ],
    [
      'contains a number in a string',
      { op: 'contains', left: text, right: n(1) },
      ['right']
    ],
    [
      'len_gt on a number',
      { op: 'len_gt', left: seats, right: n(1) },
      ['left']
    ],
    [
      'len_lt against a string',
      { op: 'len_lt', left: text, right: s('3') },
      ['right']
    ],
    [
      'before on a string input',
      { op: 'before', left: text, right: s('2026-01-01') },
      ['left']
    ],
    [
      'after on a signal',
      { op: 'after', left: { signal: 'risk' }, right: n(0) },
      ['left']
    ],
    [
      'before a value that is not a date',
      { op: 'before', left: created, right: s('tomorrow') },
      ['right']
    ],
    [
      'after with a boolean',
      { op: 'after', left: created, right: { value: true } },
      ['right']
    ],
    // Date.parse reads these, but the policy only takes strict ISO: the
    // comparison would be unknown on every run.
    [
      'before a loose date string',
      { op: 'before', left: created, right: s('Jan 1 2030') },
      ['right']
    ],
    [
      'after a bare number string',
      { op: 'after', left: created, right: s('5') },
      ['right']
    ],
    [
      'before a date with a space instead of T',
      { op: 'before', left: created, right: s('2026-01-01 10:00') },
      ['right']
    ],
    [
      'days_since_gt on an impossible date',
      { op: 'days_since_gt', left: s('2026-02-30'), right: n(1) },
      ['left']
    ],
    [
      'in a list of only nulls',
      { op: 'in', left: text, right: [{ value: null }, { value: null }] },
      ['right']
    ],
    [
      'days_since_gt on a string input',
      { op: 'days_since_gt', left: text, right: n(3) },
      ['left']
    ],
    [
      'days_since_lt on a level',
      { op: 'days_since_lt', left: level, right: n(3) },
      ['left']
    ],
    [
      'days_since_gt against a string',
      { op: 'days_since_gt', left: created, right: s('3') },
      ['right']
    ]
  ]

  test.each(invalid)('OPERATOR_TYPE: %s', (_, when, expected) => {
    const issues = lint(probe(when))
    expect(pathsOf(issues, 'OPERATOR_TYPE')).toEqual(
      expected.map(at => `rules.0.when.${at}`)
    )
    expect(withIssue(issues, 'OPERATOR_TYPE')?.severity).toBe('error')
  })

  test('the continuous-value error suggests gte/lte', () => {
    const issues = lint(
      probe({
        op: 'eq',
        left: { answer: 'urgent', field: 'probability' },
        right: n(1)
      })
    )
    expect(withIssue(issues, 'OPERATOR_TYPE')?.message).toContain('gte/lte')
  })

  test.each([
    [choice, '`category.choice` is an option label'],
    [flag, 'flag `urgent` is a boolean'],
    [created, 'input `ticket.created_at` is a date string'],
    [text, 'input `ticket.message` is a string'],
    [tags, 'input `tags` is an array'],
    [{ input: 'ticket' }, 'input `ticket` is an object'],
    [{ value: null }, '`null` is null'],
    [
      { value: { a: 'x'.repeat(50) } },
      `\`{"a":"${'x'.repeat(31)}...\` is an object`
    ]
  ] as [Operand, string][])(
    'type errors say what the operand is: %j',
    (left, what) => {
      const issues = lint(probe({ op: 'gt', left, right: n(1) }))
      expect(pathsOf(issues, 'OPERATOR_TYPE')).toEqual(['rules.0.when.left'])
      expect(withIssue(issues, 'OPERATOR_TYPE')?.message).toBe(
        `\`gt\` compares numbers; ${what}`
      )
    }
  )

  const valid: [string, Condition][] = [
    ['gt on a number input', { op: 'gt', left: seats, right: n(10) }],
    [
      'gte on a probability',
      {
        op: 'gte',
        left: { answer: 'urgent', field: 'probability' },
        right: n(0.5)
      }
    ],
    [
      'lt between two signals',
      { op: 'lt', left: { signal: 'risk' }, right: { signal: 'peak' } }
    ],
    [
      'between on a score_norm',
      {
        op: 'between',
        left: { answer: 'severity', field: 'score_norm' },
        right: [n(0.2), n(0.8)]
      }
    ],
    ['eq on an integer input', { op: 'eq', left: seats, right: n(3) }],
    [
      'eq between a choice and an option',
      { op: 'eq', left: choice, right: s('billing') }
    ],
    [
      'neq between two flags',
      { op: 'neq', left: flag, right: { flag: 'hot' } }
    ],
    [
      'eq on an object ancestor',
      { op: 'eq', left: { input: 'ticket' }, right: { value: {} } }
    ],
    [
      'in a list with null items',
      { op: 'in', left: choice, right: [{ value: null }, s('bug')] }
    ],
    ['in an array input', { op: 'in', left: text, right: tags }],
    [
      'in an array literal',
      { op: 'in', left: level, right: { value: ['low', null, 'high'] } }
    ],
    [
      'contains a substring',
      { op: 'contains', left: text, right: s('refund') }
    ],
    ['contains on an array', { op: 'contains', left: tags, right: n(1) }],
    ['contains on a choice', { op: 'contains', left: choice, right: s('b') }],
    ['len_gt on an array', { op: 'len_gt', left: tags, right: n(2) }],
    [
      'before an ISO date',
      { op: 'before', left: created, right: s('2026-01-01T00:00:00Z') }
    ],
    [
      'before an ISO date-time with an offset',
      { op: 'before', left: created, right: s('2026-01-01T10:00:00.5+05:00') }
    ],
    [
      'after a date-only value',
      { op: 'after', left: created, right: s('2024-02-29') }
    ],
    [
      'after an epoch-ms number',
      { op: 'after', left: created, right: n(1_700_000_000_000) }
    ],
    [
      'after on a numeric input (epoch ms)',
      { op: 'after', left: seats, right: created }
    ],
    [
      'days_since_lt on a date input',
      { op: 'days_since_lt', left: created, right: n(7) }
    ],
    ['exists on anything', exists({ answer: 'urgent', field: 'probability' })],
    [
      'eq between inputs',
      { op: 'eq', left: text, right: { input: 'ticket.subject' } }
    ]
  ]

  test.each(valid)('no issue: %s', (_, when) => {
    expect(lint(probe(when))).toEqual([])
  })

  test('unknown references do not cascade into type errors', () => {
    const issues = lint(
      probe({
        all: [
          { op: 'gt', left: { answer: 'topic', field: 'choice' }, right: n(1) },
          {
            op: 'eq',
            left: { answer: 'category', field: 'level' },
            right: n(1)
          },
          { op: 'before', left: { input: 'ticket.body' }, right: n(1) }
        ]
      })
    )
    expect(issues.map(issue => issue.code)).toEqual([
      'UNKNOWN_QUESTION',
      'ANSWER_FIELD_MISMATCH',
      'UNKNOWN_INPUT_PATH'
    ])
  })

  test('signal terms must be numbers', () => {
    const issues = lint(draft => {
      draft.signals = [
        {
          name: 'mixed',
          kind: 'weighted',
          terms: [
            { operand: flag, weight: 1 },
            { operand: { answer: 'urgent', field: 'probability' }, weight: 1 },
            { operand: text, weight: 1 },
            { operand: seats, weight: 1 }
          ]
        },
        {
          name: 'top',
          kind: 'max',
          of: [choice, s('x'), n(1), { signal: 'mixed' }]
        }
      ]
    })
    expect(pathsOf(issues, 'OPERATOR_TYPE')).toEqual([
      'signals.0.terms.0.operand',
      'signals.0.terms.2.operand',
      'signals.1.of.0',
      'signals.1.of.1'
    ])
  })
})

describe('instructions', () => {
  const instructionIssues = (change: (draft: Draft) => void) =>
    pathsOf(lint(change), 'INSTRUCTION_UNKNOWN_PATH')

  test('INSTRUCTION_UNKNOWN_PATH in instruction strings', () => {
    const issue = withIssue(
      lint(draft => {
        draft.questions.urgent = {
          ...urgentQuestion(),
          instructions: 'Read `ticket.body` and `ticket.message`'
        }
      }),
      'INSTRUCTION_UNKNOWN_PATH'
    )
    expect(issue).toMatchObject({
      severity: 'error',
      path: 'questions.urgent.instructions'
    })
    expect(issue?.message).toContain('`ticket.body`')
  })

  test('one issue per unknown token', () => {
    expect(
      instructionIssues(draft => {
        draft.questions.urgent = {
          ...urgentQuestion(),
          instructions: 'Compare `ticket.body` with `customer.name`'
        }
      })
    ).toEqual([
      'questions.urgent.instructions',
      'questions.urgent.instructions'
    ])
  })

  test('every string inside structured instructions and criteria', () => {
    expect(
      instructionIssues(draft => {
        draft.questions.category = {
          ...categoryQuestion(),
          instructions: {
            question: 'Classify it',
            focus: ['ok', 'See `customer.name`'],
            '`ticket.title` key': 'keys are strings too'
          },
          criteria: {
            bug: 'Mentions `ticket.stack`',
            billing: { what: ['Invoices', 'See `invoice.id`'] },
            other: null
          }
        }
        draft.questions.severity = {
          ...severityQuestion(),
          levels: [
            { label: 'low', criteria: 'No `ticket.impact`' },
            { label: 'high', criteria: null }
          ]
        }
        draft.questions.urgent = {
          ...urgentQuestion(),
          criteria: { true: 'Per `sla.hours`', false: { note: '`sla.tier`' } }
        }
      })
    ).toEqual([
      'questions.category.instructions.focus.1',
      'questions.category.instructions',
      'questions.category.criteria.bug',
      'questions.category.criteria.billing.what.1',
      'questions.severity.levels.0.criteria',
      'questions.urgent.criteria.true',
      'questions.urgent.criteria.false.note'
    ])
  })

  test('declared paths, ancestors and state context are accepted', () => {
    expect(
      instructionIssues(draft => {
        draft.input.fields.push({ path: 'order.items.count', type: 'integer' })
        draft.state = {
          context: {
            company: { name: 'Acme', refund_days: 30, policy: { refunds: 30 } },
            'release.v2': true
          }
        }
        draft.questions.urgent = {
          ...urgentQuestion(),
          instructions: [
            '`ticket.message`, `order.items` and `order.items.count`',
            '`company.name`, `company.policy.refunds` and `release.v2`'
          ]
        }
      })
    ).toEqual([])
  })

  test('a path that does not resolve inside the context is unknown', () => {
    expect(
      instructionIssues(draft => {
        draft.questions.urgent = {
          ...urgentQuestion(),
          instructions: 'Use `company.phone` or `company.name.first`'
        }
      })
    ).toEqual([
      'questions.urgent.instructions',
      'questions.urgent.instructions'
    ])
  })

  test('only dot-path-shaped tokens are checked', () => {
    expect(
      instructionIssues(draft => {
        draft.questions.urgent = {
          ...urgentQuestion(),
          instructions:
            'Say `bug` or `needs_review`, v`1.2`, `a-b.c`, `ticket.`, `.x`, `two words.x`, `some text`'
        }
      })
    ).toEqual([])
  })
})

describe('warnings', () => {
  test('UNREACHABLE_RULE after a catch-all label rule', () => {
    const issues = lint(draft => {
      draft.rules.splice(1, 0, {
        id: 'everything',
        when: { all: [] },
        decision: 'other'
      })
      draft.rules.push({ id: 'last', when: { any: [] }, decision: 'bug' })
    })
    expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual(['rules.2', 'rules.3'])
    expect(withIssue(issues, 'UNREACHABLE_RULE')).toMatchObject({
      severity: 'warning'
    })
    expect(withIssue(issues, 'UNREACHABLE_RULE')?.message).toContain(
      '`everything`'
    )
  })

  test.each([
    ['not any []', { not: { any: [] } }, true],
    [
      'any with a catch-all',
      { any: [exists({ input: 'tags' }), { all: [] }] },
      true
    ],
    ['all of catch-alls', { all: [{ all: [] }, { not: { any: [] } }] }, true],
    ['not of a false all', { not: { all: [{ any: [] }] } }, true],
    [
      'not of a false any',
      { not: { any: [{ any: [] }, { not: { all: [] } }] } },
      true
    ],
    ['all with a comparison', { all: [exists({ input: 'tags' })] }, false],
    ['any []', { any: [] }, false],
    ['not all []', { not: { all: [] } }, false],
    ['a bare comparison', exists({ input: 'tags' }), false]
  ] as [string, Condition, boolean][])(
    'a rule whose condition is %s → unreachable after it: %p',
    (_, when, unreachable) => {
      const issues = lint(probe(when, 'other'))
      expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual(
        unreachable ? ['rules.1', 'rules.2'] : []
      )
    }
  )

  test('a catch-all fromAnswer rule can be skipped, so it does not count', () => {
    const issues = lint(draft => {
      draft.rules.reverse()
    })
    expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual([])
  })

  test('after a catch-all needs_review rule, later rules still pick the suggestion', () => {
    const issues = lint(draft => {
      draft.rules.unshift({
        id: 'shadow',
        when: { all: [] },
        decision: 'needs_review'
      })
      // Literal needs_review rules are skipped by the suggestion scan: dead.
      draft.rules.push({
        id: 'dead_review',
        when: exists({ input: 'tags' }),
        decision: 'needs_review'
      })
    })
    expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual(['rules.3'])
    expect(withIssue(issues, 'UNREACHABLE_RULE')?.message).toContain('`shadow`')
  })

  test('a catch-all label rule after a catch-all needs_review ends the suggestion scan', () => {
    const issues = lint(draft => {
      draft.rules = [
        { id: 'shadow', when: { all: [] }, decision: 'needs_review' },
        { id: 'suggest', when: exists({ input: 'tags' }), decision: 'bug' },
        { id: 'default', when: { all: [] }, decision: 'other' },
        { id: 'late', when: exists({ input: 'tags' }), decision: 'billing' }
      ]
    })
    expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual(['rules.3'])
  })

  test('a catch-all needs_review precondition makes every later one unreachable', () => {
    const issues = lint(draft => {
      draft.preconditions.unshift({
        id: 'always',
        when: { all: [] },
        decision: 'needs_review'
      })
    })
    expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual(['preconditions.1'])
  })

  test('UNREACHABLE_RULE among preconditions', () => {
    const issues = lint(draft => {
      draft.preconditions.unshift({
        id: 'always',
        when: { all: [] },
        decision: 'other'
      })
    })
    expect(pathsOf(issues, 'UNREACHABLE_RULE')).toEqual(['preconditions.1'])
  })

  test('CONFIDENCE_SOURCE_MISSING for a gated label decided without confidence', () => {
    const issues = lint(draft => {
      draft.rules.unshift(
        { id: 'blind', when: { any: [] }, decision: 'bug' },
        {
          id: 'sourced',
          when: { any: [] },
          decision: 'bug',
          confidenceFrom: 'urgent'
        },
        { id: 'ungated', when: { any: [] }, decision: 'other' }
      )
      draft.preconditions.push({
        id: 'exempt',
        when: { any: [] },
        decision: 'bug'
      })
    })
    expect(pathsOf(issues, 'CONFIDENCE_SOURCE_MISSING')).toEqual([
      'rules.0.decision'
    ])
    expect(withIssue(issues, 'CONFIDENCE_SOURCE_MISSING')).toMatchObject({
      severity: 'warning'
    })
  })

  test('CONFIDENCE_SOURCE_MISSING for a gated fallback', () => {
    const issues = lint(draft => {
      draft.fallback = { decision: 'billing' }
    })
    expect(pathsOf(issues, 'CONFIDENCE_SOURCE_MISSING')).toEqual([
      'fallback.decision'
    ])
  })

  test('alwaysReview labels are expected to go to review', () => {
    const issues = lint(draft => {
      draft.decisions.push({
        label: 'refund',
        minConfidence: 0.9,
        alwaysReview: true
      })
      draft.fallback = { decision: 'refund' }
    })
    expect(pathsOf(issues, 'CONFIDENCE_SOURCE_MISSING')).toEqual([])
  })

  test('PII_IN_POLICY when the policy reads a pii field or its parent', () => {
    const direct = lint(probe(exists({ input: 'customer.email' })))
    expect(withIssue(direct, 'PII_IN_POLICY')).toMatchObject({
      severity: 'warning',
      path: 'input.fields.5'
    })

    const parent = lint(probe(exists({ input: 'customer' })))
    expect(pathsOf(parent, 'PII_IN_POLICY')).toEqual(['input.fields.5'])
    expect(withIssue(parent, 'PII_IN_POLICY')?.message).toContain('`customer`')
  })

  test('pii sent to Jev but not read by the policy is fine', () => {
    const issues = lint(draft => {
      draft.state = { include: ['ticket', 'customer'] }
    })
    expect(pathsOf(issues, 'PII_IN_POLICY')).toEqual([])
  })

  test('ALWAYS_REVIEW', () => {
    const issues = lint(draft => {
      draft.preconditions = []
      draft.rules = []
    })
    expect(withIssue(issues, 'ALWAYS_REVIEW')).toMatchObject({
      severity: 'warning',
      path: ''
    })

    const labelled = lint(draft => {
      draft.preconditions = []
      draft.rules = []
      draft.fallback = { decision: 'other' }
    })
    expect(pathsOf(labelled, 'ALWAYS_REVIEW')).toEqual([])

    const precondition = lint(draft => {
      draft.rules = []
    })
    expect(pathsOf(precondition, 'ALWAYS_REVIEW')).toEqual([])
  })

  test('TOKEN_BUDGET only when maxContextTokens is given', () => {
    const tight = lint(undefined, { maxContextTokens: 50 })
    expect(withIssue(tight, 'TOKEN_BUDGET')).toMatchObject({
      severity: 'warning',
      path: ''
    })
    expect(withIssue(tight, 'TOKEN_BUDGET')?.message).toContain('50-token')
    expect(pathsOf(lint(), 'TOKEN_BUDGET')).toEqual([])
    expect(
      pathsOf(lint(undefined, { maxContextTokens: 100_000 }), 'TOKEN_BUDGET')
    ).toEqual([])
  })

  test('TOKEN_BUDGET counts the state context plus the longest question', () => {
    // 4 000 characters of context ≈ 1 000 tokens.
    const bigContext = (draft: Draft) => {
      draft.state = {
        include: draft.state.include,
        context: { company: { name: 'x'.repeat(4_000), refund_days: 30 } }
      }
    }
    expect(
      pathsOf(lint(bigContext, { maxContextTokens: 1_200 }), 'TOKEN_BUDGET')
    ).toEqual([''])
    expect(
      pathsOf(lint(bigContext, { maxContextTokens: 2_000 }), 'TOKEN_BUDGET')
    ).toEqual([])

    const bigQuestion = (draft: Draft) => {
      draft.questions.urgent = {
        ...urgentQuestion(),
        instructions: 'y'.repeat(4_000)
      }
    }
    expect(
      pathsOf(lint(bigQuestion, { maxContextTokens: 1_200 }), 'TOKEN_BUDGET')
    ).toEqual([''])
  })

  test('far over the limit is still only a warning', () => {
    const issues = lint(undefined, { maxContextTokens: 1 })
    expect(withIssue(issues, 'TOKEN_BUDGET')?.severity).toBe('warning')
    expect(hasLintErrors(issues)).toBe(false)
  })
})
