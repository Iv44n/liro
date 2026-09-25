import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import {
  addClassifyLabel,
  addDecision,
  addField,
  addQuestion,
  convertQuestion,
  includeState,
  isQuestionReferenced,
  move,
  moveField,
  moveQuestion,
  removeClassifyLabel,
  removeField,
  renameClassifyLabel,
  renameInputPath,
  renameLabel,
  renameLevel,
  renameOption,
  renameQuestion,
  setAllIncluded,
  setContext,
  setFieldIncluded,
  setQuestion,
  uniqueName
} from './definition-ops'

function baseDefinition(): TemplateDefinition {
  return {
    kind: 'classify',
    model: { family: 'jev' },
    input: {
      fields: [
        { path: 'ticket.message', type: 'string', required: true },
        { path: 'ticket.subject', type: 'string', required: false }
      ]
    },
    state: {},
    decisions: [
      { label: 'billing', minConfidence: 0.8 },
      { label: 'support', minConfidence: 0.8 }
    ],
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

describe('uniqueName()', () => {
  it('appends _2, _3… until free', () => {
    expect(uniqueName('campo', [])).toBe('campo')
    expect(uniqueName('campo', ['campo'])).toBe('campo_2')
    expect(uniqueName('campo', ['campo', 'campo_2'])).toBe('campo_3')
  })
})

describe('move()', () => {
  it('moves an item by an offset, no-op at the edges', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('input fields', () => {
  it('addField picks a unique path and joins an explicit include list', () => {
    let def = baseDefinition()
    def = { ...def, state: { include: ['ticket.message'] } }
    def = addField(def, { path: 'ticket.message' })
    const paths = def.input.fields.map(f => f.path)
    expect(paths).toContain('ticket.message_2')
    expect(def.state.include).toContain('ticket.message_2')
  })

  it('removeField drops a stale include entry', () => {
    let def = baseDefinition()
    def = { ...def, state: { include: ['ticket.message', 'ticket.subject'] } }
    def = removeField(def, 1) // ticket.subject
    expect(def.input.fields.map(f => f.path)).toEqual(['ticket.message'])
    expect(def.state.include).toEqual(['ticket.message'])
  })

  it('moveField reorders the fields array', () => {
    const def = moveField(baseDefinition(), 0, 1)
    expect(def.input.fields.map(f => f.path)).toEqual([
      'ticket.subject',
      'ticket.message'
    ])
  })

  it('renameInputPath rewrites state.include and backticked references', () => {
    let def = baseDefinition()
    def = { ...def, state: { include: ['ticket.message'] } }
    def = renameInputPath(def, 'ticket.message', 'ticket.body')
    expect(def.input.fields[0]?.path).toBe('ticket.body')
    expect(def.state.include).toEqual(['ticket.body'])
    expect(def.questions.category?.instructions).toBe('Clasifica `ticket.body`')
  })

  it('renameInputPath rewrites input operands', () => {
    let def = baseDefinition()
    def = {
      ...def,
      preconditions: [
        {
          id: 'p1',
          when: { op: 'exists', left: { input: 'ticket.message' } },
          decision: 'billing'
        }
      ]
    }
    def = renameInputPath(def, 'ticket.message', 'ticket.body')
    const when = def.preconditions[0]?.when
    expect(when && 'op' in when ? when.left : null).toEqual({
      input: 'ticket.body'
    })
  })
})

describe('state.include', () => {
  it('includeState treats an absent include as "all"', () => {
    const state = includeState(baseDefinition())
    expect(state.all).toBe(true)
    expect(state.included.size).toBe(2)
    expect(state.extras).toEqual([])
  })

  it('setFieldIncluded narrows, then omits include again once all are back', () => {
    let def = setFieldIncluded(baseDefinition(), 'ticket.subject', false)
    expect(def.state.include).toEqual(['ticket.message'])
    def = setFieldIncluded(def, 'ticket.subject', true)
    expect(def.state.include).toBeUndefined()
  })

  it('setAllIncluded(false) sends nothing', () => {
    const def = setAllIncluded(baseDefinition(), false)
    expect(def.state.include).toEqual([])
  })

  it('setContext drops the key once the object is empty', () => {
    let def = setContext(baseDefinition(), { a: 1 })
    expect(def.state.context).toEqual({ a: 1 })
    def = setContext(def, {})
    expect(def.state.context).toBeUndefined()
  })
})

describe('questions', () => {
  it('addQuestion inserts an empty question of the right type', () => {
    const def = addQuestion(baseDefinition(), 'severidad', 'score')
    expect(def.questions.severidad?.type).toBe('score')
  })

  it('renameQuestion updates answer operands and fromAnswer/confidenceFrom', () => {
    let def = baseDefinition()
    def = {
      ...def,
      rules: [
        {
          id: 'r1',
          when: { op: 'exists', left: { answer: 'category', field: 'choice' } },
          decision: { fromAnswer: 'category' },
          confidenceFrom: 'category'
        }
      ]
    }
    def = renameQuestion(def, 'category', 'categoria')
    expect(def.questions.categoria).toBeDefined()
    expect(def.questions.category).toBeUndefined()
    const rule = def.rules[0]
    expect(rule?.confidenceFrom).toBe('categoria')
    expect(
      rule && typeof rule.decision !== 'string'
        ? rule.decision.fromAnswer
        : null
    ).toBe('categoria')
    const when = rule?.when
    expect(when && 'op' in when ? when.left : null).toEqual({
      answer: 'categoria',
      field: 'choice'
    })
  })

  it('isQuestionReferenced finds fromAnswer/confidenceFrom/answer operand uses', () => {
    let def = baseDefinition()
    expect(isQuestionReferenced(def, 'category')).toBe(true) // rules[0] fromAnswer
    def = addQuestion(def, 'extra', 'boolean')
    expect(isQuestionReferenced(def, 'extra')).toBe(false)
  })

  it('convertQuestion carries Choice options over to Score levels and back', () => {
    const choice = baseDefinition().questions.category
    if (!choice) throw new Error('missing question')
    const score = convertQuestion(choice, 'score')
    expect(score.type).toBe('score')
    expect(
      score.type === 'score' ? score.levels.map(l => l.label) : []
    ).toEqual(['billing', 'support'])
    const back = convertQuestion(score, 'choice')
    expect(back.type === 'choice' ? Object.keys(back.criteria) : []).toEqual([
      'billing',
      'support'
    ])
  })

  it('renameOption renames a Choice option and its prob() references', () => {
    let def = baseDefinition()
    def = {
      ...def,
      rules: [
        {
          id: 'r1',
          when: {
            op: 'gte',
            left: { answer: 'category', field: 'prob', option: 'billing' },
            right: { value: 0.5 }
          },
          decision: 'billing'
        }
      ]
    }
    def = renameOption(def, 'category', 'billing', 'facturacion')
    expect(
      def.questions.category?.type === 'choice'
        ? def.questions.category.criteria
        : {}
    ).toHaveProperty('facturacion')
    const when = def.rules[0]?.when
    const left = when && 'op' in when ? when.left : null
    expect(left && 'answer' in left ? left.option : null).toBe('facturacion')
  })

  it('renameLevel renames a Score level label and its references', () => {
    let def = baseDefinition()
    def = setQuestion(def, 'category', {
      type: 'score',
      instructions: 'x',
      levels: [
        { label: 'bajo', criteria: null },
        { label: 'alto', criteria: null }
      ]
    })
    def = renameLevel(def, 'category', 1, 'muy_alto')
    expect(
      def.questions.category?.type === 'score'
        ? def.questions.category.levels[1]?.label
        : null
    ).toBe('muy_alto')
  })

  it('moveQuestion reorders the questions record', () => {
    let def = addQuestion(baseDefinition(), 'second', 'boolean')
    def = moveQuestion(def, 'second', -1)
    expect(Object.keys(def.questions)).toEqual(['second', 'category'])
  })
})

describe('decisions', () => {
  it('renameLabel updates every rule and the fallback that decides it', () => {
    let def = baseDefinition()
    def = { ...def, fallback: { decision: 'billing' } }
    def = addDecision(def, { label: 'other' })
    def = {
      ...def,
      rules: [{ id: 'r1', when: { all: [] }, decision: 'billing' }]
    }
    def = renameLabel(def, 'billing', 'facturacion')
    expect(def.decisions.map(d => d.label)).toContain('facturacion')
    expect(def.fallback.decision).toBe('facturacion')
    expect(def.rules[0]?.decision).toBe('facturacion')
  })
})

describe('classify sync', () => {
  it('renameClassifyLabel keeps the linked choice option and the decision label together', () => {
    const def = renameClassifyLabel(
      baseDefinition(),
      'category',
      'billing',
      'facturacion'
    )
    expect(def.decisions.map(d => d.label)).toContain('facturacion')
    expect(
      def.questions.category?.type === 'choice'
        ? Object.keys(def.questions.category.criteria)
        : []
    ).toContain('facturacion')
  })

  it('addClassifyLabel adds both the option and the decision, sharing the threshold', () => {
    const def = addClassifyLabel(baseDefinition(), 'category', 'urgent')
    expect(def.decisions.map(d => d.label)).toContain('urgent')
    expect(def.decisions.find(d => d.label === 'urgent')?.minConfidence).toBe(
      0.8
    )
    expect(
      def.questions.category?.type === 'choice'
        ? Object.keys(def.questions.category.criteria)
        : []
    ).toContain('urgent')
  })

  it('removeClassifyLabel removes both the option and the decision', () => {
    const def = removeClassifyLabel(baseDefinition(), 'category', 'billing')
    expect(def.decisions.map(d => d.label)).not.toContain('billing')
    expect(
      def.questions.category?.type === 'choice'
        ? Object.keys(def.questions.category.criteria)
        : []
    ).not.toContain('billing')
  })
})
