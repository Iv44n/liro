import type { EffectType } from '#/sdk/modules/executions/types'

/**
 * Shapes of a template's effect bindings (mirrors `api/src/modules/effects/
 * {effects.schemas,effects.views,effects.service}.ts`,
 * `/api/templates/:id/effects`). Dates are ISO strings.
 */

/** The reserved triggers `on` can be, besides a decision label. */
export const EFFECT_TRIGGER_ANY = '*'
export const EFFECT_TRIGGER_NEEDS_REVIEW = 'needs_review'

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

export interface CreateEffectBindingRequest {
  on: string
  major?: number | null
  type: EffectType
  config: CreateEffectBindingConfig
  includeInput?: boolean
  enabled?: boolean
}

export interface UpdateEffectBindingRequest {
  on?: string
  major?: number | null
  config?: Record<string, unknown>
  includeInput?: boolean
  enabled?: boolean
}

/**
 * - `UNBOUND_LABEL`: a decision label with no covering binding.
 * - `ORPHAN_BINDING`: an enabled binding whose `on` label no longer exists.
 * - `BINDING_OLD_MAJOR`: (publish only) a binding pinned to a superseded major.
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

export interface EffectBindingsPage {
  data: EffectBindingView[]
  warnings: EffectWarning[]
}
