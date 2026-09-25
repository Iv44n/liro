import z from 'zod'
import type { JsonValue } from '#modules/engine/evaluator/port'
import {
  type InputField,
  policyInputPaths,
  type TemplateDefinition
} from './definition'
import { type JsonObject, omitPaths, pickPaths } from './paths'
import type { StoreInputMode } from './templates.schemas'

/**
 * A template's input contract (`definition.input.fields`, one leaf dot path
 * per field) turned into what the rest of the platform needs: the zod
 * validator a run's input goes through, the JSON Schema published to callers,
 * the parts of an input a run stores, and an example payload.
 */

/**
 * Any JSON value — what `z.json()` accepts — but registered under an id, so
 * the published JSON Schema references `#/$defs/JsonValue` instead of an
 * anonymous `__schema0`.
 */
const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  .meta({ id: 'JsonValue' })

const DATETIME_MESSAGE =
  'Expected an ISO 8601 date (2026-01-01) or date-time with offset (2026-01-01T00:00:00Z)'

/** What `sampleInput` puts in `datetime` fields. */
export const SAMPLE_DATETIME = '2026-01-01T00:00:00Z'

// ── Reserved names ───────────────────────────────────────────────────────

/**
 * `Object.prototype` member names (`__proto__`, `constructor`, `toString`, …).
 * `pathSchema` rejects them; this is defense in depth for definitions that
 * skipped validation. None of them works as an input key: zod reads the inherited member for an absent key (so an optional
 * `toString` rejects every input without it) and assigns `__proto__` as the
 * prototype (so a required `__proto__.x` passes on `{}`), and `setPath` /
 * `omitPaths` walk into `Object.prototype` through `__proto__`, polluting or
 * deleting its members. Paths using them are refused outright.
 */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype)
)

/** Throws when `path` has a reserved segment (see `RESERVED_SEGMENTS`). */
function assertUsablePaths(paths: Iterable<string>) {
  for (const path of paths) {
    const reserved = path
      .split('.')
      .find(segment => RESERVED_SEGMENTS.has(segment))
    if (reserved !== undefined) {
      throw new Error(
        `Input path \`${path}\` uses the reserved name \`${reserved}\``
      )
    }
  }
}

// ── Field tree ───────────────────────────────────────────────────────────

type FieldNode =
  | { kind: 'field'; field: InputField }
  | { kind: 'object'; children: FieldTree }

type FieldTree = Map<string, FieldNode>

/**
 * Nests the leaf paths into objects, keeping first-seen order. Throws on a
 * duplicate path or a path that is both a field and a parent of another
 * (`a` and `a.b`) — lint reports both before a version can be published —
 * and on a reserved segment (`RESERVED_SEGMENTS`).
 */
function fieldTree(fields: readonly InputField[]): FieldTree {
  assertUsablePaths(fields.map(field => field.path))
  const root: FieldTree = new Map()
  for (const field of fields) {
    const segments = field.path.split('.')
    let level = root
    for (const [index, segment] of segments.entries()) {
      const at = segments.slice(0, index + 1).join('.')
      const existing = level.get(segment)
      const isLeaf = index === segments.length - 1

      if (existing?.kind === 'field') {
        throw new Error(
          isLeaf
            ? `Duplicate input field \`${at}\``
            : `Input field \`${at}\` is also the parent of \`${field.path}\``
        )
      }
      if (isLeaf) {
        if (existing) {
          throw new Error(
            `Input field \`${at}\` is also the parent of other fields`
          )
        }
        level.set(segment, { kind: 'field', field })
      } else if (existing) {
        level = existing.children
      } else {
        const children: FieldTree = new Map()
        level.set(segment, { kind: 'object', children })
        level = children
      }
    }
  }
  return root
}

// ── Validator ────────────────────────────────────────────────────────────

function fieldTypeSchema(field: InputField): z.ZodType {
  switch (field.type) {
    case 'string':
      return field.maxLength === undefined
        ? z.string()
        : z.string().max(field.maxLength)
    case 'number':
      // zod 4 numbers are finite: NaN and ±Infinity are rejected.
      return z.number()
    case 'integer':
      return z.int()
    case 'boolean':
      return z.boolean()
    case 'datetime':
      return z.union([z.iso.datetime({ offset: true }), z.iso.date()], {
        error: DATETIME_MESSAGE
      })
    case 'enum':
      // The definition schema requires values; none would accept nothing.
      return z.enum(field.enum ?? [])
    case 'array':
      return z.array(jsonValueSchema)
    case 'object':
      return z.record(z.string(), jsonValueSchema)
  }
}

function fieldSchema(field: InputField): z.ZodType {
  const schema = fieldTypeSchema(field)
  return field.description === undefined
    ? schema
    : schema.describe(field.description)
}

