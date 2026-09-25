import type {
  InputFieldType,
  QuestionType,
  TemplateKind
} from '#/features/templates/types/definition'
import type { EditorTab } from '#/features/templates/types/editor'
import type {
  StoreInputMode,
  VersionStatus
} from '#/sdk/modules/templates/types'

export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  input: 'Entrada',
  questions: 'Preguntas',
  decisions: 'Decisiones',
  policy: 'Política',
  effects: 'Efectos',
  versions: 'Versiones',
  integrate: 'Integrar'
}

/** Spanish names for the editor's enums, and small formatters. */

export const KIND_LABELS: Record<TemplateKind, string> = {
  classify: 'Clasificar',
  score: 'Puntuar',
  decide: 'Sí / no',
  custom: 'Personalizada'
}

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  deprecated: 'Obsoleta',
  model_unavailable: 'Modelo no disponible'
}

export const VERSION_STATUS_DESCRIPTIONS: Record<VersionStatus, string> = {
  draft: 'Aún no publicada.',
  published: 'Disponible para `slug`, `slug@mayor` y su referencia exacta.',
  deprecated:
    'Sigue respondiendo a su referencia exacta (con la cabecera Deprecation), pero `slug` y `slug@mayor` la omiten.',
  model_unavailable:
    'El proveedor ya no ofrece el modelo fijado: las ejecuciones se rechazan.'
}

export const FIELD_TYPE_LABELS: Record<InputFieldType, string> = {
  string: 'Texto',
  number: 'Número',
  integer: 'Entero',
  boolean: 'Sí / no',
  datetime: 'Fecha y hora',
  enum: 'Lista de valores',
  array: 'Lista (JSON)',
  object: 'Objeto (JSON)'
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: 'Opción',
  score: 'Puntuación',
  boolean: 'Sí / no'
}

export const QUESTION_TYPE_DESCRIPTIONS: Record<QuestionType, string> = {
  choice: 'Elige una opción entre varias (p. ej. la cola de un ticket).',
  score: 'Ubica la entrada en una escala de niveles ordenados.',
  boolean: 'Responde sí o no, con la probabilidad de sí.'
}

export const STORE_INPUT_TEXTS: Record<
  StoreInputMode,
  { label: string; description: string }
> = {
  full: {
    label: 'Completa',
    description:
      'Cada ejecución guarda toda su entrada, salvo los campos marcados como dato personal.'
  },
  policy: {
    label: 'Solo lo que usa la política',
    description:
      'Se guardan solo los campos que leen las reglas (lo mínimo para reproducir la decisión).'
  },
  none: {
    label: 'Nada',
    description:
      'No se guarda la entrada. La revisión humana no podrá ver el caso original.'
  }
}

const dateFormatter = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

/** `12 sept 2026, 10:30`, or `—` without a date. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}

const relativeFormatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** `hace 5 minutos`, relative to `now`. */
export function formatRelative(
  value: string | null | undefined,
  now: number = Date.now()
): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '—'
  const seconds = Math.round((time - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60]
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relativeFormatter.format(Math.round(seconds / size), unit)
    }
  }
  return 'hace un momento'
}

/** `0.8` → `80 %`. */
export const formatPercent = (value: number): string =>
  `${Math.round(value * 100)} %`

/** `n` with the right Spanish noun: `1 error`, `2 errores`. */
export const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`
