import type {
  EffectEvent,
  EffectType,
  ExecutionStatus
} from '#/sdk/modules/executions/types'

/** Spanish names for the webhooks/effects domain. */

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  queued: 'En cola',
  running: 'Enviando',
  succeeded: 'Entregada',
  dead: 'Fallida',
  canceled: 'Cancelada'
}

export const EFFECT_TYPE_LABELS: Record<EffectType, string> = {
  webhook: 'Webhook',
  email: 'Correo',
  slack: 'Slack'
}

export const EFFECT_EVENT_LABELS: Record<EffectEvent, string> = {
  'decision.made': 'Decisión tomada',
  'decision.review_requested': 'Revisión solicitada',
  'decision.reviewed': 'Revisión resuelta'
}

/** Whether the endpoint's URL host, for the endpoints table. `null` for an invalid URL. */
export function urlHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const DISABLED_REASON_LABELS: Record<string, string> = {
  too_many_failures: 'Demasiados fallos consecutivos'
}

/** A `disabledReason` code, in Spanish (falls back to the raw code). */
export function disabledReasonText(reason: string): string {
  return DISABLED_REASON_LABELS[reason] ?? reason
}
