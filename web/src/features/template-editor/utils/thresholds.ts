import {
  type Condition,
  isComparison,
  type TemplateDefinition
} from '#/features/templates/types/definition'
import {
  isNoThreshold,
  isYesThreshold,
  noMinConfidence,
  YES_SPLIT,
  yesMinConfidence
} from '#/features/templates/utils/thresholds'

/**
 * Thresholds of the Classify and Decide patterns, read back from (and
 * written into) a *saved* definition — the editor-specific counterpart to
 * the wizards' `decideThresholds`/`classifyThreshold` in
 * `#/features/templates/utils/thresholds` (itself a port of the API's
 * `wizards.ts`), which this module reuses for the shared confidence math
 * instead of redefining it, so the two stay in sync.
 *
 * Decide: a boolean question's confidence is |2p − 1|, so on the `yes` side
 * `confidence ≥ 2·hi − 1` ⟺ `P(sí) ≥ hi`, and on the `no` side
 * `confidence ≥ 1 − 2·lo` ⟺ `P(sí) ≤ lo`. In between, the run goes to review
 * suggesting the more likely side.
 */

export {
  isNoThreshold,
  isYesThreshold,
  noMinConfidence,
  YES_SPLIT,
  yesMinConfidence
}

export const CLASSIFY_DEFAULT_THRESHOLD = 0.8
export const DECIDE_DEFAULT_BAND = { yes: 0.9, no: 0.1 } as const

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

/**
 * The shortest decimal threshold that maps to exactly `minConfidence` (show
 * `0.1`, not `0.09999999999999998`); failing that, the shortest within
 * 1e-12.
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

export interface DecidePattern {
  /** The boolean question both rules take their confidence from. */
  questionId: string
  /** Label of the P(sí) ≥ 0.5 rule. */
  yesLabel: string
  /** Label of the catch-all rule. */
  noLabel: string
  /** P(sí) at or above it decides `yesLabel`; `null` when the labels have no usable `minConfidence`. */
  yesThreshold: number | null
  /** P(sí) at or below it decides `noLabel`. */
  noThreshold: number | null
}

/**
 * The Decide pattern of a definition: exactly two rules, a P(sí) ≥ 0.5 rule
 * then a catch-all, both deciding (different) labels and taking the same
 * boolean question's confidence. `null` when the rules are anything else.
 * The thresholds are `null` unless both labels have a `minConfidence` that
 * maps to a valid threshold.
 */
export function decidePattern(
  definition: TemplateDefinition
): DecidePattern | null {
  const [yes, no, ...others] = definition.rules
  if (!yes || !no || others.length > 0) return null

  const questionId = yes.confidenceFrom
  if (
    questionId === undefined ||
    no.confidenceFrom !== questionId ||
    definition.questions[questionId]?.type !== 'boolean' ||
    !isYesSplit(yes.when, questionId) ||
    !isCatchAll(no.when) ||
    typeof yes.decision !== 'string' ||
    typeof no.decision !== 'string' ||
    yes.decision === no.decision
  ) {
    return null
  }

  const pattern: DecidePattern = {
    questionId,
    yesLabel: yes.decision,
    noLabel: no.decision,
    yesThreshold: null,
    noThreshold: null
  }

  const minConfidenceOf = (label: string) =>
    definition.decisions.find(decision => decision.label === label)
      ?.minConfidence
  const yesMin = minConfidenceOf(yes.decision)
  const noMin = minConfidenceOf(no.decision)
  if (yesMin === undefined || noMin === undefined) return pattern

  const yesThreshold = displayThreshold(
    (1 + yesMin) / 2,
    yesMin,
    yesMinConfidence,
    isYesThreshold
  )
  const noThreshold = displayThreshold(
    (1 - noMin) / 2,
    noMin,
    noMinConfidence,
    isNoThreshold
  )
  if (yesThreshold === null || noThreshold === null) return pattern
  return { ...pattern, yesThreshold, noThreshold }
}

/**
 * Sets the Decide band: `P(sí) ≥ yes` decides `yesLabel`, `P(sí) ≤ no`
 * decides `noLabel`. Thresholds are clamped into their valid ranges.
 */
export function setDecideBand(
  definition: TemplateDefinition,
  pattern: Pick<DecidePattern, 'yesLabel' | 'noLabel'>,
  band: { yes: number; no: number }
): TemplateDefinition {
  const yes = Math.min(1, Math.max(0.51, band.yes))
  const no = Math.max(0, Math.min(0.49, band.no))
  return {
    ...definition,
    decisions: definition.decisions.map(decision => {
      if (decision.label === pattern.yesLabel) {
        return { ...decision, minConfidence: yesMinConfidence(yes) }
      }
      if (decision.label === pattern.noLabel) {
        return { ...decision, minConfidence: noMinConfidence(no) }
      }
      return decision
    })
  }
}

/**
 * The `minConfidence` every label shares (the Classify pattern's single
 * threshold): a number when all share one, `undefined` when none has one
 * ("sin umbral"), `null` when they differ or there are no labels.
 */
export function sharedThreshold(
  definition: TemplateDefinition
): number | undefined | null {
  const [first, ...others] = definition.decisions
  if (!first) return null
  const shared = first.minConfidence
  return others.every(decision => decision.minConfidence === shared)
    ? shared
    : null
}

/** Every label gets `minConfidence` (`undefined` removes the threshold). */
export function setSharedThreshold(
  definition: TemplateDefinition,
  minConfidence: number | undefined
): TemplateDefinition {
  return {
    ...definition,
    decisions: definition.decisions.map(({ minConfidence: _, ...rest }) =>
      minConfidence === undefined ? rest : { ...rest, minConfidence }
    )
  }
}

/**
 * The Choice question whose options are the labels in a Classify
 * definition: the one a `{ fromAnswer }` rule decides from. `null` for other
 * kinds, or when no rule decides from a Choice question.
 */
export function linkedChoiceQuestion(
  definition: TemplateDefinition
): string | null {
  if (definition.kind !== 'classify') return null
  for (const rule of definition.rules) {
    if (typeof rule.decision === 'string') continue
    const id = rule.decision.fromAnswer
    if (definition.questions[id]?.type === 'choice') return id
  }
  return null
}

/** Rounds a threshold for display (two decimals, no trailing zeros). */
export const formatThreshold = (value: number): string =>
  String(Math.round(value * 100) / 100)
