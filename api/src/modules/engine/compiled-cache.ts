import type z from 'zod'
import {
  decisionLabels,
  policyInputPaths,
  type TemplateDefinition
} from '#modules/templates/definition'
import { buildInputValidator } from '#modules/templates/input-schema'
import type { JsonObject } from '#modules/templates/paths'
import { ApiError } from '#shared/http/errors'

/**
 * What the executor needs from a version, derived once per definition: the
 * zod validator of its input contract (building it walks every field), the
 * policy's input paths and the decision labels. Versions are immutable and a
 * draft's content is identified by its hash, so `${id}:${definitionHash}` is
 * a safe key — an edited draft simply compiles under a new one.
 */
export interface CompiledVersion {
  definition: TemplateDefinition
  /**
   * The input with unknown keys stripped; throws `422 VALIDATION_FAILED`
   * (issue paths prefixed `input.`) when it breaks the contract, holds a NUL
   * or nests deeper than `MAX_JSON_DEPTH` (see `storableJsonIssues`).
   */
  validateInput(input: unknown): JsonObject
  /** Input paths the policy reads (`policyInputPaths`). */
  policyPaths: string[]
  /** Declared decision labels, `needs_review` excluded. */
  labels: string[]
  /** Declared input field paths, in definition order. */
  fieldPaths: string[]
}

export interface CompilableVersion {
  id: string
  definitionHash: string
  definition: TemplateDefinition
}

/** Entries kept by `compileVersion`. */
export const COMPILED_CACHE_SIZE = 500

// ── Storable JSON ────────────────────────────────────────────────────────

/** Levels of objects/arrays a run's `input` or `metadata` may nest. */
export const MAX_JSON_DEPTH = 64

/** Problems `storableJsonIssues` reports at most (one oversized body could hold millions). */
const MAX_JSON_ISSUES = 10

export const NUL_MESSAGE = 'Must not contain NUL characters'
const NUL_KEY_MESSAGE = 'Keys must not contain NUL characters'

export interface JsonIssue {
  path: (string | number)[]
  message: string
}

/**
 * What would make a parsed JSON value fail AFTER the evaluator was called,
 * checked up front: a NUL (`\u0000`) in any string or key (Postgres
 * `text`/`jsonb` can't store one, so persisting the run would fail) and
 * nesting deeper than `maxDepth` (zod's recursive JSON schemas, `hashJson`
 * and `JSON.stringify` recurse, and would overflow the stack). The walk is
 * iterative, so any depth is safe to inspect. Returns at most
 * `MAX_JSON_ISSUES` issues, `[]` when the value can be stored.
 */
export function storableJsonIssues(
  value: unknown,
  maxDepth = MAX_JSON_DEPTH
): JsonIssue[] {
  const issues: JsonIssue[] = []
  const pending: { value: unknown; path: (string | number)[] }[] = [
    { value, path: [] }
  ]
  const tooDeep = `Must not nest objects or arrays more than ${maxDepth} levels deep`

  while (pending.length > 0 && issues.length < MAX_JSON_ISSUES) {
    const next = pending.pop()
    if (!next) break
    const { value: current, path } = next
    if (typeof current === 'string') {
      if (current.includes('\u0000'))
        issues.push({ path, message: NUL_MESSAGE })
      continue
    }
    if (typeof current !== 'object' || current === null) continue
    if (path.length >= maxDepth) {
      issues.push({ path, message: tooDeep })
      continue
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        pending.push({ value: current[index], path: [...path, index] })
      }
      continue
    }
    const entries = Object.entries(current)
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, item] = entries[index] as [string, unknown]
      if (key.includes('\u0000')) {
        issues.push({ path, message: NUL_KEY_MESSAGE })
        continue
      }
      pending.push({ value: item, path: [...path, key] })
    }
  }
  return issues
}

/**
 * `storableJsonIssues` as a zod check (`.superRefine(refineStorableJson)`),
 * for request schemas that must refuse such values before anything else
 * reads them — hashing an idempotency key included.
 */
export function refineStorableJson(value: unknown, ctx: z.RefinementCtx): void {
  for (const issue of storableJsonIssues(value)) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
}

/** `422 VALIDATION_FAILED` for `storableJsonIssues`, paths under `prefix`. */
function unstorable(prefix: string, issues: JsonIssue[]): ApiError {
  return new ApiError(422, 'VALIDATION_FAILED', 'Input validation failed', {
    details: {
      issues: issues.map(issue => ({
        path: [prefix, ...issue.path.map(String)].join('.'),
        message: issue.message,
        code: 'custom'
      }))
    }
  })
}

/**
 * A least-recently-used map: reads refresh an entry, and inserting past
 * `capacity` evicts the entry that went unused the longest. Relies on `Map`
 * iterating in insertion order.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>()

  constructor(readonly capacity: number) {
    if (!(capacity >= 1)) {
      throw new RangeError(`capacity must be at least 1 (got ${capacity})`)
    }
  }

  get size(): number {
    return this.entries.size
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined
    const value = this.entries.get(key) as V
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  has(key: K): boolean {
    return this.entries.has(key)
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

const cache = new LruCache<string, CompiledVersion>(COMPILED_CACHE_SIZE)

/** Drops every compiled version (tests; a deploy restarts the process anyway). */
export function clearCompiledCache(): void {
  cache.clear()
}

/**
 * The compiled form of a version (or draft), memoized per
 * `${id}:${definitionHash}`. Throws `422 TEMPLATE_INVALID` when the input
 * contract can't be built (conflicting field paths — lint blocks those
 * before publishing, so only an unlinted definition gets here); failures are
 * not cached.
 */
export function compileVersion(version: CompilableVersion): CompiledVersion {
  const key = `${version.id}:${version.definitionHash}`
  const cached = cache.get(key)
  if (cached) return cached

  const compiled = compile(version.definition)
  cache.set(key, compiled)
  return compiled
}

function compile(definition: TemplateDefinition): CompiledVersion {
  let validator: z.ZodType<JsonObject>
  try {
    validator = buildInputValidator(definition.input.fields)
  } catch (error) {
    throw new ApiError(
      422,
      'TEMPLATE_INVALID',
      `The template's input contract is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return {
    definition,
    validateInput(input) {
      // Before zod: its JSON schema for `object`/`array` fields recurses.
      const issues = storableJsonIssues(input)
      if (issues.length > 0) throw unstorable('input', issues)
      const result = validator.safeParse(input)
      if (result.success) return result.data
      throw new ApiError(422, 'VALIDATION_FAILED', 'Input validation failed', {
        details: {
          issues: result.error.issues.map(issue => ({
            path: ['input', ...issue.path.map(String)].join('.'),
            message: issue.message,
            code: issue.code
          }))
        }
      })
    },
    policyPaths: policyInputPaths(definition),
    labels: decisionLabels(definition),
    fieldPaths: definition.input.fields.map(field => field.path)
  }
}
