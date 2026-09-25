import { describe, expect, it } from 'vitest'
import type { TemplateDefinition } from '../types/definition'
import {
  clampBands,
  classifyThreshold,
  decideThresholds,
  formatPercent,
  fromPercent,
  noMinConfidence,
  noThresholdFrom,
  toPercent,
  yesMinConfidence,
  yesThresholdFrom
} from './thresholds'

/** What the API's Decide wizard builds (defaults: 0.9 / 0.1). */
function decideDefinition(yes = 0.9, no = 0.1): TemplateDefinition {
  return {
    kind: 'decide',
    model: { family: 'jev' },
    input: {
      fields: [{ path: 'text', type: 'string', required: true }]
    },
    state: {},
    decisions: [
      { label: 'approve', minConfidence: yesMinConfidence(yes) },
      { label: 'reject', minConfidence: noMinConfidence(no) }
    ],
    preconditions: [],
    questions: {
      answer: { type: 'boolean', instructions: '¿Aprobar?' }
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

describe('Decide band mapping', () => {
  it('maps thresholds to minConfidence and back without float noise', () => {
    expect(yesMinConfidence(0.9)).toBeCloseTo(0.8)
    expect(noMinConfidence(0.1)).toBeCloseTo(0.8)
    expect(yesThresholdFrom(yesMinConfidence(0.9))).toBe(0.9)
    expect(noThresholdFrom(noMinConfidence(0.1))).toBe(0.1)
    expect(yesThresholdFrom(yesMinConfidence(0.77))).toBe(0.77)
    expect(noThresholdFrom(noMinConfidence(0.03))).toBe(0.03)
  })

  it('rejects minConfidence values outside the bands', () => {
    // minConfidence 0 ⟺ threshold 0.5, which neither band includes.
    expect(yesThresholdFrom(0)).toBeNull()
    expect(noThresholdFrom(0)).toBeNull()
    expect(yesThresholdFrom(1)).toBe(1)
    expect(noThresholdFrom(1)).toBe(0)
  })
})

describe('decideThresholds()', () => {
  it("reads the wizard's bands back", () => {
    expect(decideThresholds(decideDefinition(0.85, 0.2))).toEqual({
      yesThreshold: 0.85,
      noThreshold: 0.2,
      yesLabel: 'approve',
      noLabel: 'reject',
      questionId: 'answer'
    })
  })

  it('returns null once the rules are no longer the wizard ones', () => {
    const extraRule = decideDefinition()
    extraRule.rules.push({ id: 'x', when: { all: [] }, decision: 'approve' })
    expect(decideThresholds(extraRule)).toBeNull()

    const otherSplit = decideDefinition()
    otherSplit.rules[0] = {
      ...otherSplit.rules[0],
      id: 'yes',
      decision: 'approve',
      when: {
        op: 'gte',
        left: { answer: 'answer', field: 'probability' },
        right: { value: 0.6 }
      }
    }
    expect(decideThresholds(otherSplit)).toBeNull()

    const noMin = decideDefinition()
    noMin.decisions[1] = { label: 'reject' }
    expect(decideThresholds(noMin)).toBeNull()
  })
})

describe('classifyThreshold()', () => {
  const withMins = (...mins: (number | undefined)[]) =>
    ({
      ...decideDefinition(),
      kind: 'classify',
      decisions: mins.map((minConfidence, index) => ({
        label: `l${index}`,
        ...(minConfidence === undefined ? {} : { minConfidence })
      }))
    }) satisfies TemplateDefinition

  it('returns the shared minConfidence', () => {
    expect(classifyThreshold(withMins(0.8, 0.8, 0.8))).toBe(0.8)
  })

  it('returns null when labels differ, lack one or do not exist', () => {
    expect(classifyThreshold(withMins(0.8, 0.7))).toBeNull()
    expect(classifyThreshold(withMins(0.8, undefined))).toBeNull()
    expect(classifyThreshold(withMins())).toBeNull()
  })
})

describe('slider helpers', () => {
  it('keeps each band on its side of 50 %', () => {
    expect(clampBands([10, 90])).toEqual({ no: 10, yes: 90 })
    expect(clampBands([60, 55])).toEqual({ no: 49, yes: 55 })
    expect(clampBands([-5, 40])).toEqual({ no: 0, yes: 51 })
    expect(clampBands([12.4, 130])).toEqual({ no: 12, yes: 100 })
  })

  it('converts between fractions and whole percentages', () => {
    expect(toPercent(0.8)).toBe(80)
    expect(toPercent(0.07)).toBe(7)
    expect(fromPercent(90)).toBe(0.9)
    expect(fromPercent(7)).toBe(0.07)
  })

  it('formats percentages in Spanish', () => {
    expect(formatPercent(80).replace(/\s/g, ' ')).toBe('80 %')
  })
})
