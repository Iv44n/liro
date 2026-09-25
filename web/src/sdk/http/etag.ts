/**
 * The opaque value of an `ETag` header (`"abc"`, `W/"abc"` or bare `abc` →
 * `abc`); `null` when absent or empty.
 */
export function parseEntityTag(
  header: string | null | undefined
): string | null {
  const value = header?.trim()
  if (!value) return null

  const match = /^(?:W\/)?"(.*)"$/.exec(value)
  const tag = match ? match[1] : value
  return tag ? tag : null
}

/** An `If-Match` value for `tag`: quoted, unless it already is (strong or weak). */
export function formatEntityTag(tag: string): string {
  const value = tag.trim()
  return /^(?:W\/)?".*"$/.test(value) ? value : `"${value}"`
}
