import {
  type Comparison,
  type Condition,
  DEFINITION_LIMITS,
  isComparison,
  type Operand
} from '#/features/templates/types/definition'

/**
 * Small, generic helpers over the `Condition`/`Comparison` shapes that the
 * visual builder needs but that don't belong to any one component — the
 * "condition ↔ UI model" side of the builder (the API's DSL *is* the
 * model; these just adapt its edges for editing: a `right` that's sometimes
 * one operand and sometimes a list, and depth bookkeeping).
 */

/** Maximum nesting depth of a condition (a bare comparison is 1) — mirrors the API's `conditionDepth`. */
export function conditionDepth(condition: Condition): number {
  if ('all' in condition) {
    return 1 + Math.max(0, ...condition.all.map(conditionDepth))
  }
  if ('any' in condition) {
    return 1 + Math.max(0, ...condition.any.map(conditionDepth))
  }
  if ('not' in condition) return 1 + conditionDepth(condition.not)
  return 1
}

export const MAX_CONDITION_DEPTH: number = DEFINITION_LIMITS.conditionDepth

/** A comparison's right-hand side, always as a list (`[]` for `exists`). */
export function rightOperands(comparison: Comparison): Operand[] {
  const { right } = comparison
  if (right === undefined) return []
  return Array.isArray(right) ? right : [right]
}

/**
 * `comparison` with its right-hand side set to `operands`, respecting what
 * `comparison.op` accepts: none for `exists`, a list for `in`/`between`, a
 * single operand otherwise (the first of `operands`).
 */
export function withRight(
  comparison: Comparison,
  operands: Operand[]
): Comparison {
  if (comparison.op === 'exists') {
    const { right: _right, ...rest } = comparison
    return rest
  }
  if (comparison.op === 'in' || comparison.op === 'between') {
    return { ...comparison, right: operands }
  }
  const [first] = operands
  return first === undefined
    ? { ...comparison, right: undefined }
    : { ...comparison, right: first }
}

export const defaultOperand = (): Operand => ({ value: '' })

export const defaultComparison = (): Comparison => ({
  op: 'exists',
  left: defaultOperand()
})

export const defaultGroup = (kind: 'all' | 'any' = 'all'): Condition =>
  kind === 'all' ? { all: [] } : { any: [] }

/** Whether `condition` is a group (`all`/`any`), as opposed to a comparison or `not`. */
export function isGroup(
  condition: Condition
): condition is { all: Condition[] } | { any: Condition[] } {
  return 'all' in condition || 'any' in condition
}

export { isComparison }
