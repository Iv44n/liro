import { describe, expect, it } from 'vitest'
import { signalRows, summarizeAnswer, summarizeAnswers } from './answers'

describe('summarizeAnswer()', () => {
  it('marks a question that was not asked', () => {
    expect(summarizeAnswer('urgency', null)).toEqual({
      id: 'urgency',
      asked: false
    })
  })

  it('draws one bar per option and selects the chosen one', () => {
    const summary = summarizeAnswer('category', {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.8, tech: 0.15, other: 0.05 },
      confidence: 0.7
    })

    expect(summary).toMatchObject({
      asked: true,
      type: 'choice',
      value: 'billing',
      confidence: 0.7
    })
    expect(summary.asked && summary.bars).toEqual([
      { label: 'billing', probability: 0.8, selected: true },
      { label: 'tech', probability: 0.15, selected: false },
      { label: 'other', probability: 0.05, selected: false }
    ])
  })

  it('keeps the level order of a score and its expected value', () => {
    const summary = summarizeAnswer('risk', {
      type: 'score',
      score: 1.4,
      level: 'medium',
      probabilities: { low: 0.1, medium: 0.4, high: 0.5 },
      confidence: 0.25
    })

    expect(summary).toMatchObject({ value: 'medium', score: 1.4 })
    expect(summary.asked && summary.bars.map(bar => bar.label)).toEqual([
      'low',
      'medium',
      'high'
    ])
    expect(summary.asked && summary.bars.find(bar => bar.selected)?.label).toBe(
      'medium'
    )
  })

  it('has no bars when the provider sent no probabilities', () => {
    const summary = summarizeAnswer('category', {
      type: 'choice',
      choice: 'billing',
      probabilities: null,
      confidence: null
    })

    expect(summary.asked && summary.bars).toEqual([])
  })

  it('splits a boolean into P(sí) and P(no)', () => {
    const summary = summarizeAnswer('is_spam', {
      type: 'boolean',
      probability: 0.25,
      confidence: 0.5
    })

    expect(summary).toMatchObject({ value: 'No', confidence: 0.5 })
    expect(summary.asked && summary.bars).toEqual([
      { label: 'Sí', probability: 0.25, selected: false },
      { label: 'No', probability: 0.75, selected: true }
    ])
  })
})

describe('summarizeAnswers()', () => {
  it('keeps the API order and handles missing answers', () => {
    expect(summarizeAnswers(null)).toEqual([])
    expect(
      summarizeAnswers({
        b: null,
        a: { type: 'boolean', probability: 0.9, confidence: 0.8 }
      }).map(answer => answer.id)
    ).toEqual(['b', 'a'])
  })
})

describe('signalRows()', () => {
  it('lists the signals with their values', () => {
    expect(signalRows({ risk: 0.42, trust: null })).toEqual([
      { name: 'risk', value: 0.42 },
      { name: 'trust', value: null }
    ])
    expect(signalRows(null)).toEqual([])
  })
})
