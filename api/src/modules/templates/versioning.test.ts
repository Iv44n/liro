import { describe, expect, test } from 'bun:test'
import {
  type QuestionDef,
  type TemplateDefinition,
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from './definition'
import type { VersionStatus } from './templates.schemas'
import {
  breakingChanges,
  CHANGE_SEVERITY,
  compareVersions,
  type DefinitionChange,
  diffDefinitions,
  formatVersion,
  isSlug,
  nextVersion,
  parseRef,
  resolveRef,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  slugify,
  type VersionCandidate,
  type VersionNumber
} from './versioning'

// ── Fixtures ─────────────────────────────────────────────────────────────

const base: TemplateDefinitionInput = {
  kind: 'classify',
  input: {
    fields: [
      {
        path: 'ticket.subject',
        type: 'string',
        maxLength: 200,
        description: 'Subject line'
      },
      { path: 'ticket.message', type: 'string', required: true },
      { path: 'customer.plan', type: 'enum', enum: ['free', 'pro'] }
    ]
  },
  decisions: [
    { label: 'bug', description: 'Something is broken', minConfidence: 0.8 },
    { label: 'billing', minConfidence: 0.8 },
    { label: 'other' }
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
    category: {
      type: 'choice',
      instructions: 'What is the ticket about?',
      note: 'Keep the options in sync with the labels',
      criteria: { bug: 'Something is broken', billing: null, other: null }
    },
    urgent: { type: 'boolean', instructions: 'Is the customer blocked?' }
  },
  signals: [
    {
      name: 'risk',
      kind: 'max',
      of: [{ answer: 'urgent', field: 'probability' }]
    }
  ],
  flagRules: [
    {
      id: 'urgent',
      name: 'Urgent tickets',
      when: { op: 'gte', left: { signal: 'risk' }, right: { value: 0.7 } },
      flags: ['urgent']
    }
  ],
  rules: [
    {
      id: 'urgent_bug',
      name: 'Urgent bugs',
      when: {
        all: [
          { op: 'eq', left: { flag: 'urgent' }, right: { value: true } },
          {
            op: 'eq',
            left: { answer: 'category', field: 'choice' },
            right: { value: 'bug' }
          }
        ]
      },
      decision: 'bug',
      confidenceFrom: 'category'
    },
    { id: 'classify', when: { all: [] }, decision: { fromAnswer: 'category' } }
  ]
}

const previous = templateDefinitionSchema.parse(base)

type Edit = (definition: TemplateDefinition) => void

/** A copy of the fixture with `edit` applied, re-validated so tests only diff valid definitions. */
function edited(...edits: Edit[]): TemplateDefinition {
  const next = structuredClone(previous)
  for (const edit of edits) edit(next)
  return templateDefinitionSchema.parse(next)
}

const diff = (...edits: Edit[]) => diffDefinitions(previous, edited(...edits))

/** `CODE path` per change: pins codes, paths and order at once. */
const summary = (changes: readonly DefinitionChange[]) =>
  changes.map(change => `${change.code} ${change.path}`)

function find<T>(items: readonly T[], match: (item: T) => boolean): T {
  const found = items.find(match)
  if (found === undefined) throw new Error('Fixture element not found')
  return found
}

const field = (definition: TemplateDefinition, path: string) =>
  find(definition.input.fields, item => item.path === path)
const label = (definition: TemplateDefinition, name: string) =>
  find(definition.decisions, item => item.label === name)
const rule = (definition: TemplateDefinition, id: string) =>
  find(definition.rules, item => item.id === id)

function question(definition: TemplateDefinition, id: string): QuestionDef {
  const found = definition.questions[id]
  if (!found) throw new Error(`No question ${id}`)
  return found
}

function category(definition: TemplateDefinition) {
  const found = question(definition, 'category')
  if (found.type !== 'choice') throw new Error('category is a choice')
  return found
}

// ── Version numbers ──────────────────────────────────────────────────────

describe('version numbers', () => {
  test.each([
    [{ major: 1, minor: 0 }, '1.0'],
    [{ major: 1, minor: 12 }, '1.12'],
    [{ major: 10, minor: 3 }, '10.3']
  ])('formatVersion(%o) = %s', (version, expected) => {
    expect(formatVersion(version)).toBe(expected)
  })

  test.each<[VersionNumber, VersionNumber, number]>([
    [{ major: 1, minor: 2 }, { major: 1, minor: 2 }, 0],
    [{ major: 1, minor: 2 }, { major: 1, minor: 10 }, -1],
    [{ major: 1, minor: 10 }, { major: 1, minor: 2 }, 1],
    [{ major: 2, minor: 0 }, { major: 1, minor: 9 }, 1],
    [{ major: 1, minor: 9 }, { major: 2, minor: 0 }, -1],
    [{ major: 9, minor: 5 }, { major: 10, minor: 0 }, -1]
  ])('compareVersions(%o, %o) has sign %d', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })

  test('compareVersions sorts numerically, oldest first', () => {
    const versions = ['2.0', '1.10', '10.0', '1.2', '1.0', '9.5'].map(text => {
      const [major, minor] = text.split('.').map(Number)
      return { major: major ?? 0, minor: minor ?? 0 }
    })
    expect(versions.sort(compareVersions).map(formatVersion)).toEqual([
      '1.0',
      '1.2',
      '1.10',
      '2.0',
      '9.5',
      '10.0'
    ])
  })

  test.each<[VersionNumber | null, boolean, VersionNumber]>([
    [null, false, { major: 1, minor: 0 }],
    [null, true, { major: 1, minor: 0 }],
    [{ major: 1, minor: 0 }, false, { major: 1, minor: 1 }],
    [{ major: 1, minor: 3 }, false, { major: 1, minor: 4 }],
    [{ major: 1, minor: 3 }, true, { major: 2, minor: 0 }],
    [{ major: 4, minor: 0 }, true, { major: 5, minor: 0 }]
  ])('nextVersion(%o, { major: %p }) = %o', (latest, major, expected) => {
    expect(nextVersion(latest, { major })).toEqual(expected)
  })
})

