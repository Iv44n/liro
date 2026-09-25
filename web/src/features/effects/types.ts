/**
 * Shapes of the effects API (mirrors `api/src/modules/effects/{effects.
 * schemas,effects.views,effects.service}.ts`): a template's effect bindings
 * (`/api/templates/:id/effects`) and the webhook endpoints they can point
 * at (`/api/webhooks`, list + create only — the rest of that resource is
 * feature `webhooks`, W2-A). Dates are ISO strings.
 */

export const EFFECT_TYPES = ['webhook', 'email', 'slack'] as const
export type EffectType = (typeof EFFECT_TYPES)[number]

/** The reserved triggers `on` can be, besides a decision label. */
export const EFFECT_TRIGGER_ANY = '*'
export const EFFECT_TRIGGER_NEEDS_REVIEW = 'needs_review'

// ── Webhook endpoints (list + create only) ──────────────────────────────

export interface WebhookEndpointView {
  id: string
  name: string
  description: string | null
  url: string
  enabled: boolean
  failureCount: number
  disabledReason: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateWebhookEndpointInput {
  name: string
  url: string
  description?: string | null
}

export interface CreatedWebhookEndpoint {
  endpoint: WebhookEndpointView
  /** Shown once, right after creation. */
  secret: string
}

// ── Effect bindings ──────────────────────────────────────────────────────

export type EffectBindingConfigView =
  | { endpointId: string }
  | { to: string[] }
  | { webhookUrlHint: string; channel?: string }

export interface EffectBindingView {
  id: string
  templateId: string
  /** `'*'`, `'needs_review'`, or a decision label. */
  on: string
  /** `null` matches every major version. */
  major: number | null
  type: EffectType
  config: EffectBindingConfigView
  includeInput: boolean
  enabled: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export type CreateEffectBindingConfig =
  | { endpointId: string }
  | { to: string[] }
  | { webhookUrl: string; channel?: string }

export interface CreateEffectBindingInput {
  on: string
  major?: number | null
  type: EffectType
  config: CreateEffectBindingConfig
  includeInput?: boolean
  enabled?: boolean
}

export interface UpdateEffectBindingInput {
  on?: string
  major?: number | null
  config?: CreateEffectBindingConfig
  includeInput?: boolean
  enabled?: boolean
}

// ── Warnings (`GET .../effects` and, after a major publish, `POST /publish`) ─

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

export interface EffectBindingsPage {
  data: EffectBindingView[]
  warnings: EffectWarning[]
}
