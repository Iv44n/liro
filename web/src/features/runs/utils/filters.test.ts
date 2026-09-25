import { describe, expect, it } from 'vitest'
import {
  countActiveFilters,
  DEFAULT_RUN_FILTERS,
  decisionFilterOptions,
  periodStart,
  toListRunsParams
} from './filters'
import { decisionOutcome, decisionText } from './labels'

describe('periodStart()', () => {
  const now = Date.parse('2026-09-23T12:34:56.789Z')

  it('is undefined for the whole history', () => {
    expect(periodStart('all', now)).toBeUndefined()
  })

  it('goes back the period, rounded down to the minute', () => {
    expect(periodStart('24h', now)).toBe('2026-09-22T12:34:00.000Z')
    expect(periodStart('7d', now)).toBe('2026-09-16T12:34:00.000Z')
    expect(periodStart('30d', now)).toBe('2026-08-24T12:34:00.000Z')
  })
})

describe('toListRunsParams()', () => {
  it('sends nothing for the defaults', () => {
    expect(toListRunsParams(DEFAULT_RUN_FILTERS)).toEqual({})
  })

  it('maps every set filter and the page position', () => {
    expect(
      toListRunsParams(
        {
          templateId: 'tpl_1',
          decision: 'needs_review',
          mode: 'test',
          source: 'api',
          status: 'failed',
          reviewStatus: 'pending',
          period: '24h'
        },
        { cursor: 'run_9', from: '2026-09-22T12:00:00.000Z', limit: 20 }
      )
    ).toEqual({
      templateId: 'tpl_1',
      decision: 'needs_review',
      mode: 'test',
      source: 'api',
      status: 'failed',
      reviewStatus: 'pending',
      from: '2026-09-22T12:00:00.000Z',
      cursor: 'run_9',
      limit: 20
    })
  })
})

describe('countActiveFilters()', () => {
  it('counts what differs from the defaults', () => {
    expect(countActiveFilters(DEFAULT_RUN_FILTERS)).toBe(0)
    expect(
      countActiveFilters({
        ...DEFAULT_RUN_FILTERS,
        mode: 'live',
        period: '7d'
      })
    ).toBe(2)
  })
})

describe('decisionFilterOptions()', () => {
  it('puts needs_review first and removes duplicates', () => {
    expect(
      decisionFilterOptions({
        needsReview: 'needs_review',
        labels: ['approve', 'reject'],
        seen: ['reject', null, 'needs_review', 'legacy'],
        current: 'manual'
      })
    ).toEqual(['needs_review', 'approve', 'reject', 'legacy', 'manual'])
  })
})

describe('decisionOutcome()', () => {
  it('shows a single decision when nothing changed', () => {
    expect(
      decisionOutcome({ decision: 'spam', finalDecision: 'spam' })
    ).toEqual({ decision: 'spam', finalDecision: null, awaitingReview: false })
  })

  it('shows the reviewer decision after a review', () => {
    expect(
      decisionOutcome({ decision: 'needs_review', finalDecision: 'ham' })
    ).toEqual({
      decision: 'needs_review',
      finalDecision: 'ham',
      awaitingReview: false
    })
  })

  it('flags a run still waiting for a human', () => {
    expect(
      decisionOutcome({ decision: 'needs_review', finalDecision: null })
    ).toEqual({
      decision: 'needs_review',
      finalDecision: null,
      awaitingReview: true
    })
  })
})

describe('decisionText()', () => {
  it('names needs_review in Spanish', () => {
    expect(decisionText('needs_review')).toBe('Revisión humana')
    expect(decisionText('approve')).toBe('approve')
    expect(decisionText(null)).toBe('Sin decisión')
  })
})
