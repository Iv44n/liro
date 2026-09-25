import type { JsonValue } from '#modules/engine/evaluator/port'
import type { JsonObject } from '#modules/templates/paths'

/**
 * Types shared by the engine's pure stages (answers → signals → flags →
 * rules) and the executor that persists their result.
 */

/** Bumped whenever the engine's semantics change; stored on every run. */
export const ENGINE_VERSION = '1'

/**
 * A provider answer normalized for the policy: probabilities complete and
 * summing to 1, plus the derived fields operands read. Confidence is always
 * computed by Liro from the probabilities — never taken from the provider —
 * and is `null` when the provider returned none (fail-closed).
 */
export type ResolvedAnswer =
  | {
      type: 'choice'
      choice: string
      /** Option name → probability, every option present; `null` if the provider sent none. */
      probabilities: Record<string, number> | null
      confidence: number | null
    }
  | {
      type: 'score'
      /** Expected level in [0, levels − 1]. */
      score: number
      /** `score / (levels − 1)`. */
      scoreNorm: number
      /** Label of the most probable level (argmax), or of `round(score)` without probabilities. */
      level: string
      levelIndex: number
      /** Level label → probability; `null` if the provider sent none. */
      probabilities: Record<string, number> | null
      confidence: number | null
    }
  | {
      type: 'boolean'
      /** P(true). */
      probability: number
      /** `|2p − 1|`. */
      confidence: number
    }

/** `null` = the question was not asked (its `when` did not hold). */
export type ResolvedAnswers = Record<string, ResolvedAnswer | null>

export type ReviewReason =
  /** The decided label's `minConfidence` wasn't met (or there was no confidence). */
  | 'low_confidence'
  /** The decided label has `alwaysReview`. */
  | 'always_review'
  /** A precondition or rule decided `needs_review`. */
  | 'rule'
  /** No rule matched and the fallback is `needs_review`. */
  | 'fallback'

export type PolicyStage = 'precondition' | 'rule' | 'fallback'

export interface PolicyContext {
  /** The run input (already validated against the template's fields). */
  input: JsonObject
  answers: ResolvedAnswers
  /** The run's time, for date operators. */
  now: Date
}

export interface PolicyResult {
  /** A declared label, or `needs_review`. */
  decision: string
  /**
   * What the reviewer is offered by default: the decision itself when it was
   * made, the gated label when a label policy sent it to review, or the first
   * non-review outcome when a rule/fallback asked for review. `null` if none.
   */
  suggestion: string | null
  /** Confidence of the decision (see `DecisionRule.confidenceFrom`), `null` when there is none. */
  confidence: number | null
  /** Id of the precondition/rule that decided; `null` for the fallback. */
  rule: string | null
  stage: PolicyStage
  /** Set iff `decision` is `needs_review`. */
  reviewReason: ReviewReason | null
  flags: string[]
  signals: Record<string, number | null>
}

export type { JsonObject, JsonValue }
