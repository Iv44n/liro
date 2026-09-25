import type { EntryType } from '#modules/engine/evaluator/port'
import {
  type Condition,
  type DecisionDef,
  type InputField,
  isComparison,
  NEEDS_REVIEW,
  type TemplateDefinition,
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from './definition'

/**
 * The Classify, Decide and Score wizards. All three produce complete
 * definitions with the "always-match rule + per-label `minConfidence`"
 * pattern: a rule always proposes the model's answer and the label's
 * `minConfidence` gates it. So a low-confidence run goes to review WITH the
 * model's answer as the suggestion, and a run without probabilities
 * (confidence `null`) always goes to review — the wizards never auto-decide
 * without evidence.
 *
 * They throw a `RangeError` for out-of-range thresholds and let
 * `templateDefinitionSchema` throw (a `ZodError`) for invalid names; the
 * semantic checks (duplicate labels, option/level counts…) are left to
 * `lint.ts`, like for any other draft.
 */

/** A decision label as a wizard collects it. */
export interface WizardLabel {
  label: string
  /** Shown to callers and reviewers; sent to Jev when there are no `criteria`. */
  description?: string
  /** What Jev reads for this outcome (defaults to `description`). */
  criteria?: EntryType | null
}

export interface ClassifyWizardInput {
  fields?: InputField[]
  instructions: EntryType
  /** One Choice option and one decision per label, in this order. */
  labels: WizardLabel[]
  /** Shared by every label (default 0.8). */
  minConfidence?: number
  /** Id of the Choice question (default `category`). */
  questionId?: string
}

export interface DecideWizardInput {
  fields?: InputField[]
  instructions: EntryType
  yes: WizardLabel
  no: WizardLabel
  /** P(yes) at or above it decides `yes` (default 0.9), in (0.5, 1]. */
  yesThreshold?: number
  /** P(yes) at or below it decides `no` (default 0.1), in [0, 0.5). */
  noThreshold?: number
  /** Id of the boolean question (default `answer`). */
  questionId?: string
}

export interface ScoreWizardInput {
  fields?: InputField[]
  instructions: EntryType
  /** Ordered lowest first (2..10 once linted; the wizard itself doesn't check). */
  levels: WizardLabel[]
  /** Shared by every level (default 0.8). */
  minConfidence?: number
  /** Id of the Score question (default `level`). */
  questionId?: string
}

export const CLASSIFY_DEFAULTS = {
  minConfidence: 0.8,
  questionId: 'category'
} as const

export const DECIDE_DEFAULTS = {
  yesThreshold: 0.9,
  noThreshold: 0.1,
  questionId: 'answer'
} as const

export const SCORE_DEFAULTS = {
  minConfidence: 0.8,
  questionId: 'level'
} as const

/** The probability that splits the Decide wizard's two rules. */
const YES_SPLIT = 0.5

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

const isUnitInterval = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1

const isBlank = (value: unknown) =>
  typeof value === 'string' && value.trim() === ''

/** `criteria ?? description ?? null`, treating blank strings as absent. */
function labelCriteria({ criteria, description }: WizardLabel) {
  if (criteria !== undefined && criteria !== null && !isBlank(criteria)) {
    return criteria
  }
  return hasText(description) ? description : null
}

function labelDecision(
  { label, description }: WizardLabel,
  minConfidence: number
): DecisionDef {
  return {
    label,
    ...(hasText(description) ? { description } : {}),
    minConfidence
  }
}

const textField = (description: string): InputField[] => [
  { path: 'text', type: 'string', required: true, description }
]

/** Parsing applies the schema defaults and copies every caller-owned value. */
const complete = (definition: TemplateDefinitionInput): TemplateDefinition =>
  templateDefinitionSchema.parse(definition)

/**
 * A Classify definition: one Choice question whose options are the labels,
 * one catch-all rule deciding the chosen option, and the same
 * `minConfidence` on every label.
 */
export function classifyDefinition(
  input: ClassifyWizardInput
): TemplateDefinition {
  const minConfidence = input.minConfidence ?? CLASSIFY_DEFAULTS.minConfidence
  if (!isUnitInterval(minConfidence)) {
    throw new RangeError(
      `minConfidence must be between 0 and 1 (got ${minConfidence})`
    )
  }
  const questionId = input.questionId ?? CLASSIFY_DEFAULTS.questionId

  return complete({
    kind: 'classify',
    input: { fields: input.fields ?? textField('The text to classify') },
    decisions: input.labels.map(label => labelDecision(label, minConfidence)),
    questions: {
      [questionId]: {
        type: 'choice',
        instructions: input.instructions,
        criteria: Object.fromEntries(
          input.labels.map(label => [label.label, labelCriteria(label)])
        )
      }
    },
    rules: [
      {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: questionId }
      }
    ],
    fallback: { decision: NEEDS_REVIEW }
  })
}

/**
 * A Score definition: one Score question whose levels are the labels (lowest
 * first), one catch-all rule deciding the most probable level, and the same
 * `minConfidence` on every label — the Classify wizard's pattern, for an
 * ordered scale instead of unordered options.
 */
