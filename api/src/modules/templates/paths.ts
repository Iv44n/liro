import type { JsonValue } from '#modules/engine/evaluator/port'

/**
 * Dot paths into a run's input (`ticket.message`). Only plain objects are
 * traversed: array indexes are not part of the path syntax.
 */

export type JsonObject = { [key: string]: JsonValue }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value at `path`, or `undefined` when any segment is missing. */
export function getPath(value: unknown, path: string): JsonValue | undefined {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current as JsonValue
}

/** Defines an own, enumerable property — never invokes a `__proto__` setter. */
function define(target: JsonObject, key: string, value: JsonValue) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  })
}

/**
 * Sets `path` on `target`, creating intermediate objects. Only own properties
 * are followed, so a `__proto__`/`constructor` segment can't reach a prototype.
 */
export function setPath(target: JsonObject, path: string, value: JsonValue) {
  const segments = path.split('.')
  const last = segments.pop() as string
  let current = target
  for (const segment of segments) {
    const next = Object.hasOwn(current, segment) ? current[segment] : undefined
    if (!isObject(next)) define(current, segment, {})
    current = current[segment] as JsonObject
  }
  define(current, last, value)
}

/** A new object with only `paths` copied from `value` (missing paths are skipped). */
export function pickPaths(value: unknown, paths: Iterable<string>): JsonObject {
  const picked: JsonObject = {}
  for (const path of paths) {
    const found = getPath(value, path)
    if (found !== undefined) setPath(picked, path, structuredClone(found))
  }
  return picked
}

/** A deep copy of `value` without `paths`. */
export function omitPaths(
  value: JsonObject,
  paths: Iterable<string>
): JsonObject {
  const copy = structuredClone(value)
  for (const path of paths) {
    const segments = path.split('.')
    const last = segments.pop() as string
    let current: unknown = copy
    for (const segment of segments) {
      current =
        isObject(current) && Object.hasOwn(current, segment)
          ? current[segment]
          : undefined
    }
    if (isObject(current) && Object.hasOwn(current, last)) delete current[last]
  }
  return copy
}

/** Whether `ancestor` is `path` itself or one of its parents (`a` of `a.b`). */
export function isPathPrefix(ancestor: string, path: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}.`)
}
