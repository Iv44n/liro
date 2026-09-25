import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import {
  decidePattern,
  linkedChoiceQuestion,
  noMinConfidence,
  setDecideBand,
  setSharedThreshold,
  sharedThreshold,
  yesMinConfidence
} from './thresholds'

function decideDefinition(yes = 0.9, no = 0.1): TemplateDefinition {
  return {
    kind: 'decide',
    model: { family: 'jev' },
    input: { fields: [{ path: 'text', type: 'string', required: true }] },
    state: {},
    decisions: [
      { label: 'approve', minConfidence: yesMinConfidence(yes) },
      { label: 'reject', minConfidence: noMinConfidence(no) }
    ],
    preconditions: [],
    questions: { answer: { type: 'boolean', instructions: '¿Aprobar?' } },
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
        decision: 'approve',
        confidenceFrom: 'answer'
      },
      {
        id: 'no',
        when: { all: [] },
        decision: 'reject',
        confidenceFrom: 'answer'
      }
    ],
    fallback: { decision: 'needs_review' }
  }
}

function classifyDefinition(mins: (number | undefined)[]): TemplateDefinition {
  return {
    kind: 'classify',
    model: { family: 'jev' },
    input: { fields: [] },
    state: {},
    decisions: mins.map((minConfidence, index) => ({
      label: `l${index}`,
      ...(minConfidence === undefined ? {} : { minConfidence })
    })),
    preconditions: [],
    questions: {
      category: {
        type: 'choice',
        instructions: 'x',
        criteria: Object.fromEntries(
          mins.map((_, index) => [`l${index}`, null])
        )
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

describe('decidePattern()', () => {
  it("reads the wizard's rules and thresholds back", () => {
    const pattern = decidePattern(decideDefinition(0.85, 0.2))
    expect(pattern).toEqual({
      questionId: 'answer',
      yesLabel: 'approve',
      noLabel: 'reject',
      yesThreshold: 0.85,
      noThreshold: 0.2
    })
  })

  it('still names the labels when a minConfidence is missing, with null thresholds', () => {
    const def = decideDefinition()
    def.decisions[0] = { label: 'approve' }
    const pattern = decidePattern(def)
    expect(pattern?.yesLabel).toBe('approve')
    expect(pattern?.yesThreshold).toBeNull()
  })

  it('returns null once the rules are not the two-rule pattern', () => {
    const def = decideDefinition()
    def.rules.push({ id: 'extra', when: { all: [] }, decision: 'approve' })
    expect(decidePattern(def)).toBeNull()
  })
})

describe('setDecideBand()', () => {
  it('sets minConfidence for both labels, clamping to valid bands', () => {
    const def = setDecideBand(
      decideDefinition(),
      { yesLabel: 'approve', noLabel: 'reject' },
      { yes: 0.95, no: 0.05 }
    )
    expect(
      def.decisions.find(d => d.label === 'approve')?.minConfidence
    ).toBeCloseTo(yesMinConfidence(0.95))
    expect(
      def.decisions.find(d => d.label === 'reject')?.minConfidence
    ).toBeCloseTo(noMinConfidence(0.05))
  })

  it('clamps out-of-range bands into (0.5, 1] / [0, 0.5)', () => {
    const def = setDecideBand(
      decideDefinition(),
      { yesLabel: 'approve', noLabel: 'reject' },
      { yes: 0.3, no: 0.8 }
    )
    expect(
      def.decisions.find(d => d.label === 'approve')?.minConfidence
    ).toBeCloseTo(yesMinConfidence(0.51))
    expect(
      def.decisions.find(d => d.label === 'reject')?.minConfidence
    ).toBeCloseTo(noMinConfidence(0.49))
  })
})

describe('sharedThreshold() / setSharedThreshold()', () => {
  it('reads the threshold every label shares, undefined for "sin umbral"', () => {
    expect(sharedThreshold(classifyDefinition([0.8, 0.8]))).toBe(0.8)
    expect(
      sharedThreshold(classifyDefinition([undefined, undefined]))
    ).toBeUndefined()
  })

  it('returns null when labels differ or there are none', () => {
    expect(sharedThreshold(classifyDefinition([0.8, 0.7]))).toBeNull()
    expect(sharedThreshold(classifyDefinition([]))).toBeNull()
  })

  it('sets (or clears) every label at once', () => {
    let def = setSharedThreshold(classifyDefinition([0.8, 0.8]), 0.9)
    expect(def.decisions.every(d => d.minConfidence === 0.9)).toBe(true)
    def = setSharedThreshold(def, undefined)
    expect(def.decisions.every(d => d.minConfidence === undefined)).toBe(true)
  })
})

describe('linkedChoiceQuestion()', () => {
  it('finds the Choice question a fromAnswer rule decides from, classify only', () => {
    expect(linkedChoiceQuestion(classifyDefinition([0.8, 0.8]))).toBe(
      'category'
    )
    expect(linkedChoiceQuestion(decideDefinition())).toBeNull()
  })

  it('is null without a fromAnswer rule pointing at a Choice question', () => {
    const def = classifyDefinition([0.8, 0.8])
    def.rules = []
    expect(linkedChoiceQuestion(def)).toBeNull()
  })
})