// ── diffDefinitions ──────────────────────────────────────────────────────

describe('diffDefinitions', () => {
  describe('no-op', () => {
    test('the same definition has no changes', () => {
      expect(diffDefinitions(previous, previous)).toEqual([])
      expect(diffDefinitions(previous, structuredClone(previous))).toEqual([])
      expect(
        diffDefinitions(previous, templateDefinitionSchema.parse(base))
      ).toEqual([])
    })

    test.each<[string, Edit]>([
      ['labels reordered', d => d.decisions.reverse()],
      ['fields reordered', d => d.input.fields.reverse()],
      [
        'enum values reordered',
        d => {
          field(d, 'customer.plan').enum = ['pro', 'free']
        }
      ],
      [
        'question keys reordered',
        d => {
          d.questions = Object.fromEntries(
            Object.entries(d.questions).reverse()
          )
        }
      ],
      [
        'choice criteria keys reordered',
        d => {
          const choice = category(d)
          choice.criteria = Object.fromEntries(
            Object.entries(choice.criteria).reverse()
          )
        }
      ],
      [
        'alwaysReview: false spelled out',
        d => {
          label(d, 'other').alwaysReview = false
        }
      ],
      [
        'empty state.context spelled out',
        d => {
          d.state.context = {}
        }
      ],
      [
        'state.include spelled out as every field, in another order',
        d => {
          d.state.include = [
            'customer.plan',
            'ticket.message',
            'ticket.subject'
          ]
        }
      ],
      [
        'state.include naming the parent of fields',
        d => {
          d.state.include = ['ticket', 'customer']
        }
      ],
      [
        'pii flag (storage only, not the contract)',
        d => {
          field(d, 'ticket.message').pii = true
        }
      ]
    ])('%s', (_name, edit) => {
      expect(diff(edit)).toEqual([])
    })
  })

  describe('labels', () => {
    test('LABEL_ADDED', () => {
      const changes = diff(d => d.decisions.push({ label: 'feature' }))
      expect(summary(changes)).toEqual(['LABEL_ADDED decisions.feature'])
      expect(changes[0]?.severity).toBe('breaking')
      expect(changes[0]?.message).toContain('`feature`')
    })

    test('LABEL_REMOVED', () => {
      const changes = diff(d => {
        d.decisions = d.decisions.filter(item => item.label !== 'billing')
      })
      expect(summary(changes)).toEqual(['LABEL_REMOVED decisions.billing'])
      expect(changes[0]?.message).toContain('`billing`')
    })

    test('a rename is removed + added', () => {
      const changes = diff(d => {
        label(d, 'bug').label = 'defect'
      })
      expect(summary(changes)).toEqual([
        'LABEL_REMOVED decisions.bug',
        'LABEL_ADDED decisions.defect'
      ])
      expect(breakingChanges(changes)).toHaveLength(2)
    })
  })

  describe('input fields', () => {
    test.each<[string, Edit, string[]]>([
      [
        'required field added (also reaches Jev by default)',
        d => {
          d.input.fields.push({
            path: 'ticket.priority',
            type: 'integer',
            required: true
          })
        },
        [
          'REQUIRED_FIELD_ADDED input.fields.ticket.priority',
          'STATE_CHANGED state.include'
        ]
      ],
      [
        'optional field added',
        d => {
          d.input.fields.push({
            path: 'ticket.priority',
            type: 'integer',
            required: false
          })
        },
        [
          'STATE_CHANGED state.include',
          'OPTIONAL_FIELD_ADDED input.fields.ticket.priority'
        ]
      ],
      [
        'optional field removed',
        d => {
          d.input.fields = d.input.fields.filter(
            item => item.path !== 'customer.plan'
          )
        },
        [
          'FIELD_REMOVED input.fields.customer.plan',
          'STATE_CHANGED state.include'
        ]
      ],
      [
        'required field removed',
        d => {
          d.input.fields = d.input.fields.filter(
            item => item.path !== 'ticket.message'
          )
        },
        [
          'FIELD_REMOVED input.fields.ticket.message',
          'STATE_CHANGED state.include'
        ]
      ],
      [
        'type changed (dropped constraints are not reported separately)',
        d => {
          const subject = field(d, 'ticket.subject')
          subject.type = 'integer'
          delete subject.maxLength
        },
        ['FIELD_TYPE_CHANGED input.fields.ticket.subject']
      ],
      [
        'enum became string (no ENUM_VALUE_REMOVED)',
        d => {
          const plan = field(d, 'customer.plan')
          plan.type = 'string'
          delete plan.enum
        },
        ['FIELD_TYPE_CHANGED input.fields.customer.plan']
      ],
      [
        'type changed and made required',
        d => {
          const subject = field(d, 'ticket.subject')
          subject.type = 'integer'
          subject.required = true
          delete subject.maxLength
        },
        [
          'FIELD_TYPE_CHANGED input.fields.ticket.subject',
          'FIELD_MADE_REQUIRED input.fields.ticket.subject'
        ]
      ],
      [
        'made required',
        d => {
          field(d, 'customer.plan').required = true
        },
        ['FIELD_MADE_REQUIRED input.fields.customer.plan']
      ],
      [
        'made optional',
        d => {
          field(d, 'ticket.message').required = false
        },
        ['FIELD_MADE_OPTIONAL input.fields.ticket.message']
      ],
      [
        'enum value removed',
        d => {
          field(d, 'customer.plan').enum = ['free']
        },
        ['ENUM_VALUE_REMOVED input.fields.customer.plan']
      ],
      [
        'enum value added',
        d => {
          field(d, 'customer.plan').enum = ['free', 'pro', 'enterprise']
        },
        ['ENUM_VALUE_ADDED input.fields.customer.plan']
      ],
      [
        'enum value replaced',
        d => {
          field(d, 'customer.plan').enum = ['free', 'enterprise']
        },
        [
          'ENUM_VALUE_REMOVED input.fields.customer.plan',
          'ENUM_VALUE_ADDED input.fields.customer.plan'
        ]
      ],
      [
        'maxLength added',
        d => {
          field(d, 'ticket.message').maxLength = 5_000
        },
        ['FIELD_CONSTRAINT_TIGHTENED input.fields.ticket.message']
      ],
      [
        'maxLength lowered',
        d => {
          field(d, 'ticket.subject').maxLength = 100
        },
        ['FIELD_CONSTRAINT_TIGHTENED input.fields.ticket.subject']
      ],
      [
        'maxLength raised',
        d => {
          field(d, 'ticket.subject').maxLength = 300
        },
        ['FIELD_CONSTRAINT_RELAXED input.fields.ticket.subject']
      ],
      [
        'maxLength removed',
        d => {
          delete field(d, 'ticket.subject').maxLength
        },
        ['FIELD_CONSTRAINT_RELAXED input.fields.ticket.subject']
      ],
      [
        'maxLength unchanged',
        d => {
          field(d, 'ticket.subject').maxLength = 200
        },
        []
      ],
      [
        'description changed',
        d => {
          field(d, 'ticket.subject').description = 'The email subject'
        },
        ['DESCRIPTION_CHANGED input.fields.ticket.subject']
      ],
      [
        'description added',
        d => {
          field(d, 'ticket.message').description = 'The customer message'
        },
        ['DESCRIPTION_CHANGED input.fields.ticket.message']
      ],
      [
        'description removed',
        d => {
          delete field(d, 'ticket.subject').description
        },
        ['DESCRIPTION_CHANGED input.fields.ticket.subject']
      ]
    ])('%s', (_name, edit, expected) => {
      expect(summary(diff(edit))).toEqual(expected)
    })

    test('messages name the field and what changed', () => {
      const [removed, added] = diff(d => {
        field(d, 'customer.plan').enum = ['free', 'enterprise']
      })
      expect(removed?.message).toBe(
        'Field `customer.plan` no longer accepts `pro`'
      )
      expect(added?.message).toBe(
        'Field `customer.plan` now also accepts `enterprise`'
      )

      const [lowered] = diff(d => {
        field(d, 'ticket.subject').maxLength = 100
      })
      expect(lowered?.message).toBe(
        'maxLength of `ticket.subject` changed from 200 to 100'
      )

      const [unlimited] = diff(d => {
        delete field(d, 'ticket.subject').maxLength
      })
      expect(unlimited?.message).toBe(
        'maxLength of `ticket.subject` changed from 200 to no limit'
      )

      const [retyped] = diff(d => {
        const subject = field(d, 'ticket.subject')
        subject.type = 'integer'
        delete subject.maxLength
      })
      expect(retyped?.message).toBe(
        'Field `ticket.subject` changed type from string to integer'
      )
    })

    test('duplicate field paths compare their first occurrence', () => {
      const duplicated = edited(d => {
        d.input.fields.push({
          path: 'ticket.message',
          type: 'integer',
          required: true
        })
      })
      expect(diffDefinitions(previous, duplicated)).toEqual([])
    })
  })

  describe('model', () => {
    const pinned =
      (pin?: string): Edit =>
      d => {
        d.model = pin ? { family: 'jev', version: pin } : { family: 'jev' }
      }

    test('pinning a version', () => {
      const changes = diff(pinned('1.13.0'))
      expect(summary(changes)).toEqual(['MODEL_CHANGED model'])
      expect(changes[0]?.severity).toBe('behavior')
      expect(changes[0]?.message).toBe(
        'Model changed from jev (latest) to jev-1.13.0'
      )
    })

    test('changing and unpinning the version', () => {
      const v13 = edited(pinned('1.13.0'))
      expect(summary(diffDefinitions(v13, edited(pinned('1.14.0'))))).toEqual([
        'MODEL_CHANGED model'
      ])
      expect(diffDefinitions(v13, previous)[0]?.message).toBe(
        'Model changed from jev-1.13.0 to jev (latest)'
      )
      expect(diffDefinitions(v13, edited(pinned('1.13.0')))).toEqual([])
    })
  })

  describe('questions', () => {
    test.each<[string, Edit, string[], string[]]>([
      [
        'added',
        d => {
          d.questions.sentiment = {
            type: 'score',
            instructions: 'How upset is the customer?',
            levels: [
              { label: 'calm', criteria: null },
              { label: 'angry', criteria: null }
            ]
          }
        },
        ['QUESTIONS_CHANGED questions.sentiment'],
        ['Question `sentiment` added']
      ],
      [
        'removed',
        d => {
          delete d.questions.urgent
        },
        ['QUESTIONS_CHANGED questions.urgent'],
        ['Question `urgent` removed']
      ],
      [
        'instructions changed',
        d => {
          category(d).instructions = { question: 'What is it about?' }
        },
        ['QUESTIONS_CHANGED questions.category'],
        ['Question `category` changed (instructions)']
      ],
      [
        'option added',
        d => {
          category(d).criteria.account = 'Login and profile issues'
        },
        ['QUESTIONS_CHANGED questions.category'],
        ['Question `category` changed (criteria)']
      ],
      [
        'option description changed',
        d => {
          category(d).criteria.billing = 'Invoices and refunds'
        },
        ['QUESTIONS_CHANGED questions.category'],
        ['Question `category` changed (criteria)']
      ],
      [
        '`when` added',
        d => {
          question(d, 'urgent').when = {
            op: 'exists',
            left: { input: 'ticket.message' }
          }
        },
        ['QUESTIONS_CHANGED questions.urgent'],
        ['Question `urgent` changed (when)']
      ],
      [
        'type changed',
        d => {
          d.questions.urgent = {
            type: 'score',
            instructions: 'Is the customer blocked?',
            levels: [
              { label: 'no', criteria: null },
              { label: 'yes', criteria: null }
            ]
          }
        },
        ['QUESTIONS_CHANGED questions.urgent'],
        ['Question `urgent` changed (levels, type)']
      ],
      [
        'note only (never sent to Jev)',
        d => {
          category(d).note = 'Reworded in v2'
        },
        ['DESCRIPTION_CHANGED questions.category'],
        ['Note of question `category` changed']
      ],
      [
        'note and instructions',
        d => {
          const choice = category(d)
          delete choice.note
          choice.instructions = 'Classify the ticket'
        },
        [
          'QUESTIONS_CHANGED questions.category',
          'DESCRIPTION_CHANGED questions.category'
        ],
        [
          'Question `category` changed (instructions)',
          'Note of question `category` changed'
        ]
      ]
    ])('%s', (_name, edit, expected, messages) => {
      const changes = diff(edit)
      expect(summary(changes)).toEqual(expected)
      expect(changes.map(change => change.message)).toEqual(messages)
    })

    test('boolean `criteria: {}` sends the same request as no criteria', () => {
      const withCriteria = (criteria?: Record<string, string | null>) =>
        edited(d => {
          d.questions.urgent = {
            type: 'boolean',
            instructions: 'Is the customer blocked?',
            ...(criteria ? { criteria } : {})
          }
        })
      expect(diffDefinitions(withCriteria(), withCriteria({}))).toEqual([])
      expect(diffDefinitions(withCriteria({}), withCriteria())).toEqual([])
      // An explicit null is sent, so it is a change.
      expect(
        summary(diffDefinitions(withCriteria({}), withCriteria({ true: null })))
      ).toEqual(['QUESTIONS_CHANGED questions.urgent'])
    })

    test('ids that shadow Object.prototype are plain keys', () => {
      const id: string = 'constructor'
      // The schema rejects `constructor` as an id, so it is injected without
      // re-validating (unlike `edited`): this checks the diff's own lookups.
      const withConstructor = structuredClone(previous)
      withConstructor.questions[id] = {
        type: 'boolean',
        instructions: 'Is it a construction company?'
      }
      expect(diffDefinitions(previous, withConstructor)).toEqual([
        {
          code: 'QUESTIONS_CHANGED',
          severity: 'behavior',
          message: 'Question `constructor` added',
          path: 'questions.constructor'
        }
      ])
      expect(diffDefinitions(withConstructor, previous)[0]?.message).toBe(
        'Question `constructor` removed'
      )
    })
  })

  describe('policy', () => {
    test.each<[string, Edit, string[], string[]]>([
      [
        'label minConfidence changed',
        d => {
          label(d, 'bug').minConfidence = 0.9
        },
        ['POLICY_CHANGED decisions.bug'],
        ['Label `bug`: minConfidence 0.8 → 0.9']
      ],
      [
        'label minConfidence set (0 still reviews a null confidence)',
        d => {
          label(d, 'other').minConfidence = 0
        },
        ['POLICY_CHANGED decisions.other'],
        ['Label `other`: minConfidence none → 0']
      ],
      [
        'label minConfidence removed',
        d => {
          delete label(d, 'billing').minConfidence
        },
        ['POLICY_CHANGED decisions.billing'],
        ['Label `billing`: minConfidence 0.8 → none']
      ],
      [
        'label alwaysReview',
        d => {
          label(d, 'billing').alwaysReview = true
        },
        ['POLICY_CHANGED decisions.billing'],
        ['Label `billing`: alwaysReview false → true']
      ],
      [
        'label policy and description',
        d => {
          const bug = label(d, 'bug')
          bug.minConfidence = 0.9
          bug.alwaysReview = true
          bug.description = 'A defect in the product'
        },
        ['POLICY_CHANGED decisions.bug', 'DESCRIPTION_CHANGED decisions.bug'],
        [
          'Label `bug`: minConfidence 0.8 → 0.9, alwaysReview false → true',
          'Description of label `bug` changed'
        ]
      ],
      [
        'label description only',
        d => {
          label(d, 'other').description = 'Anything else'
        },
        ['DESCRIPTION_CHANGED decisions.other'],
        ['Description of label `other` changed']
      ],
      [
        'precondition changed',
        d => {
          find(d.preconditions, item => item.id === 'empty').when = {
            op: 'len_lt',
            left: { input: 'ticket.message' },
            right: { value: 5 }
          }
        },
        ['POLICY_CHANGED preconditions'],
        ['Preconditions: changed `empty`']
      ],
      [
        'precondition added',
        d => {
          d.preconditions.push({
            id: 'enterprise',
            when: {
              op: 'eq',
              left: { input: 'customer.plan' },
              right: { value: 'enterprise' }
            },
            decision: 'needs_review'
          })
        },
        ['POLICY_CHANGED preconditions'],
        ['Preconditions: added `enterprise`']
      ],
      [
        'precondition removed',
        d => {
          d.preconditions = []
        },
        ['POLICY_CHANGED preconditions'],
        ['Preconditions: removed `empty`']
      ],
      [
        'signal added',
        d => {
          d.signals.push({
            name: 'calm',
            kind: 'weighted',
            terms: [
              {
                operand: { answer: 'urgent', field: 'probability' },
                weight: 1,
                invert: true
              }
            ]
          })
        },
        ['POLICY_CHANGED signals'],
        ['Signals: added `calm`']
      ],
      [
        'signal renamed (its name is its id)',
        d => {
          find(d.signals, item => item.name === 'risk').name = 'danger'
        },
        ['POLICY_CHANGED signals'],
        ['Signals: added `danger`; removed `risk`']
      ],
      [
        'signal inserted first (not a reorder)',
        d => {
          d.signals.unshift({
            name: 'calm',
            kind: 'min',
            of: [{ answer: 'category', field: 'confidence' }]
          })
        },
        ['POLICY_CHANGED signals'],
        ['Signals: added `calm`']
      ],
      [
        'flag rule changed',
        d => {
          find(d.flagRules, item => item.id === 'urgent').flags = [
            'urgent',
            'escalate'
          ]
        },
        ['POLICY_CHANGED flagRules'],
        ['Flag rules: changed `urgent`']
      ],
      [
        'rule added',
        d => {
          d.rules.unshift({
            id: 'enterprise_billing',
            when: {
              op: 'eq',
              left: { input: 'customer.plan' },
              right: { value: 'enterprise' }
            },
            decision: 'billing'
          })
        },
        ['POLICY_CHANGED rules'],
        ['Rules: added `enterprise_billing`']
      ],
      [
        'rules reordered',
        d => d.rules.reverse(),
        ['POLICY_CHANGED rules'],
        ['Rules: reordered']
      ],
      [
        'rules added, removed and changed at once',
        d => {
          rule(d, 'classify').confidenceFrom = 'category'
          d.rules = [
            rule(d, 'classify'),
            {
              id: 'billing_plan',
              when: { op: 'exists', left: { input: 'customer.plan' } },
              decision: 'billing'
            }
          ]
          d.rules.unshift({
            id: 'urgent_first',
            when: {
              op: 'eq',
              left: { flag: 'urgent' },
              right: { value: true }
            },
            decision: 'bug'
          })
        },
        ['POLICY_CHANGED rules'],
        [
          'Rules: added `urgent_first`, `billing_plan`; removed `urgent_bug`; changed `classify`'
        ]
      ],
      [
        'rule changed and reordered',
        d => {
          rule(d, 'classify').decision = 'other'
          d.rules.reverse()
        },
        ['POLICY_CHANGED rules'],
        ['Rules: changed `classify`; reordered']
      ],
      [
        'rule confidenceFrom',
        d => {
          delete rule(d, 'urgent_bug').confidenceFrom
        },
        ['POLICY_CHANGED rules'],
        ['Rules: changed `urgent_bug`']
      ],
      [
        'duplicate rule ids (a lint error) still register',
        d => {
          d.rules.push({ id: 'classify', when: { all: [] }, decision: 'other' })
        },
        ['POLICY_CHANGED rules'],
        ['Rules changed']
      ],
      [
        'fallback',
        d => {
          d.fallback = { decision: 'other' }
        },
        ['POLICY_CHANGED fallback'],
        ['Fallback changed from `needs_review` to `other`']
      ],
      [
        'rule name only',
        d => {
          rule(d, 'urgent_bug').name = 'Blocking bugs'
        },
        ['DESCRIPTION_CHANGED rules.urgent_bug'],
        ['Name of rule `urgent_bug` changed']
      ],
      [
        'flag rule name removed',
        d => {
          delete find(d.flagRules, item => item.id === 'urgent').name
        },
        ['DESCRIPTION_CHANGED flagRules.urgent'],
        ['Name of flag rule `urgent` changed']
      ],
      [
        'precondition name added',
        d => {
          find(d.preconditions, item => item.id === 'empty').name = 'Empty'
        },
        ['DESCRIPTION_CHANGED preconditions.empty'],
        ['Name of precondition `empty` changed']
      ],
      [
        'rule name and condition',
        d => {
          const urgent = rule(d, 'urgent_bug')
          urgent.name = 'Blocking bugs'
          urgent.when = { any: [] }
        },
        ['POLICY_CHANGED rules', 'DESCRIPTION_CHANGED rules.urgent_bug'],
        ['Rules: changed `urgent_bug`', 'Name of rule `urgent_bug` changed']
      ]
    ])('%s', (_name, edit, expected, messages) => {
      const changes = diff(edit)
      expect(summary(changes)).toEqual(expected)
      expect(changes.map(change => change.message)).toEqual(messages)
    })

    test('signals moved relative to each other', () => {
      const two = edited(d => {
        d.signals.push({
          name: 'calm',
          kind: 'mean',
          of: [{ answer: 'category', field: 'confidence' }]
        })
      })
      const swapped = structuredClone(two)
      swapped.signals.reverse()
      expect(diffDefinitions(two, swapped)).toEqual([
        {
          code: 'POLICY_CHANGED',
          severity: 'behavior',
          message: 'Signals: reordered',
          path: 'signals'
        }
      ])
    })
  })

  describe('state', () => {
    test.each<[string, Edit, string[]]>([
      [
        'include narrowed',
        d => {
          d.state.include = ['ticket.subject', 'ticket.message']
        },
        ['Input sent to Jev no longer includes `customer.plan`']
      ],
      [
        'field added under the default include',
        d => {
          d.input.fields.push({
            path: 'ticket.language',
            type: 'string',
            required: false
          })
        },
        ['Input sent to Jev now includes `ticket.language`']
      ],
      [
        'include swapped',
        d => {
          d.state.include = ['ticket.message', 'customer.plan']
          d.input.fields.push({
            path: 'ticket.language',
            type: 'string',
            required: false
          })
          d.state.include.push('ticket.language')
        },
        [
          'Input sent to Jev now includes `ticket.language`; no longer includes `ticket.subject`'
        ]
      ],
      [
        'context key added',
        d => {
          d.state.context = { company: 'Acme' }
        },
        ['Static context sent to Jev changed (`company`)']
      ]
    ])('%s', (_name, edit, messages) => {
      const changes = diff(edit).filter(
        change => change.code === 'STATE_CHANGED'
      )
      expect(changes.map(change => change.message)).toEqual(messages)
      expect(changes.every(change => change.severity === 'behavior')).toBe(true)
    })

    test('context keys changed, removed and reordered', () => {
      const withContext = (context: TemplateDefinition['state']['context']) =>
        edited(d => {
          d.state.context = context
        })
      const before = withContext({
        company: 'Acme',
        policy: { refunds: 30, tone: 'formal' },
        region: 'eu'
      })

      expect(
        diffDefinitions(
          before,
          withContext({
            region: 'eu',
            policy: { tone: 'formal', refunds: 30 },
            company: 'Acme'
          })
        )
      ).toEqual([])

      const changes = diffDefinitions(
        before,
        withContext({
          company: 'Acme',
          policy: { refunds: 14, tone: 'formal' }
        })
      )
      expect(summary(changes)).toEqual(['STATE_CHANGED state.context'])
      expect(changes[0]?.message).toBe(
        'Static context sent to Jev changed (`policy`, `region`)'
      )

      expect(summary(diffDefinitions(before, previous))).toEqual([
        'STATE_CHANGED state.context'
      ])
    })

    test('a context key holding null is not an absent key', () => {
      const withNull = edited(d => {
        d.state.context = { region: null }
      })
      expect(summary(diffDefinitions(previous, withNull))).toEqual([
        'STATE_CHANGED state.context'
      ])
    })

    test('an included parent covers the fields added under it', () => {
      const parentOnly = edited(d => {
        d.state.include = ['ticket']
      })
      const addUnder = (path: string) =>
        edited(d => {
          d.state.include = ['ticket']
          d.input.fields.push({ path, type: 'string', required: false })
        })

      expect(
        summary(diffDefinitions(parentOnly, addUnder('ticket.language')))
      ).toEqual([
        'STATE_CHANGED state.include',
        'OPTIONAL_FIELD_ADDED input.fields.ticket.language'
      ])
      expect(
        summary(diffDefinitions(parentOnly, addUnder('customer.region')))
      ).toEqual(['OPTIONAL_FIELD_ADDED input.fields.customer.region'])
    })

    test('an include path inside an object field is kept as is', () => {
      const withMeta = (include: string[]) =>
        edited(d => {
          d.input.fields.push({ path: 'meta', type: 'object', required: false })
          d.state.include = include
        })

      expect(
        diffDefinitions(
          withMeta(['ticket.message', 'meta.source']),
          withMeta(['ticket.message', 'meta'])
        ).map(change => change.message)
      ).toEqual([
        'Input sent to Jev now includes `meta`; no longer includes `meta.source`'
      ])
    })

    test('an include path that reaches nothing counts once it is declared', () => {
      // A lint error (STATE_INCLUDE_UNKNOWN), but the diff must not hide that
      // declaring the field makes Jev see it.
      const dangling = edited(d => {
        d.state.include = ['ticket.message', 'ticket.language']
      })
      const declared = edited(d => {
        d.state.include = ['ticket.message', 'ticket.language']
        d.input.fields.push({
          path: 'ticket.language',
          type: 'string',
          required: false
        })
      })
      const changes = diffDefinitions(dangling, declared)
      expect(summary(changes)).toEqual([
        'STATE_CHANGED state.include',
        'OPTIONAL_FIELD_ADDED input.fields.ticket.language'
      ])
      expect(changes[0]?.message).toBe(
        'Input sent to Jev now includes `ticket.language`'
      )
      // Dropping a path that never reached Jev changes nothing.
      expect(
        diffDefinitions(
          dangling,
          edited(d => {
            d.state.include = ['ticket.message']
          })
        )
      ).toEqual([])
    })

    test('include and context changes are reported separately', () => {
      expect(
        summary(
          diff(d => {
            d.state.include = ['ticket.message']
            d.state.context = { company: 'Acme' }
          })
        )
      ).toEqual(['STATE_CHANGED state.include', 'STATE_CHANGED state.context'])
    })
  })

  describe('order', () => {
    const everything: Edit = d => {
      d.decisions = d.decisions.filter(item => item.label !== 'other')
      d.decisions.push({ label: 'feature' })
      d.input.fields.push({
        path: 'ticket.priority',
        type: 'integer',
        required: true
      })
      field(d, 'customer.plan').enum = ['free', 'pro', 'enterprise']
      field(d, 'ticket.subject').description = 'The email subject'
      d.model = { family: 'jev', version: '1.13.0' }
      question(d, 'urgent').instructions = 'Is the customer blocked right now?'
      d.fallback = { decision: 'billing' }
      rule(d, 'urgent_bug').name = 'Blocking bugs'
      d.state.context = { company: 'Acme' }
    }

    test('breaking, then behavior, then compatible; by section and key within each', () => {
      expect(summary(diff(everything))).toEqual([
        'LABEL_ADDED decisions.feature',
        'LABEL_REMOVED decisions.other',
        'REQUIRED_FIELD_ADDED input.fields.ticket.priority',
        'MODEL_CHANGED model',
        'QUESTIONS_CHANGED questions.urgent',
        'POLICY_CHANGED fallback',
        'STATE_CHANGED state.include',
        'STATE_CHANGED state.context',
        'ENUM_VALUE_ADDED input.fields.customer.plan',
        'DESCRIPTION_CHANGED input.fields.ticket.subject',
        'DESCRIPTION_CHANGED rules.urgent_bug'
      ])
    })

    test('independent of the order labels, fields, enums and questions are declared in', () => {
      const shuffled = (definition: TemplateDefinition) => {
        const copy = structuredClone(definition)
        copy.decisions.reverse()
        copy.input.fields.reverse()
        for (const item of copy.input.fields) item.enum?.reverse()
        copy.questions = Object.fromEntries(
          Object.entries(copy.questions).reverse()
        )
        return copy
      }
      const next = edited(everything)
      expect(diffDefinitions(shuffled(previous), shuffled(next))).toEqual(
        diffDefinitions(previous, next)
      )
    })

    test('every change carries its code severity, a path and a message', () => {
      for (const change of diff(everything)) {
        expect(change.severity).toBe(CHANGE_SEVERITY[change.code])
        expect(change.path).toBeString()
        expect(change.message.length).toBeGreaterThan(0)
      }
    })

    test('does not mutate its inputs', () => {
      const next = edited(everything)
      const snapshot = structuredClone([previous, next])
      diffDefinitions(previous, next)
      expect([previous, next]).toEqual(snapshot)
    })
  })

  test('each code has the severity the spec gives it', () => {
    expect(CHANGE_SEVERITY).toEqual({
      LABEL_ADDED: 'breaking',
      LABEL_REMOVED: 'breaking',
      REQUIRED_FIELD_ADDED: 'breaking',
      FIELD_REMOVED: 'breaking',
      FIELD_TYPE_CHANGED: 'breaking',
      FIELD_MADE_REQUIRED: 'breaking',
      ENUM_VALUE_REMOVED: 'breaking',
      FIELD_CONSTRAINT_TIGHTENED: 'breaking',
      MODEL_CHANGED: 'behavior',
      QUESTIONS_CHANGED: 'behavior',
      POLICY_CHANGED: 'behavior',
      STATE_CHANGED: 'behavior',
      OPTIONAL_FIELD_ADDED: 'compatible',
      FIELD_MADE_OPTIONAL: 'compatible',
      ENUM_VALUE_ADDED: 'compatible',
      FIELD_CONSTRAINT_RELAXED: 'compatible',
      DESCRIPTION_CHANGED: 'compatible'
    })
  })
})

