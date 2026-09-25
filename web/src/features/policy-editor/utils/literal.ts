import type { JsonValue } from '#/features/templates/types/definition'
import type { OperandTypeInfo } from './operand-model'

/**
 * The widget a `value` operand's literal edits with, and the text ↔
 * `JsonValue` conversions each widget needs — chosen from the *other*
 * side of the comparison's type (`OperandTypeInfo`), so comparing against
 * `answer.confidence` shows a number input, `answer.choice` shows the
 * option picker, an `input` of type `boolean` shows a switch, and a date
 * field shows a date picker. Falls back to free text when nothing narrows
 * it (still valid JSON when it parses as a number/boolean, else a string).
 */
export type LiteralWidget = 'select' | 'boolean' | 'number' | 'date' | 'text'

export function widgetFor(type: OperandTypeInfo | undefined): LiteralWidget {
  if (!type) return 'text'
  if (type.options && type.options.length > 0) return 'select'
  if (type.json === 'boolean') return 'boolean'
  if (type.json === 'number') return 'number'
  if (type.date) return 'date'
  return 'text'
}

/** A literal for display in a plain text input (`null` shows as `''`). */
export function formatLiteralText(value: JsonValue): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Free text as a `JsonValue`: numbers and `true`/`false` parse as
 * themselves (so a hand-typed `42` compares as a number, not `"42"`), an
 * empty string parses as `null` (clears the literal), everything else stays
 * a string.
 */
export function parseLiteralText(text: string): JsonValue {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed)
  return text
}

/** A number literal for an `<input type="number">` (`''` when not a finite number). */
export function formatLiteralNumber(value: JsonValue): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : ''
}

export function parseLiteralNumber(text: string): JsonValue {
  if (text.trim() === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** A date literal for an `<input type="date">`: the `YYYY-MM-DD` prefix of an ISO string, else `''`. */
export function formatLiteralDate(value: JsonValue): string {
  if (typeof value === 'string') return value.slice(0, 10)
  return ''
}

export function parseLiteralDate(text: string): JsonValue {
  return text === '' ? null : text
}

/** The boolean a `boolean`-widget literal holds (defaults to `false` for anything else). */
export function literalAsBoolean(value: JsonValue): boolean {
  return value === true
}
