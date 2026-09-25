export type QueryValue = string | number | boolean | null | undefined

/**
 * `path` with `params` appended as a query string. `undefined`, `null` and
 * `''` values are left out, so optional filters can be passed as they are.
 */
export function withQuery(
  path: string,
  params: Readonly<Record<string, QueryValue>> = {}
): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }

  const queryString = query.toString()
  if (!queryString) return path

  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`
}

/** A path segment, URL-encoded (ids and refs such as `slug@1.2`). */
export const segment = (value: string): string => encodeURIComponent(value)