describe('breakingChanges', () => {
  test('keeps only the breaking changes, in order', () => {
    const changes = diff(
      d => {
        d.decisions.push({ label: 'feature' })
      },
      d => {
        field(d, 'customer.plan').enum = ['free']
      },
      d => {
        d.fallback = { decision: 'other' }
      },
      d => {
        field(d, 'ticket.subject').maxLength = 300
      }
    )
    expect(summary(breakingChanges(changes))).toEqual([
      'LABEL_ADDED decisions.feature',
      'ENUM_VALUE_REMOVED input.fields.customer.plan'
    ])
  })

  test('nothing breaking in a minor-safe diff', () => {
    const changes = diff(
      d => {
        d.model = { family: 'jev', version: '1.13.0' }
      },
      d => {
        field(d, 'ticket.message').required = false
      }
    )
    expect(changes).toHaveLength(2)
    expect(breakingChanges(changes)).toEqual([])
    expect(breakingChanges([])).toEqual([])
  })
})

// ── Slugs and refs ───────────────────────────────────────────────────────

describe('slugs', () => {
  test.each([
    ['a', true],
    ['support-ticket-classifier', true],
    ['v2', true],
    ['2024-report', true],
    ['x'.repeat(SLUG_MAX_LENGTH), true],
    ['', false],
    ['x'.repeat(SLUG_MAX_LENGTH + 1), false],
    ['Support', false],
    ['snake_case', false],
    ['-leading', false],
    ['trailing-', false],
    ['double--hyphen', false],
    ['with space', false],
    ['ñandu', false],
    ['slug@1', false]
  ])('isSlug(%p) = %p', (value, expected) => {
    expect(isSlug(value)).toBe(expected)
    if (value.length <= SLUG_MAX_LENGTH) {
      expect(SLUG_PATTERN.test(value)).toBe(expected)
    }
  })

  test.each([
    ['Support Ticket Classifier', 'support-ticket-classifier'],
    ['Clasificación de Reseñas', 'clasificacion-de-resenas'],
    ['Straße & Café', 'strasse-cafe'],
    ['Ærø Łódź Þór', 'aero-lodz-thor'],
    ['İstanbul', 'istanbul'],
    ['ﬁle ①', 'file-1'],
    ['Ｆｕｌｌ　Ｗｉｄｔｈ', 'full-width'],
    ['  --Hello,   World!!--  ', 'hello-world'],
    ['snake_case_name', 'snake-case-name'],
    ['Version 2.0', 'version-2-0'],
    ['', 'template'],
    ['!!! ???', 'template'],
    ['日本語', 'template'],
    ['a'.repeat(80), 'a'.repeat(64)],
    [`${'a'.repeat(63)} b`, 'a'.repeat(63)]
  ])('slugify(%p) = %p', (name, expected) => {
    const slug = slugify(name)
    expect(slug).toBe(expected)
    expect(isSlug(slug)).toBe(true)
    expect(parseRef(slug)).toStrictEqual({ slug })
  })
})

