import type { effectExecutions } from '#modules/effects/effects.schemas'

/**
 * The `deliver` contract every handler (`webhook.ts`, `email.ts`,
 * `slack.ts`) implements: try the delivery once, never throw, and describe
 * what happened so `delivery.ts` can record it and decide whether to retry.
 */

export type ExecutionRow = typeof effectExecutions.$inferSelect

export interface DeliverContext {
  /** The attempt's own clock (not `Date.now()`), so tests can control it. */
  now: Date
}

export interface DeliverResult {
  ok: boolean
  status?: number
  /** Truncated by `delivery.ts` before it's stored. */
  body?: string
  /** Required when `ok` is `false`. */
  error?: string
  durationMs?: number
  /** No further retries: goes `dead` immediately, whatever `attempts` is left. */
  permanent?: boolean
}

export type Deliver = (
  execution: ExecutionRow,
  ctx: DeliverContext
) => Promise<DeliverResult>
