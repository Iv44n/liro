import {
  EFFECT_TRIGGER_ANY,
  EFFECT_TRIGGER_NEEDS_REVIEW,
  type EffectBindingView,
  type EffectType,
  type EffectWarning,
  type WebhookEndpointView
} from '../types'

/** Spanish names for the effect type. */
export const EFFECT_TYPE_LABELS: Record<EffectType, string> = {
  webhook: 'Webhook',
  email: 'Correo',
  slack: 'Slack'
}

export const EFFECT_TYPE_DESCRIPTIONS: Record<EffectType, string> = {
  webhook: 'Llama a una URL propia (firmada, con reintentos).',
  email: 'Envía un correo a miembros de la organización.',
  slack: 'Publica en un canal a través de un webhook entrante.'
}

/** `*` → "cualquier resultado", `needs_review` → "pide revisión", else the label itself. */
export function triggerLabel(on: string): string {
  if (on === EFFECT_TRIGGER_ANY) return 'Cualquier resultado'
  if (on === EFFECT_TRIGGER_NEEDS_REVIEW) return 'Pide revisión'
  return on
}

export function triggerDescription(on: string): string | null {
  if (on === EFFECT_TRIGGER_ANY)
    return 'Se dispara sin importar qué decisión salga.'
  if (on === EFFECT_TRIGGER_NEEDS_REVIEW)
    return 'Se dispara cuando la ejecución queda pendiente de revisión humana.'
  return null
}

/** `null` → "todas las versiones mayores"; else "solo la v<major>". */
export function majorScopeLabel(major: number | null): string {
  return major === null
    ? 'Todas las versiones mayores'
    : `Solo la versión v${major}`
}

/** The trigger options offered by the "on" picker: `*`, `needs_review`, then each label. */
export function effectTriggerOptions(labels: readonly string[]): string[] {
  return [EFFECT_TRIGGER_ANY, EFFECT_TRIGGER_NEEDS_REVIEW, ...labels]
}

export interface EffectGroup {
  on: string
  bindings: EffectBindingView[]
  /** `on` doesn't match any label of the current definition (nor `*`/`needs_review`). */
  orphan: boolean
}

/**
 * Bindings grouped by trigger: `*`, `needs_review`, then every label of the
 * current definition (in its order, even with no bindings yet — so a group
 * with none is where "añadir efecto" for that label belongs), then any
 * other `on` value still in use (a label removed from the definition).
 */
export function groupBindingsByTrigger(
  bindings: readonly EffectBindingView[],
  labels: readonly string[]
): EffectGroup[] {
  const known = [EFFECT_TRIGGER_ANY, EFFECT_TRIGGER_NEEDS_REVIEW, ...labels]
  const knownSet = new Set(known)
  const orphanTriggers = [
    ...new Set(bindings.map(binding => binding.on))
  ].filter(on => !knownSet.has(on))

  return [...known, ...orphanTriggers].map(on => ({
    on,
    bindings: bindings.filter(binding => binding.on === on),
    orphan: !knownSet.has(on)
  }))
}

/**
 * Whether the webhook endpoints list (`useWebhookEndpoints`) has finished
 * loading: `'pending'` while it's in flight, `'error'` if it failed, and
 * only `'ready'` once `endpointsById` can be trusted to reflect which
 * endpoints actually exist. A webhook binding whose endpoint isn't in the
 * map must not be treated as "orphaned" (endpoint deleted) unless the
 * status is `'ready'` — otherwise a slow or failed fetch makes every
 * working webhook effect look broken.
 */
export type EndpointsStatus = 'pending' | 'error' | 'ready'

/** A short display string of a binding's target, for its row. */
export function configSummary(
  binding: EffectBindingView,
  endpointsById: ReadonlyMap<string, WebhookEndpointView>,
  endpointsStatus: EndpointsStatus = 'ready'
): string {
  switch (binding.type) {
    case 'webhook': {
      if (endpointsStatus === 'pending') return 'Cargando endpoint…'
      if (endpointsStatus === 'error') return 'No se pudo verificar el endpoint'
      const { endpointId } = binding.config as { endpointId: string }
      return endpointsById.get(endpointId)?.name ?? 'Endpoint eliminado'
    }
    case 'email': {
      const { to } = binding.config as { to: string[] }
      if (to.length <= 2) return to.join(', ')
      return `${to.slice(0, 2).join(', ')} y ${to.length - 2} más`
    }
    case 'slack': {
      const { webhookUrlHint, channel } = binding.config as {
        webhookUrlHint: string
        channel?: string
      }
      return channel ? `${webhookUrlHint} · #${channel}` : webhookUrlHint
    }
  }
}

/** The host of a URL, for a compact display; the raw string if it doesn't parse. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Spanish text of one `GET .../effects` or publish-response warning. */
export function warningText(warning: EffectWarning): string {
  switch (warning.code) {
    case 'UNBOUND_LABEL':
      return `La etiqueta "${warning.label}" no tiene ningún efecto que la cubra.`
    case 'ORPHAN_BINDING':
      return `Un efecto está configurado para "${warning.label}", que ya no es una etiqueta de la versión publicada.`
    case 'BINDING_OLD_MAJOR':
      return 'Un efecto quedó fijado a la versión mayor anterior; revisa si sigue teniendo sentido.'
  }
}