export function scoreDefinition(input: ScoreWizardInput): TemplateDefinition {
  const minConfidence = input.minConfidence ?? SCORE_DEFAULTS.minConfidence
  if (!isUnitInterval(minConfidence)) {
    throw new RangeError(
      `minConfidence must be between 0 and 1 (got ${minConfidence})`
    )
  }
  const questionId = input.questionId ?? SCORE_DEFAULTS.questionId

  return complete({
    kind: 'score',
    input: { fields: input.fields ?? textField('The text to score') },
    decisions: input.levels.map(level => labelDecision(level, minConfidence)),
    questions: {
      [questionId]: {
        type: 'score',
        instructions: input.instructions,
        levels: input.levels.map(level => ({
          label: level.label,
          criteria: labelCriteria(level)
        }))
      }
    },
    rules: [
      {
        id: 'score',
        when: { all: [] },
        decision: { fromAnswer: questionId }
      }
    ],
    fallback: { decision: NEEDS_REVIEW }
  })
}

// A boolean's confidence is |2p − 1|, so on the `yes` side (p ≥ 0.5)
// `confidence ≥ 2·yesThreshold − 1` ⟺ `p ≥ yesThreshold`, and on the `no`
// side `confidence ≥ 1 − 2·noThreshold` ⟺ `p ≤ noThreshold`. The values are
// deliberately not rounded: computed the same way as the engine computes the
// confidence, a probability exactly at the threshold still decides.
const yesMinConfidence = (threshold: number) => 2 * threshold - 1
const noMinConfidence = (threshold: number) => 1 - 2 * threshold
// `typeof` first: the wizards take JSON from the editor, and `'0.9' > 0.5`
// or `true <= 1` would otherwise pass and be coerced into a threshold.
const isYesThreshold = (threshold: unknown): threshold is number =>
  typeof threshold === 'number' && threshold > 0.5 && threshold <= 1
const isNoThreshold = (threshold: unknown): threshold is number =>
  typeof threshold === 'number' && threshold >= 0 && threshold < 0.5

/**
 * A Decide definition: one boolean question and two rules — P(yes) ≥ 0.5
 * proposes `yes`, anything else `no`, both taking the question's confidence.
 * The labels' `minConfidence` turn the thresholds into bands: P ≥
 * `yesThreshold` decides `yes`, P ≤ `noThreshold` decides `no`, and in
 * between the run goes to review suggesting the more likely side.
 */
export function decideDefinition(input: DecideWizardInput): TemplateDefinition {
  const yesThreshold = input.yesThreshold ?? DECIDE_DEFAULTS.yesThreshold
  const noThreshold = input.noThreshold ?? DECIDE_DEFAULTS.noThreshold
  if (!isYesThreshold(yesThreshold)) {
    throw new RangeError(
      `yesThreshold must be above 0.5 and at most 1 (got ${yesThreshold})`
    )
  }
  if (!isNoThreshold(noThreshold)) {
    throw new RangeError(
      `noThreshold must be at least 0 and below 0.5 (got ${noThreshold})`
    )
  }
  const questionId = input.questionId ?? DECIDE_DEFAULTS.questionId
  const whenTrue = labelCriteria(input.yes)
  const whenFalse = labelCriteria(input.no)
  const criteria = {
    ...(whenTrue === null ? {} : { true: whenTrue }),
    ...(whenFalse === null ? {} : { false: whenFalse })
  }

  return complete({
    kind: 'decide',
    input: { fields: input.fields ?? textField('The text to decide on') },
    decisions: [
      labelDecision(input.yes, yesMinConfidence(yesThreshold)),
      labelDecision(input.no, noMinConfidence(noThreshold))
    ],
    questions: {
      [questionId]: {
        type: 'boolean',
        instructions: input.instructions,
        ...(Object.keys(criteria).length > 0 ? { criteria } : {})
      }
    },
    rules: [
      {
        id: 'yes',
        when: {
          op: 'gte',
          left: { answer: questionId, field: 'probability' },
          right: { value: YES_SPLIT }
        },
        decision: input.yes.label,
        confidenceFrom: questionId
      },
      {
        id: 'no',
        when: { all: [] },
        decision: input.no.label,
        confidenceFrom: questionId
      }
    ],
    fallback: { decision: NEEDS_REVIEW }
  })
}

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
 * The shortest decimal threshold that maps to exactly `minConfidence` (the
 * editor shows `0.1`, not `0.09999999999999998`); failing that — a
 * hand-edited `minConfidence` no threshold reproduces bit for bit — the
 * shortest one within 1e-12. 17 significant digits is `threshold` itself.
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

/**
 * The Decide wizard's thresholds read back from a definition, for the
 * editor; `null` unless its rules are exactly the wizard's two (a P(yes) ≥ 0.5
 * rule then a catch-all, both decided labels taking the same boolean
 * question's confidence) and both labels have a `minConfidence` that maps to
 * a valid threshold. Other sections (preconditions, flags…) are ignored.
 */
export function decideThresholds(
  definition: TemplateDefinition
): { yesThreshold: number; noThreshold: number } | null {
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

  const minConfidenceOf = (label: string) =>
    definition.decisions.find(decision => decision.label === label)
      ?.minConfidence
  const yesMin = minConfidenceOf(yes.decision)
  const noMin = minConfidenceOf(no.decision)
  if (yesMin === undefined || noMin === undefined) return null

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
  if (yesThreshold === null || noThreshold === null) return null
  return { yesThreshold, noThreshold }
}

/**
 * The `minConfidence` every label shares (what the Classify wizard shows as
 * its single threshold); `null` if there are no labels, one has none, or
 * they differ.
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
