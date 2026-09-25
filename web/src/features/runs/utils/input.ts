import type { JsonValue } from '#/features/templates/types/definition'

/** One leaf of a run's input, as a dotted path (`customer.name`). */
export interface InputEntry {
  path: string
  value: JsonValue
}

const isPlainObject = (
  value: JsonValue
): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Flattens nested objects into dotted paths, the way input fields are
 * declared (`customer.name`). Arrays and empty objects stay whole leaves.
 */
export function flattenInput(
  input: Record<string, JsonValue> | null | undefined,
  prefix = ''
): InputEntry[] {
  if (!input) return []

  const entries: InputEntry[] = []
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      entries.push(...flattenInput(value, path))
    } else {
      entries.push({ path, value })
    }
  }
  return entries
}

/** Whether a value reads better as a block (long or multi-line text, JSON). */
export function isBlockValue(value: JsonValue): boolean {
  if (typeof value === 'string') {
    return value.length > 80 || value.includes('\n')
  }
  return typeof value === 'object' && value !== null
}

/**
 * A one-line glimpse of an input for lists: its first non-empty text value,
 * whitespace collapsed and cut at `max` characters.
 */
export function inputPreview(
  input: Record<string, JsonValue> | null | undefined,
  max = 140
): string | null {
  for (const entry of flattenInput(input)) {
    if (typeof entry.value !== 'string') continue
    const text = entry.value.replace(/\s+/g, ' ').trim()
    if (!text) continue
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
  }
  return null
}

/** A leaf value as text: strings as they are, everything else as JSON. */
export function inputValueText(value: JsonValue): string {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'null'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value, null, 2)
}
