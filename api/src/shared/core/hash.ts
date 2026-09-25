/**
 * JSON with object keys sorted recursively, so equal values always serialize
 * (and hash) the same way regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(key => (value as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, sortKeys((value as Record<string, unknown>)[key])])
    )
  }
  return value
}

export function sha256Hex(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

/** `sha256(canonicalJson(value))` — e.g. a definition hash or an idempotency request hash. */
export const hashJson = (value: unknown): string =>
  sha256Hex(canonicalJson(value))
