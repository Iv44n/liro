import { decryptSecret } from '#shared/core/crypto'
import type {
  EffectBindingConfig,
  EffectEvent,
  EffectType,
  ExecutionStatus,
  effectBindings,
  effectExecutions,
  webhookEndpoints
} from './effects.schemas'
import type { EffectPayload } from './payload'

/**
 * Response shapes of the effects API (`/api/webhooks`,
 * `/api/templates/:id/effects`, `/api/runs/:id/effects`,
 * `/api/effect-executions`). Pure functions of rows: the service loads what
 * they need.
 */

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect
export type EffectBindingRow = typeof effectBindings.$inferSelect
export type EffectExecutionRow = typeof effectExecutions.$inferSelect

// ── Webhook endpoints ────────────────────────────────────────────────────

export interface WebhookEndpointView {
  id: string
  name: string
  description: string | null
  url: string
  enabled: boolean
  failureCount: number
  disabledReason: string | null
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Never the secret. */
export function webhookEndpointView(
  row: WebhookEndpointRow
): WebhookEndpointView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    enabled: row.enabled,
    failureCount: row.failureCount,
    disabledReason: row.disabledReason,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

// ── Effect bindings ──────────────────────────────────────────────────────

export type EffectBindingConfigView =
  | { endpointId: string }
  | { to: string[] }
  | { webhookUrlHint: string; channel?: string }

export interface EffectBindingView {
  id: string
  templateId: string
  on: string
  major: number | null
  type: EffectType
  config: EffectBindingConfigView
  includeInput: boolean
  enabled: boolean
  position: number
  createdAt: Date
  updatedAt: Date
}

const SLACK_URL_HINT_PREFIX = 'https://hooks.slack.com/'

/** Never the Slack URL (only a truncated hint, decrypted just for this). */
function configView(
  type: EffectType,
  config: EffectBindingConfig
): EffectBindingConfigView {
  switch (type) {
    case 'webhook':
      return { endpointId: (config as { endpointId: string }).endpointId }
    case 'email':
      return { to: (config as { to: string[] }).to }
    case 'slack': {
      const { webhookUrlEncrypted, channel } = config as {
        webhookUrlEncrypted: string
        channel?: string
      }
      const url = decryptSecret(webhookUrlEncrypted)
      return {
        webhookUrlHint: `${SLACK_URL_HINT_PREFIX}…/${url.slice(-4)}`,
        ...(channel ? { channel } : {})
      }
    }
  }
}

export function effectBindingView(row: EffectBindingRow): EffectBindingView {
  return {
    id: row.id,
    templateId: row.templateId,
    on: row.on,
    major: row.major,
    type: row.type,
    config: configView(row.type, row.config),
    includeInput: row.includeInput,
    enabled: row.enabled,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

// ── Warnings ─────────────────────────────────────────────────────────────

/**
 * - `UNBOUND_LABEL`: a decision label of the checked version that no enabled
 *   binding covers (no `on: '*'`, no `on: <label>`).
 * - `ORPHAN_BINDING`: an enabled binding whose `on` label doesn't exist in
 *   the checked version.
 * - `BINDING_OLD_MAJOR`: (publish only) a binding pinned to the major that
 *   was just superseded.
 */
export type EffectWarningCode =
  | 'UNBOUND_LABEL'
  | 'ORPHAN_BINDING'
  | 'BINDING_OLD_MAJOR'

export interface EffectWarning {
  code: EffectWarningCode
  /** `UNBOUND_LABEL` and `ORPHAN_BINDING`. */
  label?: string
  /** `ORPHAN_BINDING` and `BINDING_OLD_MAJOR`. */
  bindingId?: string
}

// ── Effect executions ────────────────────────────────────────────────────

export interface EffectExecutionView {
  id: string
  runId: string
  bindingId: string | null
  endpointId: string | null
  templateId: string
  type: EffectType
  event: EffectEvent
  target: string
  status: ExecutionStatus
  attempts: number
  maxAttempts: number
  runAt: Date
  lockedUntil: Date | null
  lastAttemptAt: Date | null
  lastError: string | null
  lastResponseStatus: number | null
  lastResponseBody: string | null
  lastDurationMs: number | null
  payload: EffectPayload
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export function effectExecutionView(
  row: EffectExecutionRow
): EffectExecutionView {
  return {
    id: row.id,
    runId: row.runId,
    bindingId: row.bindingId,
    endpointId: row.endpointId,
    templateId: row.templateId,
    type: row.type,
    event: row.event,
    target: row.target,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt,
    lockedUntil: row.lockedUntil,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    lastResponseStatus: row.lastResponseStatus,
    lastResponseBody: row.lastResponseBody,
    lastDurationMs: row.lastDurationMs,
    payload: row.payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt
  }
}
