import type {
  EntryType,
  JsonValue
} from '#/features/templates/types/definition'

/**
 * Jev's instructions and criteria (`EntryType`) are text, or structured
 * JSON. The editor offers three ways to write one: plain text, a small form
 * with the fields the docs recommend (instructions: question / focus /
 * inspect / compare; criteria: what / not_for / examples), and raw JSON for
 * anything else.
 */

export type EntryMode = 'text' | 'structured' | 'json'

export type EntryKind = 'instructions' | 'criteria'

export interface StructuredKey {
  key: string
  label: string
  /** A list of lines (one item per line) rather than a single text. */
  list: boolean
  placeholder: string
  hint?: string
}

export const STRUCTURED_KEYS: Record<EntryKind, readonly StructuredKey[]> = {
  instructions: [
    {
      key: 'question',
      label: 'Pregunta',
      list: false,
      placeholder: '¿Qué cola de soporte debe atender este ticket?'
    },
    {
      key: 'focus',
      label: 'Enfoque',
      list: false,
      placeholder: 'En qué debe fijarse para responder.'
    },
    {
      key: 'inspect',
      label: 'Revisar',
      list: true,
      placeholder: '`ticket.message` es lo que escribió el cliente.',
      hint: 'Un elemento por línea.'
    },
    {
      key: 'compare',
      label: 'Comparar',
      list: true,
      placeholder: 'Qué comparar con qué.',
      hint: 'Un elemento por línea.'
    }
  ],
  criteria: [
    {
      key: 'what',
      label: 'Qué cubre',
      list: false,
      placeholder: 'Qué casos entran en esta opción.'
    },
    {
      key: 'not_for',
      label: 'Qué no cubre',
      list: false,
      placeholder: 'Casos parecidos que van en otra opción.'
    },
    {
      key: 'examples',
      label: 'Ejemplos',
      list: true,
      placeholder: 'Un ejemplo de entrada',
      hint: 'Un ejemplo por línea.'
    }
  ]
}

type Structured = Record<string, string | string[]>

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

/** `entry` as the structured form's object, or `null` if the form can't show it. */
export function asStructured(
  entry: EntryType | null | undefined,
  kind: EntryKind
): Structured | null {
  if (entry === null || entry === undefined) return {}
  if (typeof entry !== 'object' || Array.isArray(entry)) return null

  const keys = STRUCTURED_KEYS[kind]
  const result: Structured = {}
  for (const [key, value] of Object.entries(entry)) {
    const spec = keys.find(candidate => candidate.key === key)
    if (!spec) return null
    if (typeof value === 'string') result[key] = value
    else if (spec.list && isStringList(value)) result[key] = value
    else return null
  }
  return result
}

/** The mode an entry opens in. */
export function entryMode(
  entry: EntryType | null | undefined,
  kind: EntryKind
): EntryMode {
  if (entry === null || entry === undefined || typeof entry === 'string') {
    return 'text'
  }
  return asStructured(entry, kind) ? 'structured' : 'json'
}

/** The text of a structured key, as the form shows it (lists: one per line). */
export function structuredText(value: string | string[] | undefined): string {
  if (value === undefined) return ''
  return Array.isArray(value) ? value.join('\n') : value
}

/** The value a list key's text stands for: its non-blank lines. */
export const textLines = (text: string): string[] =>
  text.split('\n').filter(line => line.trim() !== '')

/**
 * `entry` with `key` set from the form's `text`. Blank text removes the key;
 * a list key keeps the shape it had (a string stays a string while it has a
 * single item), else becomes the array of its non-blank lines. Returns
 * `null` when nothing is left.
 */
export function setStructuredKey(
  entry: Structured,
  spec: StructuredKey,
  text: string
): Structured | null {
  const next: Structured = { ...entry }
  if (!spec.list) {
    if (text.trim() === '') delete next[spec.key]
    else next[spec.key] = text
  } else {
    const lines = textLines(text)
    const wasString = typeof entry[spec.key] === 'string'
    if (lines.length === 0) delete next[spec.key]
    else if (wasString && lines.length === 1) next[spec.key] = lines[0] ?? ''
    else next[spec.key] = lines
  }
  return Object.keys(next).length > 0 ? next : null
}

/**
 * Text for switching a structured entry to plain text: its values in form
 * order, list items as `- item` lines, separated by blank lines.
 */
export function structuredToText(entry: Structured, kind: EntryKind): string {
  const parts: string[] = []
  for (const spec of STRUCTURED_KEYS[kind]) {
    const value = entry[spec.key]
    if (value === undefined) continue
    if (Array.isArray(value)) {
      const items = value.filter(item => item.trim() !== '')
      if (items.length > 0)
        parts.push(items.map(item => `- ${item}`).join('\n'))
    } else if (value.trim() !== '') {
      parts.push(value)
    }
  }
  return parts.join('\n\n')
}

/** The structured object for switching plain text to the form. */
export function textToStructured(text: string, kind: EntryKind): Structured {
  if (text.trim() === '') return {}
  const [first] = STRUCTURED_KEYS[kind]
  return first ? { [first.key]: text } : {}
}

/** Pretty JSON for the raw editor. */
export const entryToJson = (entry: EntryType | null | undefined): string =>
  entry === null || entry === undefined ? '' : JSON.stringify(entry, null, 2)

export type ParsedEntry =
  | { ok: true; entry: EntryType | null }
  | { ok: false; error: string }

/**
 * The raw editor's text as an entry: blank is `null` (no entry), anything
 * else must be JSON — a non-empty string, an object or an array.
 */
export function parseEntryJson(text: string): ParsedEntry {
  if (text.trim() === '') return { ok: true, entry: null }
  let value: JsonValue
  try {
    value = JSON.parse(text) as JsonValue
  } catch {
    return { ok: false, error: 'JSON no válido' }
  }
  if (typeof value === 'string') {
    return value.length > 0
      ? { ok: true, entry: value }
      : { ok: false, error: 'El texto no puede estar vacío' }
  }
  if (value !== null && typeof value === 'object') {
    return { ok: true, entry: value as EntryType }
  }
  return {
    ok: false,
    error: 'Usa un texto entre comillas, un objeto {…} o una lista […]'
  }
}

/** Whether an entry is blank (nothing Jev would read). */
export const isBlankEntry = (entry: EntryType | null | undefined): boolean =>
  entry === null ||
  entry === undefined ||
  (typeof entry === 'string' && entry.trim() === '')

/** Inserts `snippet` into `text` replacing `[start, end)`; returns the new text and caret. */
export function insertAt(
  text: string,
  snippet: string,
  start: number,
  end: number = start
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  return {
    text: text.slice(0, from) + snippet + text.slice(to),
    caret: from + snippet.length
  }
}
