/**
 * Parses and prints the JSON textareas of the editor (static context, the
 * policy sections' "avanzado" editors, an `EntryType`'s raw-JSON fallback).
 */

export interface JsonParseResult<T> {
  ok: boolean
  /** Only set when `ok`; `undefined` for a blank `text`. */
  value?: T
  /** Only set when `!ok`. */
  error?: string
}

/** Blank text parses to `undefined` (the caller decides what that means); otherwise strict JSON. */
export function parseJsonText<T = unknown>(text: string): JsonParseResult<T> {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true }
  try {
    return { ok: true, value: JSON.parse(trimmed) as T }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'JSON inválido'
    }
  }
}

/** Pretty JSON for a textarea; `''` for `undefined` (an empty field, not `"undefined"`). */
export function stringifyJson(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

/** Whether `value` is a plain JSON object (not an array, not `null`). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
