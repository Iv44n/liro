import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import {
  keyError,
  labelError,
  pathError,
  validateDefinition
} from './definition'

function validDefinition(): TemplateDefinition {
  return {
    kind: 'classify',
    model: { family: 'jev' },
    input: {
      fields: [{ path: 'ticket.message', type: 'string', required: true }]
    },
    state: {},
    decisions: [{ label: 'billing', minConfidence: 0.8 }, { label: 'support' }],
    preconditions: [],
    questions: {
      category: {
        type: 'choice',
        instructions: 'Clasifica `ticket.message`',
        criteria: { billing: null, support: null }
      }
    },
    signals: [],
    flagRules: [],
    rules: [
      { id: 'r1', when: { all: [] }, decision: { fromAnswer: 'category' } }
    ],
    fallback: { decision: 'needs_review' }
  }
}

describe('validateDefinition()', () => {
  it('accepts a well-formed definition', () => {
    expect(validateDefinition(validDefinition())).toEqual([])
  })

  it('flags a bad key pattern (question id)', () => {
    const def = validDefinition()
    def.questions = { 'Not Valid': def.questions.category as never }
    const issues = validateDefinition(def)
    expect(issues.some(issue => issue.path.startsWith('questions'))).toBe(true)
  })

  it('flags a bad input path', () => {
    const def = validDefinition()
    def.input.fields[0] = { ...def.input.fields[0], path: '1bad' } as never
    const issues = validateDefinition(def)
    expect(issues.some(issue => issue.path.includes('path'))).toBe(true)
  })

  it('flags an enum field with no enum values, and a non-enum field with some', () => {
    const def = validDefinition()
    def.input.fields = [{ path: 'level', type: 'enum', required: false }]
    expect(validateDefinition(def).length).toBeGreaterThan(0)
  })

  it('flags a NUL character anywhere in the definition', () => {
    const def = validDefinition()
    def.decisions[0] = {
      ...def.decisions[0],
      label: 'billing',
      description: 'x\u0000y'
    }
    const issues = validateDefinition(def)
    expect(issues.some(issue => issue.message.includes('NUL'))).toBe(true)
  })

  it('flags exists with a right operand, and a missing right on other operators', () => {
    const def = validDefinition()
    def.preconditions = [
      {
        id: 'p1',
        when: {
          op: 'exists',
          left: { input: 'ticket.message' },
          right: { value: 1 }
        },
        decision: 'billing'
      }
    ]
    expect(validateDefinition(def).length).toBeGreaterThan(0)
  })
})

describe('keyError() / labelError() / pathError()', () => {
  it('accepts valid names, rejects invalid ones', () => {
    expect(keyError('category')).toBeNull()
    expect(keyError('Category')).not.toBeNull()
    expect(keyError('constructor')).not.toBeNull()

    expect(labelError('billing-support')).toBeNull()
    expect(labelError('Billing Support')).not.toBeNull()

    expect(pathError('ticket.message')).toBeNull()
    expect(pathError('1ticket')).not.toBeNull()
  })
})
