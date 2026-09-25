import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import { exampleRunResponse } from './example-response'

function baseDefinition(
  overrides: Partial<TemplateDefinition> = {}
): TemplateDefinition {
  return {
    kind: 'classify',
    model: { family: 'jev' },
    input: { fields: [] },
    state: {},
    decisions: [{ label: 'bug' }, { label: 'feature' }],
    preconditions: [],
    questions: {},
    signals: [],
    flagRules: [],
    rules: [],
    fallback: { decision: 'needs_review' },
    ...overrides
  }
}

describe('exampleRunResponse()', () => {
  it('decides the first declared label with a plausible confidence', () => {
    const response = exampleRunResponse({
      slug: 'triage',
      version: '1.0',
      definition: baseDefinition()
    })
    expect(response.template).toBe('triage')
    expect(response.version).toBe('1.0')
    expect(response.status).toBe('succeeded')
    expect(response.decision).toBe('bug')
    expect(response.finalDecision).toBe('bug')
    expect(response.suggestion).toBe('bug')
    expect(response.review).toBeNull()
    expect(response.error).toBeNull()
  })

  it('falls back to needs_review, with a null finalDecision, when there are no decisions', () => {
    const response = exampleRunResponse({
      slug: 'x',
      version: '1.0',
      definition: baseDefinition({ decisions: [] })
    })
    expect(response.decision).toBe('needs_review')
    expect(response.finalDecision).toBeNull()
    expect(response.suggestion).toBeNull()
  })

  it('answers every question with a distribution that sums to 1', () => {
    const response = exampleRunResponse({
      slug: 'x',
      version: '1.0',
      definition: baseDefinition({
        questions: {
          category: {
            type: 'choice',
            instructions: 'x',
            criteria: { bug: null, feature: null, question: null }
          },
          urgent: { type: 'boolean', instructions: 'x' },
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
      })
    })

    const category = response.answers?.category
    expect(category?.type).toBe('choice')
    if (category?.type === 'choice') {
      expect(category.choice).toBe('bug')
      const total = Object.values(category.probabilities ?? {}).reduce(
        (sum, value) => sum + value,
        0
      )
      expect(total).toBeCloseTo(1)
    }

    const urgent = response.answers?.urgent
    expect(urgent?.type).toBe('boolean')

    const severity = response.answers?.severity
    expect(severity?.type).toBe('score')
    if (severity?.type === 'score') {
      expect(severity.level).toBe('medium')
      const total = Object.values(severity.probabilities ?? {}).reduce(
        (sum, value) => sum + value,
        0
      )
      expect(total).toBeCloseTo(1)
    }
  })

  it('includes signals only when the definition declares any', () => {
    expect(
      exampleRunResponse({
        slug: 'x',
        version: '1.0',
        definition: baseDefinition()
      }).signals
    ).toEqual({})

    expect(
      exampleRunResponse({
        slug: 'x',
        version: '1.0',
        definition: baseDefinition({
          signals: [{ name: 'risk', kind: 'mean', of: [] }]
        })
      }).signals
    ).toEqual({ risk: 0.8 })
  })
})