describe('parseRef', () => {
  test.each([
    ['support-ticket-classifier', { slug: 'support-ticket-classifier' }],
    ['a', { slug: 'a' }],
    ['slug@1', { slug: 'slug', major: 1 }],
    ['slug@1.2', { slug: 'slug', major: 1, minor: 2 }],
    ['slug@0', { slug: 'slug', major: 0 }],
    ['slug@0.0', { slug: 'slug', major: 0, minor: 0 }],
    ['v2@10.25', { slug: 'v2', major: 10, minor: 25 }],
    [`${'x'.repeat(64)}@3`, { slug: 'x'.repeat(64), major: 3 }],
    [
      'slug@2147483647.2147483647',
      { slug: 'slug', major: 2147483647, minor: 2147483647 }
    ]
  ])('parseRef(%p)', (ref, expected) => {
    expect(parseRef(ref)).toStrictEqual(expected)
  })

  test.each([
    '',
    '@1',
    '@1.2',
    'slug@',
    'slug@1.',
    'slug@.1',
    'slug@1.2.3',
    'slug@v1',
    'slug@01',
    'slug@1.02',
    'slug@-1',
    'slug@1e3',
    'slug@1.2-beta',
    'slug@1@2',
    'slug@١',
    'slug@2147483648',
    'slug@1.2147483648',
    'Slug',
    'slug_name',
    '-slug',
    'slug-',
    'a--b',
    ' slug',
    'slug ',
    'slug@1 ',
    'slug/1',
    'x'.repeat(65),
    `${'x'.repeat(65)}@1`
  ])('parseRef(%p) is null', ref => {
    expect(parseRef(ref)).toBeNull()
  })
})

