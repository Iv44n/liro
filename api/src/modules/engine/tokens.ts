import { canonicalJson } from '#shared/core/hash'
import type { CanonicalQuestion } from './evaluator/port'

/**
 * Token estimates for Jev requests. Jev's tokenizer isn't available to Liro,
 * so these are a *heuristic* (~4 characters per token, the usual rule of
 * thumb for English JSON): good enough to warn authors early and to reject
 * requests that are clearly too large, never a substitute for the provider's
 * own `INPUT_TOO_LARGE`, which stays the source of truth.
 */

/**
 * `ceil(length / 4)` of the value's canonical JSON; a string counts its raw
 * characters (it's sent as text, not as a quoted JSON literal). Values JSON
 * can't represent (`undefined`, functions) count as 0.
 */
export function estimateTokens(value: unknown): number {
  const text: string | undefined =
    typeof value === 'string' ? value : canonicalJson(value)
  return text === undefined ? 0 : Math.ceil(text.length / 4)
}

export interface RequestTokenEstimate {
  state: number
  /** The largest single question (0 when there are none). */
  longestQuestion: number
  /** `state + longestQuestion`: what Jev's context limit applies to. */
  total: number
}

/**
 * Jev evaluates every question against the whole state, so its context limit
 * applies to the state plus the longest question — not to the sum of all
 * questions.
 */
export function estimateRequestTokens(
  state: unknown,
  questions: Record<string, CanonicalQuestion>
): RequestTokenEstimate {
  const stateTokens = estimateTokens(state)
  const longestQuestion = Object.values(questions).reduce(
    (longest, question) => Math.max(longest, estimateTokens(question)),
    0
  )
  return {
    state: stateTokens,
    longestQuestion,
    total: stateTokens + longestQuestion
  }
}

export type TokenBudgetStatus = 'ok' | 'warn' | 'reject'

/**
 * `warn` above 80% of `maxContextTokens`; `reject` only above 120%, because
 * the estimate is rough and the provider rejects oversized requests itself.
 * Compared in integers (`5·estimate` vs `4·max` / `6·max`) so the thresholds
 * are exact. Throws `RangeError` on a non-positive or NaN limit, or a
 * negative or NaN estimate (caller bugs, not input problems).
 */
export function checkTokenBudget(
  estimate: number,
  maxContextTokens: number
): TokenBudgetStatus {
  if (!(maxContextTokens > 0)) {
    throw new RangeError(
      `maxContextTokens must be positive (got ${maxContextTokens})`
    )
  }
  // A NaN estimate would compare false everywhere and pass as `ok`.
  if (!(estimate >= 0)) {
    throw new RangeError(
      `estimate must be a non-negative number (got ${estimate})`
    )
  }
  if (estimate * 5 > maxContextTokens * 6) return 'reject'
  if (estimate * 5 > maxContextTokens * 4) return 'warn'
  return 'ok'
}
