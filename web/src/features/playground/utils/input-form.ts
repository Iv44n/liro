import z from 'zod'
import type {
  InputField,
  JsonObject,
  JsonValue
} from '#/features/templates/types/definition'

/**
 * The playground's input form, generated from `definition.input.fields`.
 * Values are kept per field path, as the raw text the user typed (or a
 * boolean for switches), so the form survives the editor adding, removing or
 * retyping fields. `buildInput` turns them into the nested JSON the API
 * expects (`ticket.message` → `{ ticket: { message } }`), with the same rules
 * as the API's input validator and Spanish messages.
 */

/** Raw text for most controls; a boolean (or unset) for switches. */
export type FieldValue = string | boolean | undefined

export type FormValues = Readonly<Record<string, FieldValue>>

export type FieldControl =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | 'enum'
  | 'json'

/** Last path segments that usually hold free text (English and Spanish). */
const LONG_TEXT_NAME =
  /message|text|body|content|description|comment|note|summary|reason|detail|feedback|review|transcript|conversation|prompt|mensaje|texto|cuerpo|contenido|descripcion|comentario|nota|resumen|motivo|detalle|conversacion|resena/i

/** A string field with a `maxLength` above this gets a textarea. */
export const LONG_TEXT_MIN_LENGTH = 200

/** The field's last path segment: `ticket.message` → `message`. */
export const leafName = (path: string): string =>
  path.slice(path.lastIndexOf('.') + 1)

/** Whether a `string` field is likely to hold more than a line of text. */
export function isLongTextField(field: InputField): boolean {
  if (field.type !== 'string') return false
  if (field.maxLength !== undefined) {
    return field.maxLength > LONG_TEXT_MIN_LENGTH
  }
  return LONG_TEXT_NAME.test(leafName(field.path))
}

export function controlOf(field: InputField): FieldControl {
  switch (field.type) {
    case 'string':
      return isLongTextField(field) ? 'textarea' : 'text'
    case 'number':
    case 'integer':
    case 'boolean':
    case 'datetime':
    case 'enum':
      return field.type
    case 'array':
    case 'object':
      return 'json'
  }
}

/** A required switch starts off; everything else starts empty (= not sent). */
function defaultValue(field: InputField): FieldValue {
  if (field.type === 'boolean') return field.required ? false : undefined
  return ''
}

/**
 * The field's current value, coerced to what its control shows: a stale
 * value of another type (the field was retyped) reads as the default.
 */
export function readValue(field: InputField, values: FormValues): FieldValue {
  const raw = values[field.path]
  if (field.type === 'boolean') {
    return typeof raw === 'boolean' ? raw : defaultValue(field)
  }
  return typeof raw === 'string' ? raw : ''
}

// ── Paths ────────────────────────────────────────────────────────────────

const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value at a dot `path` of `input`; `undefined` when absent. */
export function getPath(input: unknown, path: string): unknown {
  let current: unknown = input
  for (const segment of path.split('.')) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

/**
 * Sets `value` at a dot `path`, creating parent objects. A parent that is
 * already a non-object (conflicting fields `a` and `a.b`, which lint
 * rejects) is left alone.
 */
export function setPath(
  target: JsonObject,
  path: string,
  value: JsonValue
): void {
  const segments = path.split('.')
  let level = target
  for (const segment of segments.slice(0, -1)) {
    const next = level[segment]
    if (next === undefined) {
      const created: JsonObject = {}
      level[segment] = created
      level = created
    } else if (isPlainObject(next)) {
      level = next
    } else {
      return
    }
  }
  const leaf = segments[segments.length - 1] as string
  if (level[leaf] === undefined || !isPlainObject(level[leaf])) {
    level[leaf] = value
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────

const datetimeSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date()])

/** What the API accepts in a `datetime` field. */
export const isIsoDatetime = (value: string): boolean =>
  datetimeSchema.safeParse(value).success

export const DATETIME_HINT = 'Fecha ISO 8601: 2026-01-01 o 2026-01-01T09:30:00Z'

type Parsed =
  | { kind: 'missing' }
  | { kind: 'value'; value: JsonValue }
  | { kind: 'error'; message: string }

const invalid = (message: string): Parsed => ({ kind: 'error', message })

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

/** One field's value as JSON, `missing` when empty (= not sent). */
export function parseFieldValue(field: InputField, raw: FieldValue): Parsed {
  if (field.type === 'boolean') {
    return typeof raw === 'boolean'
      ? { kind: 'value', value: raw }
      : { kind: 'missing' }
  }

  const text = typeof raw === 'string' ? raw : ''
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'missing' }

  switch (field.type) {
    case 'string':
      if (field.maxLength !== undefined && text.length > field.maxLength) {
        return invalid(
          `Máximo ${field.maxLength} caracteres (tiene ${text.length}).`
        )
      }
      return { kind: 'value', value: text }
    case 'number': {
      const value = Number(trimmed)
      return Number.isFinite(value)
        ? { kind: 'value', value }
        : invalid('Debe ser un número.')
    }
    case 'integer': {
      const value = Number(trimmed)
      return Number.isInteger(value)
        ? { kind: 'value', value }
        : invalid('Debe ser un número entero.')
    }
    case 'datetime':
      return isIsoDatetime(trimmed)
        ? { kind: 'value', value: trimmed }
        : invalid(`${DATETIME_HINT}.`)
    case 'enum':
      return field.enum?.includes(text)
        ? { kind: 'value', value: text }
        : invalid('Elige uno de los valores permitidos.')
    case 'array': {
      const parsed = parseJson(trimmed)
      if (!parsed.ok) return invalid('JSON inválido.')
      return Array.isArray(parsed.value)
        ? { kind: 'value', value: parsed.value as JsonValue }
        : invalid('Debe ser un array JSON, p. ej. ["a", "b"].')
    }
    case 'object': {
      const parsed = parseJson(trimmed)
      if (!parsed.ok) return invalid('JSON inválido.')
      return isPlainObject(parsed.value)
        ? { kind: 'value', value: parsed.value }
        : invalid('Debe ser un objeto JSON, p. ej. {"clave": "valor"}.')
    }
  }
}

