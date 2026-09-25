/**
 * Confidence is always computed by Liro from the provider's probabilities —
 * never taken from the provider — so it means the same thing on every
 * provider. The formulas are Jev's own, which keeps the numbers identical to
 * what TypeSafe's API reports natively.
 */

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/** A usable weight: finite and positive, anything else (negative, NaN, ±∞, non-numbers) counts as 0. */
function weightOf(probabilities: Record<string, number>, key: string): number {
  const value: unknown = Object.hasOwn(probabilities, key)
    ? probabilities[key]
    : undefined
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

const total = (entries: readonly (readonly [string, number])[]) =>
  entries.reduce((sum, [, weight]) => sum + weight, 0)

/**
 * A complete distribution over exactly `keys` (in that order): missing keys
 * get 0, keys outside `keys` are dropped and unusable weights count as 0,
 * then everything is divided by the sum. `null` when nothing usable is left
 * (the provider sent no evidence, or no map at all), which the engine treats
 * as "no confidence".
 */
export function normalizeProbabilities(
  probabilities: Record<string, number>,
  keys: readonly string[]
): Record<string, number> | null {
  // Not a map at all (only reachable through a cast): no evidence.
  if (typeof probabilities !== 'object' || probabilities === null) return null
  let entries = [...new Set(keys)].map(
    key => [key, weightOf(probabilities, key)] as const
  )
  let sum = total(entries)

  // Finite weights whose sum overflows: rescale by the largest one first.
  if (sum === Number.POSITIVE_INFINITY) {
    const max = entries.reduce((best, [, weight]) => Math.max(best, weight), 0)
    entries = entries.map(([key, weight]) => [key, weight / max] as const)
    sum = total(entries)
  }
  if (!(sum > 0)) return null

  return Object.fromEntries(entries.map(([key, weight]) => [key, weight / sum]))
}

/**
 * Confidence of a Choice/Score distribution: `(K·p_max − 1)/(K − 1)`, i.e.
 * how far the top option stands above a uniform guess (0) towards certainty
 * (1). K is the number of keys, so pass the complete, normalized distribution
 * (see `normalizeProbabilities`). E.g. p_max 0.61 over 3 options → 0.415.
 * Clamped to [0, 1]; fewer than two options leave nothing to doubt → 1.
 */
export function distributionConfidence(
  probabilities: Record<string, number>
): number {
  const values = Object.values(probabilities)
  const k = values.length
  if (k < 2) return 1

  const max = values.reduce(
    (best, p) => (Number.isFinite(p) ? Math.max(best, p) : best),
    0
  )
  return clamp((k * max - 1) / (k - 1), 0, 1)
}

/**
 * Confidence of a boolean answer: `|2p − 1|`, i.e. how far P(true) is from a
 * coin flip, in either direction. `p` is clamped to [0, 1] first (NaN stays
 * NaN: `resolveAnswer` rejects it before it gets here).
 */
export function booleanConfidence(probability: number): number {
  return Math.abs(2 * clamp(probability, 0, 1) - 1)
}
