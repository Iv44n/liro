/**
 * Spanish formatters shared by the runs explorer, the review inbox, the API
 * keys page and the dashboard. Pure (the current time is a parameter), so
 * they are unit-tested.
 */

const NBSP = ' '
const EMPTY = '—'

const numberFormatters = new Map<number, Intl.NumberFormat>()

function numberFormatter(maximumFractionDigits: number): Intl.NumberFormat {
  let formatter = numberFormatters.get(maximumFractionDigits)
  if (!formatter) {
    formatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits })
    numberFormatters.set(maximumFractionDigits, formatter)
  }
  return formatter
}

/** `1234.5` → `1234,5`; `12345` → `12.345`. `null` → `—`. */
export function formatNumber(
  value: number | null | undefined,
  maximumFractionDigits = 2
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY
  }
  return numberFormatter(maximumFractionDigits).format(value)
}

/** A ratio in [0, 1] as a percentage: `0.873` → `87 %`. `null` → `—`. */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 0
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY
  }
  // `toPrecision` first absorbs binary noise (0.8765 × 1000 = 876.4999…).
  const factor = 10 ** fractionDigits
  const scaled = Number((value * 100 * factor).toPrecision(12))
  const percent = (Math.round(scaled) / factor)
    .toFixed(fractionDigits)
    .replace('.', ',')
  return `${percent}${NBSP}%`
}

/**
 * A probability as a percentage that never rounds to a misleading extreme:
 * `0.003` → `<1 %`, `0.997` → `>99 %`; exactly `0` and `1` stay `0 %` and
 * `100 %`.
 */
export function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY
  }
  if (value > 0 && value < 0.005) return `<1${NBSP}%`
  if (value < 1 && value >= 0.995) return `>99${NBSP}%`
  return formatPercent(value)
}

/** `850` → `850 ms`; `1234` → `1,2 s`; `75000` → `1 min 15 s`. `null` → `—`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return EMPTY
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}${NBSP}ms`
  if (ms < 60_000) {
    const seconds = (ms / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',')
    return `${seconds}${NBSP}s`
  }
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0
    ? `${minutes}${NBSP}min`
    : `${minutes}${NBSP}min ${seconds}${NBSP}s`
}

const dateTimeFormatter = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium' })

const preciseFormatter = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'medium'
})

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `23 sept 2026, 14:05`. `null` → `—`. */
export function formatDateTime(value: string | Date | null | undefined) {
  const date = value ? toDate(value) : null
  return date ? dateTimeFormatter.format(date) : EMPTY
}

/** `23 sept 2026, 14:05:32` (for tooltips and technical details). */
export function formatPreciseDateTime(
  value: string | Date | null | undefined
): string {
  const date = value ? toDate(value) : null
  return date ? preciseFormatter.format(date) : EMPTY
}

/** `23 sept 2026`. `null` → `—`. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = value ? toDate(value) : null
  return date ? dateFormatter.format(date) : EMPTY
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago `value` was, in Spanish: `hace un momento`, `hace 5 min`,
 * `hace 3 h`, `ayer`, `hace 4 días`; a week or more shows the date.
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  now: number = Date.now()
): string {
  const date = value ? toDate(value) : null
  if (!date) return EMPTY

  const elapsed = now - date.getTime()
  if (elapsed < 45_000) return 'hace un momento'
  if (elapsed < HOUR)
    return `hace ${Math.max(1, Math.round(elapsed / MINUTE))} min`
  if (elapsed < DAY) return `hace ${Math.floor(elapsed / HOUR)} h`

  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  return formatDate(date)
}

/**
 * How long until `value`, in Spanish (`en 3 días`, `en 5 h`); `null` once it
 * is in the past.
 */
export function formatTimeUntil(
  value: string | Date | null | undefined,
  now: number = Date.now()
): string | null {
  const date = value ? toDate(value) : null
  if (!date) return null

  const remaining = date.getTime() - now
  if (remaining <= 0) return null
  if (remaining < HOUR) {
    return `en ${Math.max(1, Math.round(remaining / MINUTE))} min`
  }
  if (remaining < DAY) return `en ${Math.floor(remaining / HOUR)} h`

  const days = Math.floor(remaining / DAY)
  return days === 1 ? 'en 1 día' : `en ${days} días`
}

/** `3` → `3 ejecuciones`; `1` → `1 ejecución`. */
export function pluralize(
  count: number,
  singular: string,
  plural: string
): string {
  return `${formatNumber(count, 0)} ${count === 1 ? singular : plural}`
}