export interface BuiltInput {
  input: JsonObject
  /** Field path → Spanish message; empty when the input is valid. */
  errors: Record<string, string>
}

/**
 * The run input from the form. Empty optional fields are left out (the API
 * rejects `null`); invalid values are reported in `errors` and left out too,
 * so `input` is always the valid part — what the JSON view shows.
 */
export function buildInput(
  fields: readonly InputField[],
  values: FormValues
): BuiltInput {
  const input: JsonObject = {}
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const parsed = parseFieldValue(field, readValue(field, values))
    if (parsed.kind === 'value') {
      setPath(input, field.path, parsed.value)
    } else if (parsed.kind === 'error') {
      errors[field.path] = parsed.message
    } else if (field.required) {
      errors[field.path] = 'Campo obligatorio.'
    }
  }

  return { input, errors }
}

/** The text a control shows for a JSON value read from an input. */
function textOf(field: InputField, value: unknown): FieldValue {
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined
  }
  if (value === undefined || value === null) return ''
  if (field.type === 'array' || field.type === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Form values holding what `input` has at each field's path. */
export function valuesFromInput(
  fields: readonly InputField[],
  input: unknown
): Record<string, FieldValue> {
  return Object.fromEntries(
    fields.map(field => [field.path, textOf(field, getPath(input, field.path))])
  )
}

/**
 * Paths of `input` that no field declares (the API drops them): a declared
 * field ends the walk, and objects are only walked into where a field lies
 * below them.
 */
export function undeclaredPaths(
  fields: readonly InputField[],
  input: unknown
): string[] {
  const declared = new Set(fields.map(field => field.path))
  const parents = new Set(
    fields.flatMap(field =>
      field.path
        .split('.')
        .slice(0, -1)
        .map((_, index, segments) => segments.slice(0, index + 1).join('.'))
    )
  )
  const found: string[] = []

  const walk = (value: unknown, prefix: string) => {
    if (!isPlainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (declared.has(path)) continue
      if (parents.has(path) && isPlainObject(child)) walk(child, path)
      else found.push(path)
    }
  }

  walk(input, '')
  return found
}

// ── Raw JSON ─────────────────────────────────────────────────────────────

export const formatJson = (value: unknown): string =>
  JSON.stringify(value, null, 2)

/** The JSON view's text as an input object, or a Spanish error. */
export function parseInputJson(
  text: string
): { ok: true; input: JsonObject } | { ok: false; error: string } {
  if (text.trim() === '') return { ok: true, input: {} }
  const parsed = parseJson(text)
  if (!parsed.ok) {
    return { ok: false, error: 'El JSON no es válido.' }
  }
  if (!isPlainObject(parsed.value)) {
    return {
      ok: false,
      error: 'La entrada debe ser un objeto JSON, p. ej. {"mensaje": "…"}.'
    }
  }
  return { ok: true, input: parsed.value }
}

// ── Sample ───────────────────────────────────────────────────────────────

/** What `sampleInput` puts in `datetime` fields by default. */
export const SAMPLE_DATETIME = '2026-01-01T00:00:00Z'

/** `new Date()` as an ISO date-time without milliseconds. */
export const isoNow = (now: Date = new Date()): string =>
  now.toISOString().replace(/\.\d{3}Z$/, 'Z')

function sampleValue(field: InputField, datetime: string): JsonValue {
  switch (field.type) {
    case 'string':
      return `Texto de ejemplo para ${field.path}`.slice(0, field.maxLength)
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'datetime':
      return datetime
    case 'enum':
      return field.enum?.[0] ?? ''
    case 'array':
      return []
    case 'object':
      return {}
  }
}

/**
 * An example input with every field, required or not, holding a value that
 * passes the API's validator (like the API's own `sampleInput`, in Spanish).
 */
export function sampleInput(
  fields: readonly InputField[],
  options: { datetime?: string } = {}
): JsonObject {
  const datetime = options.datetime ?? SAMPLE_DATETIME
  const input: JsonObject = {}
  for (const field of fields) {
    setPath(input, field.path, sampleValue(field, datetime))
  }
  return input
}
