import type { AlertMetric } from './alerts.schemas'

/**
 * Pure per-metric evaluation: turns a pre-computed sample (the raw counts
 * `alerts.service.ts` queries for a rule's metric, over its window/scope)
 * into a value and a trigger decision. No I/O, no clock — every "window" is
 * already baked into the sample by the caller, which is what keeps this
 * testable with plain numbers.
 *
 * `review_rate`/`failure_rate` are rates gated by `minRuns` (too small a
 * sample never triggers, regardless of the rate); `jev_errors` and
 * `endpoint_failing` are plain counts, not gated by `minRuns` — see
 * `alerts.schemas.ts`'s `minRuns` doc.
 */

export type MetricSample =
  | { metric: 'review_rate'; succeededRuns: number; needsReviewRuns: number }
  | { metric: 'failure_rate'; totalRuns: number; failedRuns: number }
  | { metric: 'jev_errors'; errorCount: number }
  | { metric: 'endpoint_failing'; maxConsecutiveFailures: number }

export interface EvaluateAlertOptions {
  sample: MetricSample
  /** The rule's `threshold`. */
  threshold: number
  /** The rule's `minRuns` — only consulted for `review_rate`/`failure_rate`. */
  minRuns: number
}

export type SkipReason = 'insufficient_sample'

export interface EvaluateAlertResult {
  /** The metric's own value: a rate in `[0, 1]` for `review_rate`/`failure_rate`, a plain count otherwise. */
  value: number
  /** The sample size `minRuns` was checked against; `null` for the two count metrics, which aren't gated. */
  sampleSize: number | null
  /** Set (and `triggered: false`) when a rate metric's sample was too small to judge. */
  skipped: SkipReason | null
  triggered: boolean
}

function evaluateRate(
  sampleSize: number,
  numerator: number,
  threshold: number,
  minRuns: number
): EvaluateAlertResult {
  const value = sampleSize > 0 ? numerator / sampleSize : 0
  if (sampleSize < minRuns) {
    return {
      value,
      sampleSize,
      skipped: 'insufficient_sample',
      triggered: false
    }
  }
  return { value, sampleSize, skipped: null, triggered: value >= threshold }
}

function evaluateCount(value: number, threshold: number): EvaluateAlertResult {
  return {
    value,
    sampleSize: null,
    skipped: null,
    triggered: value >= threshold
  }
}

/**
 * `sample.metric` decides how `value` is computed and whether `minRuns`
 * applies; `triggered` is `value >= threshold` once the sample is large
 * enough to judge (rate metrics only — see the module doc).
 */
export function evaluateAlert(
  options: EvaluateAlertOptions
): EvaluateAlertResult {
  const { sample, threshold, minRuns } = options
  switch (sample.metric) {
    case 'review_rate':
      return evaluateRate(
        sample.succeededRuns,
        sample.needsReviewRuns,
        threshold,
        minRuns
      )
    case 'failure_rate':
      return evaluateRate(
        sample.totalRuns,
        sample.failedRuns,
        threshold,
        minRuns
      )
    case 'jev_errors':
      return evaluateCount(sample.errorCount, threshold)
    case 'endpoint_failing':
      return evaluateCount(sample.maxConsecutiveFailures, threshold)
  }
}

/** Every metric a `MetricSample`'s `metric` discriminant can be — kept in sync with `alerts.schemas.ts`'s `ALERT_METRICS` by `evaluate.test.ts`. */
export type { AlertMetric }
