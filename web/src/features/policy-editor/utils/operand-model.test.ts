import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import {
  answerFieldsFor,
  flagNames,
  inputPaths,
  operandKind,
  operandType,
  operatorsFor,
  optionsOf,
  questionIds,
  signalNames
} from './operand-model'

const baseDefinition = (): TemplateDefinition => ({
  kind: 'custom',
  model: { family: 'jev' },
  input: {
    fields: [
      { path: 'ticket.message', type: 'string', required: true },
      { path: 'ticket.opened_at', type: 'datetime', required: false },
      { path: 'ticket.priority', type: 'integer', required: false },
      { path: 'ticket.flagged', type: 'boolean', required: false }
    ]
  },
  state: {},
  decisions: [{ label: 'approve' }, { label: 'reject' }],
  preconditions: [],
  questions: {
    category: {
      type: 'choice',
      instructions: 'x',
      criteria: { billing: null, bug: null }
    },
    risk: {
      type: 'score',
      instructions: 'x',
      levels: [
        { label: 'low', criteria: null },
        { label: 'high', criteria: null }
      ]
    },
    urgent: { type: 'boolean', instructions: 'x' }
  },
  signals: [
    { name: 'risk_signal', kind: 'mean', of: [{ input: 'ticket.priority' }] }
  ],
  flagRules: [
    { id: 'f1', when: { all: [] }, flags: ['pii', 'urgent_flag'] },
    { id: 'f2', when: { all: [] }, flags: ['urgent_flag'] }
  ],
  rules: [],
  fallback: { decision: 'reject' }
})

describe('operandKind()', () => {
  it('reads the discriminant of every operand shape', () => {
    expect(operandKind({ answer: 'category', field: 'choice' })).toBe('answer')
    expect(operandKind({ signal: 'risk_signal' })).toBe('signal')
    expect(operandKind({ flag: 'pii' })).toBe('flag')
    expect(operandKind({ input: 'ticket.message' })).toBe('input')
    expect(operandKind({ value: 42 })).toBe('value')
  })
})

describe('answerFieldsFor() / optionsOf()', () => {
  it('narrows fields by question type', () => {
    expect(answerFieldsFor('choice')).toEqual(['choice', 'confidence', 'prob'])
    expect(answerFieldsFor('boolean')).toEqual(['probability', 'confidence'])
  })

  it('reads a choice/score question’s option labels in order', () => {
    const definition = baseDefinition()
    const category = definition.questions.category
    const risk = definition.questions.risk
    if (!category || !risk) throw new Error('fixture missing questions')
    expect(optionsOf(category)).toEqual(['billing', 'bug'])
    expect(optionsOf(risk)).toEqual(['low', 'high'])
  })
})

describe('operandType()', () => {
  const definition = baseDefinition()

  it('types an answer.choice as an option string', () => {
    expect(
      operandType(definition, { answer: 'category', field: 'choice' })
    ).toEqual({ json: 'string', options: ['billing', 'bug'] })
  })

  it('types an answer.confidence as a continuous number', () => {
    expect(
      operandType(definition, { answer: 'category', field: 'confidence' })
    ).toEqual({ json: 'number', continuous: true })
  })

  it('reports nothing for an unknown question or mismatched field', () => {
    expect(
      operandType(definition, { answer: 'nope', field: 'choice' })
    ).toEqual({})
    expect(
      operandType(definition, { answer: 'urgent', field: 'choice' })
    ).toEqual({})
  })

  it('types a signal as numeric and a flag as boolean', () => {
    expect(operandType(definition, { signal: 'risk_signal' })).toEqual({
      json: 'number',
      continuous: true
    })
    expect(operandType(definition, { flag: 'pii' })).toEqual({
      json: 'boolean'
    })
  })

  it('types an input operand from its declared field type', () => {
    expect(operandType(definition, { input: 'ticket.priority' })).toEqual({
      json: 'number',
      date: true
    })
    expect(operandType(definition, { input: 'ticket.opened_at' })).toEqual({
      json: 'string',
      date: true
    })
    expect(operandType(definition, { input: 'not.declared' })).toEqual({})
  })

  it('infers a literal’s type, including ISO date strings', () => {
    expect(operandType(definition, { value: 'hello' })).toEqual({
      json: 'string',
      date: false
    })
    expect(operandType(definition, { value: '2026-01-01' })).toEqual({
      json: 'string',
      date: true
    })
    expect(operandType(definition, { value: 3 })).toEqual({
      json: 'number',
      date: true
    })
    expect(operandType(definition, { value: true })).toEqual({
      json: 'boolean',
      date: false
    })
  })
})

describe('operatorsFor()', () => {
  it('always allows eq/neq/in/exists', () => {
    const ops = operatorsFor({ json: 'object' })
    expect(ops).toEqual(['eq', 'neq', 'in', 'exists'])
  })

  it('adds numeric comparisons for numbers (and unknown types)', () => {
    expect(operatorsFor({ json: 'number' })).toContain('between')
    expect(operatorsFor({})).toContain('gte')
  })

  it('adds length operators for strings and arrays only', () => {
    expect(operatorsFor({ json: 'string' })).toContain('contains')
    expect(operatorsFor({ json: 'array' })).toContain('len_gt')
    expect(operatorsFor({ json: 'boolean' })).not.toContain('contains')
  })

  it('adds date operators only when the type is date-eligible', () => {
    expect(operatorsFor({ json: 'string', date: true })).toContain('before')
    expect(operatorsFor({ json: 'string', date: false })).not.toContain(
      'before'
    )
  })
})

describe('path/name collection', () => {
  const definition = baseDefinition()

  it('collects input paths, question ids and signal names in order', () => {
    expect(inputPaths(definition)).toEqual([
      'ticket.message',
      'ticket.opened_at',
      'ticket.priority',
      'ticket.flagged'
    ])
    expect(questionIds(definition)).toEqual(['category', 'risk', 'urgent'])
    expect(signalNames(definition)).toEqual(['risk_signal'])
  })

  it('collects every flag any flag rule raises, deduplicated in first-seen order', () => {
    expect(flagNames(definition)).toEqual(['pii', 'urgent_flag'])
  })
})
