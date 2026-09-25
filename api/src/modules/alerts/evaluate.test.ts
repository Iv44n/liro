import { describe, expect, test } from 'bun:test'
import { ALERT_METRICS } from './alerts.schemas'
import { evaluateAlert, type MetricSample } from './evaluate'

describe('evaluateAlert — review_rate', () => {
  test('below threshold does not trigger', () => {
    const result = evaluateAlert({
      sample: {
        metric: 'review_rate',
        succeededRuns: 100,
        needsReviewRuns: 10
      },
      threshold: 0.2,
      minRuns: 20
    })
    expect(result.value).toBe(0.1)
    expect(result.sampleSize).toBe(100)
    expect(result.skipped).toBeNull()
    expect(result.triggered).toBe(false)
  })

  test('at the threshold triggers (>=, not >)', () => {
    const result = evaluateAlert({
      sample: {
        metric: 'review_rate',
        succeededRuns: 100,
        needsReviewRuns: 20
      },
      threshold: 0.2,
      minRuns: 20
    })
    expect(result.value).toBe(0.2)
    expect(result.triggered).toBe(true)
  })

  test('above threshold triggers', () => {
    const result = evaluateAlert({
      sample: {
        metric: 'review_rate',
        succeededRuns: 100,
        needsReviewRuns: 50
      },
      threshold: 0.2,
      minRuns: 20
    })
    expect(result.triggered).toBe(true)
  })

  test('sample smaller than minRuns is skipped, even past the threshold', () => {
    const result = evaluateAlert({
      sample: { metric: 'review_rate', succeededRuns: 19, needsReviewRuns: 19 },
      threshold: 0.2,
      minRuns: 20
    })
    expect(result.value).toBeCloseTo(1)
    expect(result.skipped).toBe('insufficient_sample')
    expect(result.triggered).toBe(false)
  })

  test('sample exactly at minRuns is judged, not skipped (>=, not >)', () => {
    const result = evaluateAlert({
      sample: { metric: 'review_rate', succeededRuns: 20, needsReviewRuns: 0 },
      threshold: 0.2,
      minRuns: 20
    })
    expect(result.skipped).toBeNull()
    expect(result.triggered).toBe(false)
  })

  test('zero succeeded runs never divides by zero (value 0, skipped when minRuns > 0)', () => {
    const result = evaluateAlert({
      sample: { metric: 'review_rate', succeededRuns: 0, needsReviewRuns: 0 },
      threshold: 0.2,
      minRuns: 20
    })
    expect(result.value).toBe(0)
    expect(result.skipped).toBe('insufficient_sample')
    expect(result.triggered).toBe(false)
  })

  test('minRuns: 0 never skips, even with an empty sample', () => {
    const result = evaluateAlert({
      sample: { metric: 'review_rate', succeededRuns: 0, needsReviewRuns: 0 },
      threshold: 0.2,
      minRuns: 0
    })
    expect(result.skipped).toBeNull()
    expect(result.triggered).toBe(false)
  })
})

describe('evaluateAlert — failure_rate', () => {
  test('computed over totalRuns, not succeededRuns', () => {
    const result = evaluateAlert({
      sample: { metric: 'failure_rate', totalRuns: 50, failedRuns: 5 },
      threshold: 0.1,
      minRuns: 20
    })
    expect(result.value).toBe(0.1)
    expect(result.sampleSize).toBe(50)
    expect(result.triggered).toBe(true)
  })

  test('below minRuns is skipped', () => {
    const result = evaluateAlert({
      sample: { metric: 'failure_rate', totalRuns: 5, failedRuns: 5 },
      threshold: 0.1,
      minRuns: 20
    })
    expect(result.skipped).toBe('insufficient_sample')
    expect(result.triggered).toBe(false)
  })

  test('below threshold does not trigger', () => {
    const result = evaluateAlert({
      sample: { metric: 'failure_rate', totalRuns: 100, failedRuns: 1 },
      threshold: 0.1,
      minRuns: 20
    })
    expect(result.triggered).toBe(false)
  })
})

describe('evaluateAlert — jev_errors', () => {
  test('is a plain count, not gated by minRuns', () => {
    const result = evaluateAlert({
      sample: { metric: 'jev_errors', errorCount: 3 },
      threshold: 5,
      minRuns: 1000
    })
    expect(result.value).toBe(3)
    expect(result.sampleSize).toBeNull()
    expect(result.skipped).toBeNull()
    expect(result.triggered).toBe(false)
  })

  test('at the threshold triggers (>=, not >)', () => {
    const result = evaluateAlert({
      sample: { metric: 'jev_errors', errorCount: 5 },
      threshold: 5,
      minRuns: 0
    })
    expect(result.triggered).toBe(true)
  })

  test('zero errors never triggers a positive threshold', () => {
    const result = evaluateAlert({
      sample: { metric: 'jev_errors', errorCount: 0 },
      threshold: 1,
      minRuns: 0
    })
    expect(result.triggered).toBe(false)
  })
})

describe('evaluateAlert — endpoint_failing', () => {
  test('is a plain count, not gated by minRuns', () => {
    const result = evaluateAlert({
      sample: { metric: 'endpoint_failing', maxConsecutiveFailures: 2 },
      threshold: 3,
      minRuns: 1000
    })
    expect(result.value).toBe(2)
    expect(result.sampleSize).toBeNull()
    expect(result.triggered).toBe(false)
  })

  test('at the threshold triggers (>=, not >)', () => {
    const result = evaluateAlert({
      sample: { metric: 'endpoint_failing', maxConsecutiveFailures: 3 },
      threshold: 3,
      minRuns: 0
    })
    expect(result.triggered).toBe(true)
  })

  test('above the threshold triggers', () => {
    const result = evaluateAlert({
      sample: { metric: 'endpoint_failing', maxConsecutiveFailures: 10 },
      threshold: 3,
      minRuns: 0
    })
    expect(result.triggered).toBe(true)
  })
})

describe('MetricSample — every ALERT_METRICS entry has a matching sample shape', () => {
  test('every metric is exercised by evaluateAlert without throwing', () => {
    const samples: Record<MetricSample['metric'], MetricSample> = {
      review_rate: {
        metric: 'review_rate',
        succeededRuns: 10,
        needsReviewRuns: 1
      },
      failure_rate: { metric: 'failure_rate', totalRuns: 10, failedRuns: 1 },
      jev_errors: { metric: 'jev_errors', errorCount: 1 },
      endpoint_failing: {
        metric: 'endpoint_failing',
        maxConsecutiveFailures: 1
      }
    }
    // Fails to compile (and, if that were bypassed, fails at runtime) the
    // moment `ALERT_METRICS` gains or loses an entry without a matching
    // `MetricSample` variant — the two are meant to move together.
    for (const metric of ALERT_METRICS) {
      expect(() =>
        evaluateAlert({ sample: samples[metric], threshold: 0, minRuns: 0 })
      ).not.toThrow()
    }
  })
})
