import type { TemplateView, VersionStatus } from '#/sdk/modules/templates/types'
import type { InputFieldType, TemplateKind } from '../types/definition'

/** What each wizard kind is called in the dashboard. */
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  classify: 'Clasificar',
  decide: 'Sí/no',
  score: 'Puntuación',
  custom: 'Personalizada'
}

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  deprecated: 'Obsoleta',
  model_unavailable: 'Modelo no disponible'
}

export const INPUT_FIELD_TYPE_LABELS: Record<InputFieldType, string> = {
  string: 'Texto',
  number: 'Número',
  integer: 'Número entero',
  boolean: 'Sí/no',
  datetime: 'Fecha y hora',
  enum: 'Lista de valores',
  array: 'Lista (JSON)',
  object: 'Objeto (JSON)'
}

const dateTimeFormat = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' })

const relativeFormat = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** `23 sept 2026, 14:05`. */
export const formatDateTime = (iso: string): string =>
  dateTimeFormat.format(new Date(iso))

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago `iso` was, in Spanish (`hace 5 minutos`, `ayer`, `hace 3
 * días`); the date itself after 30 days, and `ahora` for the last minute
 * (or a slightly skewed future time).
 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''
  const elapsed = now - time
  if (elapsed < MINUTE) return relativeFormat.format(0, 'second')
  if (elapsed < HOUR) {
    return relativeFormat.format(-Math.floor(elapsed / MINUTE), 'minute')
  }
  if (elapsed < DAY) {
    return relativeFormat.format(-Math.floor(elapsed / HOUR), 'hour')
  }
  if (elapsed < 30 * DAY) {
    return relativeFormat.format(-Math.floor(elapsed / DAY), 'day')
  }
  return dateFormat.format(new Date(time))
}

/** Lowercase, without accents: for accent-insensitive search. */
export const foldText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()

/** Whether a template's name, slug or description contains every word of `query`. */
export function matchesTemplateQuery(
  template: Pick<TemplateView, 'name' | 'slug' | 'description'>,
  query: string
): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = foldText(
    [template.name, template.slug, template.description ?? ''].join(' ')
  )
  return words.every(word => haystack.includes(word))
}

/** `1 decisión` / `3 decisiones`. */
export const countLabel = (
  count: number,
  singular: string,
  plural: string
): string => `${count} ${count === 1 ? singular : plural}`