/** A node's schema, and whether it is required (a parent is iff any descendant is). */
function nodeSchema(node: FieldNode): { schema: z.ZodType; required: boolean } {
  if (node.kind === 'field') {
    return { schema: fieldSchema(node.field), required: node.field.required }
  }
  return objectSchema(node.children)
}

function objectSchema(children: FieldTree): {
  schema: z.ZodObject
  required: boolean
} {
  let required = false
  const shape = [...children].map(([key, child]) => {
    const built = nodeSchema(child)
    required ||= built.required
    return [key, built.required ? built.schema : built.schema.optional()]
  })
  // `z.object` strips unknown keys.
  return { schema: z.object(Object.fromEntries(shape)), required }
}

/**
 * The validator for a run's input. Parents of dot paths are objects, required
 * iff any descendant field is. Unknown keys are stripped (at every level, but
 * not inside `object`/`array` fields, which take any JSON). Optional fields
 * may be absent, but `null` is rejected for every declared field and parent.
 * Throws `Error` on conflicting or reserved paths (see `fieldTree`).
 */
export function buildInputValidator(
  fields: readonly InputField[]
): z.ZodType<JsonObject> {
  return objectSchema(fieldTree(fields)).schema as z.ZodType<JsonObject>
}

/**
 * The input's JSON Schema (draft 2020-12), as published to callers and used
 * for SDK codegen. It describes what callers may *send*: objects carry no
 * `additionalProperties: false`, because unknown keys are accepted and
 * stripped rather than rejected. Field descriptions are included. The same
 * fields always produce the same schema, with properties in field order.
 */
export function inputJsonSchema(
  fields: readonly InputField[]
): Record<string, unknown> {
  return z.toJSONSchema(buildInputValidator(fields), {
    target: 'draft-2020-12',
    io: 'input'
  }) as Record<string, unknown>
}

// ── Stored views of an input ─────────────────────────────────────────────

/**
 * The input paths the policy reads, always stored with a run (pii included)
 * so it can be replayed after the full input is purged. Throws on a reserved
 * path segment, which `pickPaths` would follow into `Object.prototype`.
 */
export function policyInputOf(
  definition: TemplateDefinition,
  input: JsonObject
): JsonObject {
  const paths = policyInputPaths(definition)
  assertUsablePaths(paths)
  return pickPaths(input, paths)
}

function piiPaths(definition: TemplateDefinition): string[] {
  const paths = definition.input.fields
    .filter(field => field.pii)
    .map(field => field.path)
  // `omitPaths` would delete `Object.prototype` members through `__proto__`.
  assertUsablePaths(paths)
  return paths
}

/**
 * What a run keeps as its `input`, per the template's `storeInput`: the whole
 * input or only its policy paths — minus every `pii` field either way — or
 * nothing. Never mutates `input`. Throws on a reserved path segment or an
 * unknown mode, rather than store what it should not.
 */
export function storedInputOf(
  definition: TemplateDefinition,
  input: JsonObject,
  mode: StoreInputMode
): JsonObject | null {
  switch (mode) {
    case 'full':
      return omitPaths(input, piiPaths(definition))
    case 'policy':
      return omitPaths(policyInputOf(definition, input), piiPaths(definition))
    case 'none':
      return null
    default:
      throw new Error(`Unknown storeInput mode \`${String(mode)}\``)
  }
}

// ── Sample ───────────────────────────────────────────────────────────────

/** `ticket.customerName` → `Example ticket customer name`. */
function sampleText(path: string): string {
  const words = path
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[._\s]+/)
    .filter(Boolean)
    .map(word => word.toLowerCase())
  return ['Example', ...words].join(' ')
}

function sampleValue(field: InputField): JsonValue {
  switch (field.type) {
    case 'string':
      return sampleText(field.path).slice(0, field.maxLength)
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'datetime':
      return SAMPLE_DATETIME
    case 'enum':
      return field.enum?.[0] ?? ''
    case 'array':
      return []
    case 'object':
      return {}
  }
}

function sampleOf(tree: FieldTree): JsonObject {
  return Object.fromEntries(
    [...tree].map(([key, node]) => [
      key,
      node.kind === 'field' ? sampleValue(node.field) : sampleOf(node.children)
    ])
  )
}

/**
 * An example input for the Integrate tab and curl snippets: every field,
 * required or not, with a plausible value that passes `buildInputValidator`
 * (strings are derived from the path and fit `maxLength`). Throws on
 * conflicting or reserved paths, like the validator.
 */
export function sampleInput(fields: readonly InputField[]): JsonObject {
  return sampleOf(fieldTree(fields))
}