// ── resolveRef ───────────────────────────────────────────────────────────

const version = (
  major: number,
  minor: number,
  status: VersionStatus
): VersionCandidate => ({ id: `v${major}.${minor}`, major, minor, status })

/** Deliberately unsorted. */
const versions: VersionCandidate[] = [
  version(1, 3, 'model_unavailable'),
  version(2, 1, 'deprecated'),
  version(1, 0, 'published'),
  version(4, 0, 'draft'),
  version(1, 2, 'deprecated'),
  version(3, 0, 'model_unavailable'),
  version(1, 1, 'published'),
  version(2, 2, 'model_unavailable'),
  version(2, 0, 'deprecated')
]

describe('resolveRef', () => {
  test.each<
    [{ major?: number; minor?: number }, string | null, boolean, boolean]
  >([
    // exact
    [{ major: 1, minor: 0 }, 'v1.0', false, false],
    [{ major: 1, minor: 1 }, 'v1.1', false, false],
    [{ major: 1, minor: 2 }, 'v1.2', true, false],
    [{ major: 1, minor: 3 }, 'v1.3', false, false],
    [{ major: 3, minor: 0 }, 'v3.0', false, false],
    [{ major: 4, minor: 0 }, null, false, false],
    [{ major: 1, minor: 9 }, null, false, false],
    [{ major: 9, minor: 0 }, null, false, false],
    // @major
    [{ major: 1 }, 'v1.1', false, false],
    [{ major: 2 }, 'v2.1', true, false],
    [{ major: 3 }, null, false, false],
    [{ major: 4 }, null, false, false],
    [{ major: 5 }, null, false, false],
    // bare
    [{}, 'v1.1', false, true],
    // a minor without a major is not a ref
    [{ minor: 1 }, null, false, false]
  ])('resolveRef(%o) → %p', (ref, id, deprecated, floating) => {
    const resolved = resolveRef(versions, ref)
    if (id === null) {
      expect(resolved).toBeNull()
      return
    }
    expect(resolved?.version.id).toBe(id)
    expect(resolved?.deprecated).toBe(deprecated)
    expect(resolved?.floating).toBe(floating)
  })

  test('exact model_unavailable versions resolve (the caller refuses them)', () => {
    expect(resolveRef(versions, { major: 1, minor: 3 })?.version.status).toBe(
      'model_unavailable'
    )
  })

  test('bare picks the highest published version across majors, numerically', () => {
    const many = [
      version(9, 5, 'published'),
      version(10, 0, 'published'),
      version(2, 0, 'published'),
      version(11, 0, 'deprecated'),
      version(12, 0, 'model_unavailable'),
      version(13, 0, 'draft')
    ]
    expect(resolveRef(many, {})).toEqual({
      version: version(10, 0, 'published'),
      deprecated: false,
      floating: true
    })
    expect(resolveRef(many, { major: 9 })?.version.id).toBe('v9.5')
  })

  test('@major prefers a published minor over a higher deprecated one', () => {
    const mixed = [
      version(1, 0, 'published'),
      version(1, 4, 'deprecated'),
      version(1, 5, 'model_unavailable')
    ]
    expect(resolveRef(mixed, { major: 1 })).toEqual({
      version: version(1, 0, 'published'),
      deprecated: false,
      floating: false
    })
  })

  test('bare never falls back to deprecated or unavailable versions', () => {
    const retired = versions.filter(item => item.status !== 'published')
    expect(resolveRef(retired, {})).toBeNull()
    expect(resolveRef(retired, { major: 2 })?.version.id).toBe('v2.1')
  })

  test.each([{}, { major: 1 }, { major: 1, minor: 0 }])(
    'nothing resolves without versions (%o)',
    ref => {
      expect(resolveRef([], ref)).toBeNull()
      expect(resolveRef([version(1, 0, 'draft')], ref)).toBeNull()
    }
  )

  test('a status outside the known released ones never resolves', () => {
    // Fail closed: a status added later must not become runnable by default.
    const archived = {
      id: 'v1.0',
      major: 1,
      minor: 0,
      status: 'archived' as VersionStatus
    }
    expect(resolveRef([archived], { major: 1, minor: 0 })).toBeNull()
    expect(resolveRef([archived], { major: 1 })).toBeNull()
    expect(resolveRef([archived], {})).toBeNull()
  })

  test('returns the rows the caller passed', () => {
    const rows = [
      { ...version(1, 0, 'published'), definitionHash: 'abc' },
      { ...version(1, 1, 'published'), definitionHash: 'def' }
    ]
    const resolved = resolveRef(rows, { major: 1 })
    expect(resolved?.version).toBe(rows[1])
    expect(resolved?.version.definitionHash).toBe('def')
  })

  test.each([
    ['support-ticket-classifier', 'v1.1', true],
    ['support-ticket-classifier@1', 'v1.1', false],
    ['support-ticket-classifier@2', 'v2.1', false],
    ['support-ticket-classifier@1.2', 'v1.2', false]
  ])('parseRef(%p) feeds resolveRef → %p', (text, id, floating) => {
    const ref = parseRef(text)
    if (!ref) throw new Error(`Unparseable ref ${text}`)
    const resolved = resolveRef(versions, ref)
    expect(resolved?.version.id).toBe(id)
    expect(resolved?.floating).toBe(floating)
  })
})
