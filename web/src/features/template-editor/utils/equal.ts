/**
 * Structural equality of JSON-like values, the way they travel over the wire:
 * an object property holding `undefined` counts as absent (JSON drops it), so
 * `{ description: undefined }` equals `{}`. Object key order is ignored;
 * array order is not.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false

  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false

  if (aIsArray) {
    const left = a as unknown[]
    const right = b as unknown[]
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    )
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = definedKeys(left)
  const rightKeys = definedKeys(right)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every(
    key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key])
  )
}

const definedKeys = (value: Record<string, unknown>): string[] =>
  Object.keys(value).filter(key => value[key] !== undefined)

/**
 * `value` without its `undefined` properties (recursively), i.e. what
 * `JSON.parse(JSON.stringify(value))` would give for plain JSON data.
 */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => withoutUndefined(item)) as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = withoutUndefined(item)
    }
    return result as T
  }
  return value
}
