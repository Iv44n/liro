import {
  type Condition,
  isComparison,
  type TemplateDefinition
} from '../types/definition'

/**
 * Confidence thresholds of the Classify and Decide wizards, mirroring
 * `api/src/modules/templates/wizards.ts`. Both wizards gate every label
 * with a `minConfidence`: below it (or without a confidence) the run goes
 * to human review, suggesting the label. The editor reuses these helpers to
 * show the same controls on a saved definition.
 */

export const CLASSIFY_DEFAULTS = {
  /** Shared by every label. */
  minConfidence: 0.8,
  questionId: 'category'
} as const

export const DECIDE_DEFAULTS = {
  /** P(sí) at or above it decides "sí". */
  yesThreshold: 0.9,
  /** P(sí) at or below it decides "no". */
  noThreshold: 0.1,
  questionId: 'answer'
} as const

export const SCORE_DEFAULTS = {
  /** Shared by every level. */
  minConfidence: 0.8,
  questionId: 'level'
} as const

/** The probability that splits the Decide wizard's two rules. */
export const YES_SPLIT = 0.5

// ── Decide bands ↔ minConfidence ─────────────────────────────────────────

// A boolean's confidence is |2p − 1|, so on the "sí" side (p ≥ 0.5)
// `confidence ≥ 2·yes − 1` ⟺ `p ≥ yes`, and on the "no" side
// `confidence ≥ 1 − 2·no` ⟺ `p ≤ no`.

/** The "sí" label's `minConfidence` for a P(sí) threshold. */
export const yesMinConfidence = (yesThreshold: number): number =>
  2 * yesThreshold - 1

/** The "no" label's `minConfidence` for a P(sí) threshold. */
export const noMinConfidence = (noThreshold: number): number =>
  1 - 2 * noThreshold

/** A valid P(sí) threshold for "sí": in (0.5, 1]. */
export const isYesThreshold = (value: unknown): value is number =>
  typeof value === 'number' && value > YES_SPLIT && value <= 1

/** A valid P(sí) threshold for "no": in [0, 0.5). */
export const isNoThreshold = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value < YES_SPLIT

/**
 * The shortest decimal threshold that maps to exactly `minConfidence` (show
 * `0.1`, not `0.09999999999999998`); failing that, the shortest one within
 * 1e-12. `null` when none is valid.
 */
function displayThreshold(
  threshold: number,
  minConfidence: number,
  toMinConfidence: (threshold: number) => number,
  isValid: (threshold: number) => boolean
): number | null {
  const candidates = Array.from({ length: 17 }, (_, index) =>
    Number(threshold.toPrecision(index + 1))
  ).filter(isValid)
  return (
    candidates.find(
      candidate => toMinConfidence(candidate) === minConfidence
    ) ??
    candidates.find(
      candidate => Math.abs(toMinConfidence(candidate) - minConfidence) < 1e-12
    ) ??
    null
  )
}

/** The P(sí) threshold for "sí" a `minConfidence` stands for (`null` if invalid). */
export const yesThresholdFrom = (minConfidence: number): number | null =>
  displayThreshold(
    (1 + minConfidence) / 2,
    minConfidence,
    yesMinConfidence,
    isYesThreshold
  )

/** The P(sí) threshold for "no" a `minConfidence` stands for (`null` if invalid). */
export const noThresholdFrom = (minConfidence: number): number | null =>
  displayThreshold(
    (1 - minConfidence) / 2,
    minConfidence,
    noMinConfidence,
    isNoThreshold
  )

function isYesSplit(condition: Condition, questionId: string): boolean {
  if (!isComparison(condition) || condition.op !== 'gte') return false
  const { left, right } = condition
  return (
    'answer' in left &&
    left.answer === questionId &&
    left.field === 'probability' &&
    right !== undefined &&
    !Array.isArray(right) &&
    'value' in right &&
    right.value === YES_SPLIT
  )
}

const isCatchAll = (condition: Condition) =>
  'all' in condition && condition.all.length === 0

export interface DecideThresholds {
  yesThreshold: number
  noThreshold: number
  /** The labels the two rules decide. */
  yesLabel: string
  noLabel: string
  /** The boolean question both rules take their confidence from. */
  questionId: string
}

/**
 * The Decide wizard's bands read back from a definition (mirror of the
 * API's `decideThresholds`); `null` unless its rules are exactly the
 * wizard's two (a P(sí) ≥ 0.5 rule, then a catch-all, both taking the same
 * boolean question's confidence) and both labels have a `minConfidence`
 * that maps to a valid threshold.
 */
export function decideThresholds(
  definition: TemplateDefinition
): DecideThresholds | null {
  const [yes, no, ...others] = definition.rules
  if (!yes || !no || others.length > 0) return null

  const questionId = yes.confidenceFrom
  if (
    questionId === undefined ||
    no.confidenceFrom !== questionId ||
    !Object.hasOwn(definition.questions, questionId) ||
    definition.questions[questionId]?.type !== 'boolean' ||
    !isYesSplit(yes.when, questionId) ||
    !isCatchAll(no.when) ||
    typeof yes.decision !== 'string' ||
    typeof no.decision !== 'string' ||
    yes.decision === no.decision
  ) {
    return null
  }

  const minConfidenceOf = (label: string) =>
    definition.decisions.find(decision => decision.label === label)
      ?.minConfidence
  const yesMin = minConfidenceOf(yes.decision)
  const noMin = minConfidenceOf(no.decision)
  if (yesMin === undefined || noMin === undefined) return null

  const yesThreshold = yesThresholdFrom(yesMin)
  const noThreshold = noThresholdFrom(noMin)
  if (yesThreshold === null || noThreshold === null) return null
  return {
    yesThreshold,
    noThreshold,
    yesLabel: yes.decision,
    noLabel: no.decision,
    questionId
  }
}

/**
 * The `minConfidence` every label shares (the Classify wizard's single
 * threshold); `null` if there are no labels, one has none, or they differ.
 */
export function classifyThreshold(
  definition: TemplateDefinition
): number | null {
  const [first, ...others] = definition.decisions
  const shared = first?.minConfidence
  if (shared === undefined) return null
  return others.every(decision => decision.minConfidence === shared)
    ? shared
    : null
}

// ── Sliders (whole percentages) ──────────────────────────────────────────

/** The Decide bands as the slider holds them: whole percentages of P(sí). */
export interface PercentBands {
  /** P(sí) ≤ this → "no". 0..49. */
  no: number
  /** P(sí) ≥ this → "sí". 51..100. */
  yes: number
}

export const BAND_LIMITS = {
  no: { min: 0, max: 49 },
  yes: { min: 51, max: 100 }
} as const

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)))

/** Slider values `[no, yes]` kept on their side of 50 %. */
export function clampBands(values: readonly number[]): PercentBands {
  const [no = BAND_LIMITS.no.min, yes = BAND_LIMITS.yes.max] = values
  return {
    no: clamp(no, BAND_LIMITS.no.min, BAND_LIMITS.no.max),
    yes: clamp(yes, BAND_LIMITS.yes.min, BAND_LIMITS.yes.max)
  }
}

/** A fraction in [0, 1] as a whole percentage (`0.8` → `80`). */
export const toPercent = (fraction: number): number =>
  Math.round(fraction * 100)

/** A whole percentage as a fraction (`80` → `0.8`). */
export const fromPercent = (percent: number): number => percent / 100

const percentFormat = new Intl.NumberFormat('es', {
  style: 'percent',
  maximumFractionDigits: 0
})

/** A percentage for display (`80` → `80 %`). */
export const formatPercent = (percent: number): string =>
  percentFormat.format(percent / 100)
