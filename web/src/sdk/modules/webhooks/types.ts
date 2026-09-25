import type {
  EffectExecutionView,
  ExecutionStatus
} from '#/sdk/modules/executions/types'

/**
 * Shapes of `/api/webhooks` (mirrors `api/src/modules/effects/{effects.
 * schemas,effects.views,effects.service}.ts`). Dates are ISO strings.
 */

export interface WebhookEndpointView {
  id: string
  name: string
  description: string | null
  url: string
  enabled: boolean
  /** Consecutive delivery failures across every execution; reset on success. */
  failureCount: number
  /** Set when auto-disabled (`'too_many_failures'`); cleared by re-enabling. */
  disabledReason: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateWebhookEndpointRequest {
  /** 1..200 chars (trimmed). */
  name: string
  url: string
  /** ≤ 2000 chars. */
  description?: string | null
}

export interface CreatedWebhookEndpoint {
  endpoint: WebhookEndpointView
  /** Shown once, right after creation: only a hash is stored. */
  secret: string
}

export interface UpdateWebhookEndpointRequest {
  name?: string
  url?: string
  description?: string | null
  /** `true` also resets `failureCount` and clears `disabledReason`. */
  enabled?: boolean
}

export interface WebhookSecret {
  secret: string
}

export interface WebhookTestResult {
  ok: boolean
  status?: number
  durationMs?: number
  error?: string
}

export interface ListDeliveriesParams {
  status?: ExecutionStatus
  /** The previous page's `nextCursor`. */
  cursor?: string
  /** 1..100 (default 50). */
  limit?: number
}

export interface WebhookDeliveriesPage {
  data: EffectExecutionView[]
  nextCursor: string | null
}

/** `ENDPOINT_IN_USE` (409) error `details`. */
export interface EndpointInUseDetails {
  templates: { id: string; name: string }[]
}

export type { EffectExecutionView, ExecutionStatus }
