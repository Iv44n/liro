import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import type { PublicAnswers } from '#/sdk/modules/runs/types'
import {
  answerViews,
  clamp01,
  describeStage,
  formatLatency,
  formatPercent,
  isNeedsReview
} from './format'

const NBSP = ' '

describe('formatPercent()', () => {
  it('formats a 0..1 ratio and shows a dash otherwise', () => {
    expect(formatPercent(0.934)).toBe(`93,4${NBSP}%`)
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(undefined)).toBe('—')
  })
})

describe('formatLatency()', () => {
  it('shows ms under a second and seconds above', () => {
    expect(formatLatency(840)).toBe('840 ms')
    expect(formatLatency(1530)).toBe('1,53 s')
    expect(formatLatency(null)).toBe('—')
  })
})

describe('clamp01()', () => {
  it('clamps to [0, 1] and treats a non-finite value as 0', () => {
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('isNeedsReview()', () => {
  it('matches only the reserved label', () => {
    expect(isNeedsReview('needs_review')).toBe(true)
    expect(isNeedsReview('approve')).toBe(false)
    expect(isNeedsReview(null)).toBe(false)
  })
})

function definitionWith(
  overrides: Partial<
    Pick<TemplateDefinition, 'preconditions' | 'rules' | 'questions'>
  >
): Pick<TemplateDefinition, 'preconditions' | 'rules' | 'questions'> {
  return { preconditions: [], rules: [], questions: {}, ...overrides }
}

describe('describeStage()', () => {
  it('reports the fallback when no rule decided', () => {
    expect(describeStage(null, definitionWith({}))).toEqual({
      stage: 'fallback',
      ruleId: null,
      ruleName: null,
      label: 'Fallback (ninguna regla coincidió)'
    })
  })

  it('finds a matching precondition by position', () => {
    const definition = definitionWith({
      preconditions: [
        { id: 'p1', when: { all: [] }, decision: 'x' },
        { id: 'p2', name: 'Segunda', when: { all: [] }, decision: 'y' }
      ]
    })
    expect(describeStage('p2', definition)).toEqual({
      stage: 'precondition',
      ruleId: 'p2',
      ruleName: 'Segunda',
      label: 'Precondición n.º 2'
    })
  })

  it('finds a matching rule by position, else reports an unnamed rule', () => {
    const definition = definitionWith({
      rules: [{ id: 'r1', when: { all: [] }, decision: 'x' }]
    })
    expect(describeStage('r1', definition)).toEqual({
      stage: 'rule',
      ruleId: 'r1',
      ruleName: null,
      label: 'Regla n.º 1'
    })
    expect(describeStage('gone', definition)).toEqual({
      stage: 'rule',
      ruleId: 'gone',
      ruleName: null,
      label: 'Regla'
    })
  })
})

describe('answerViews()', () => {
  it('returns an empty list without answers', () => {
    expect(answerViews(null, { questions: {} })).toEqual([])
  })

  it('orders answers by the definition, then extras, and marks unasked questions', () => {
    const definition: Pick<TemplateDefinition, 'questions'> = {
      questions: {
        category: {
          type: 'choice',
          instructions: 'x',
          criteria: { bug: null, feature: null }
        },
        urgent: { type: 'boolean', instructions: 'x' }
      }
    }
    const answers: PublicAnswers = {
      category: {
        type: 'choice',
        choice: 'bug',
        probabilities: { bug: 0.9, feature: 0.1 },
        confidence: 0.8
      },
      urgent: null,
      extra: { type: 'boolean', probability: 0.6, confidence: 0.2 }
    }

    const views = answerViews(answers, definition)
    expect(views.map(view => view.id)).toEqual(['category', 'urgent', 'extra'])

    const category = views[0]
    expect(category?.summary).toBe('bug')
    expect(category?.rows).toEqual([
      { label: 'bug', probability: 0.9, selected: true },
      { label: 'feature', probability: 0.1, selected: false }
    ])

    const urgent = views[1]
    expect(urgent?.answer).toBeNull()
    expect(urgent?.summary).toBe('No se preguntó')
    expect(urgent?.type).toBe('boolean')

    const extra = views[2]
    expect(extra?.type).toBe('boolean')
    expect(extra?.rows.map(row => row.label)).toEqual(['Sí', 'No'])
  })

  it('summarizes a score answer with its position among the levels', () => {
    const definition: Pick<TemplateDefinition, 'questions'> = {
      questions: {
        severity: {
          type: 'score',
          instructions: 'x',
          levels: [
            { label: 'low', criteria: null },
            { label: 'medium', criteria: null },
            { label: 'high', criteria: null }
          ]
        }
      }
    }
    const answers: PublicAnswers = {
      severity: {
        type: 'score',
        score: 1,
        level: 'medium',
        probabilities: { low: 0.1, medium: 0.8, high: 0.1 },
        confidence: 0.7
      }
    }
    const [view] = answerViews(answers, definition)
    expect(view?.summary).toBe('medium (1 de 2)')
    expect(view?.rows.map(row => row.label)).toEqual(['low', 'medium', 'high'])
  })
})
