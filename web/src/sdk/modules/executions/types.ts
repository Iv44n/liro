/**
 * Shapes of the effects queue (mirrors `api/src/modules/effects/{effects.
 * schemas,effects.views}.ts`). Canonical home of `EffectType`/`EffectEvent`/
 * `ExecutionStatus`/`EffectExecutionView` — the `webhooks` module (deliveries
 * of one endpoint) and this module (`/api/runs/:id/effects`, `/api/
 * effect-executions/:id/retry`) both return rows of the same shape. Dates
 * are ISO strings.
 */

export const EFFECT_TYPES = ['webhook', 'email', 'slack'] as const
export type EffectType = (typeof EFFECT_TYPES)[number]

/** The events a binding's `on` can match (`'*'` and `'needs_review'` are matched separately). */
export const EFFECT_EVENTS = [
  'decision.made',
  'decision.review_requested',
  'decision.reviewed'
] as const
export type EffectEvent = (typeof EFFECT_EVENTS)[number]

export const EXECUTION_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'dead',
  'canceled'
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export interface EffectExecutionView {
  id: string
  runId: string
  /** `null` once the binding that created this row is deleted. */
  bindingId: string | null
  /** Webhook deliveries only; `null` for other types or a deleted endpoint. */
  endpointId: string | null
  templateId: string
  type: EffectType
  event: EffectEvent
  /** Display string: the endpoint's host, the recipient emails, or `'slack'`. */
  target: string
  status: ExecutionStatus
  attempts: number
  maxAttempts: number
  runAt: string
  lockedUntil: string | null
  lastAttemptAt: string | null
  lastError: string | null
  lastResponseStatus: number | null
  /** Truncated to ≤ 2 KB. */
  lastResponseBody: string | null
  lastDurationMs: number | null
  payload: unknown
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** `EXECUTION_NOT_RETRYABLE` (409) error `details`. */
export interface ExecutionNotRetryableDetails {
  status: ExecutionStatus
}
