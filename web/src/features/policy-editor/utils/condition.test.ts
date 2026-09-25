import { describe, expect, it } from 'vitest'
import type {
  Comparison,
  Condition
} from '#/features/templates/types/definition'
import {
  conditionDepth,
  defaultComparison,
  defaultGroup,
  isGroup,
  rightOperands,
  withRight
} from './condition'

describe('conditionDepth()', () => {
  it('is 1 for a bare comparison', () => {
    expect(conditionDepth(defaultComparison())).toBe(1)
  })

  it('adds 1 per nested all/any/not', () => {
    const condition: Condition = {
      all: [{ any: [{ not: defaultComparison() }] }]
    }
    expect(conditionDepth(condition)).toBe(4)
  })

  it('is 1 for an empty group (a catch-all)', () => {
    expect(conditionDepth({ all: [] })).toBe(1)
    expect(conditionDepth({ any: [] })).toBe(1)
  })

  it('takes the deepest branch, not the first', () => {
    const condition: Condition = {
      all: [defaultComparison(), { any: [{ not: defaultComparison() }] }]
    }
    expect(conditionDepth(condition)).toBe(4)
  })
})

describe('rightOperands()', () => {
  it('is empty for exists', () => {
    expect(rightOperands({ op: 'exists', left: { value: 1 } })).toEqual([])
  })

  it('wraps a single right operand in a list', () => {
    const comparison: Comparison = {
      op: 'eq',
      left: { value: 1 },
      right: { value: 2 }
    }
    expect(rightOperands(comparison)).toEqual([{ value: 2 }])
  })

  it('passes an array right through', () => {
    const comparison: Comparison = {
      op: 'between',
      left: { value: 1 },
      right: [{ value: 0 }, { value: 10 }]
    }
    expect(rightOperands(comparison)).toEqual([{ value: 0 }, { value: 10 }])
  })
})

describe('withRight()', () => {
  it('drops the right side for exists', () => {
    const comparison: Comparison = {
      op: 'exists',
      left: { value: 1 },
      right: { value: 2 }
    }
    expect(withRight(comparison, [{ value: 9 }])).toEqual({
      op: 'exists',
      left: { value: 1 }
    })
  })

  it('keeps a list for in/between', () => {
    const comparison: Comparison = { op: 'in', left: { value: 1 } }
    expect(withRight(comparison, [{ value: 'a' }, { value: 'b' }])).toEqual({
      op: 'in',
      left: { value: 1 },
      right: [{ value: 'a' }, { value: 'b' }]
    })
  })

  it('takes only the first operand for a scalar operator', () => {
    const comparison: Comparison = { op: 'eq', left: { value: 1 } }
    expect(withRight(comparison, [{ value: 'a' }, { value: 'b' }])).toEqual({
      op: 'eq',
      left: { value: 1 },
      right: { value: 'a' }
    })
  })

  it('clears the right side when given no operands', () => {
    const comparison: Comparison = {
      op: 'eq',
      left: { value: 1 },
      right: { value: 2 }
    }
    expect(withRight(comparison, [])).toEqual({
      op: 'eq',
      left: { value: 1 },
      right: undefined
    })
  })
})

describe('defaultGroup() / isGroup()', () => {
  it('builds an empty all/any group', () => {
    expect(defaultGroup('all')).toEqual({ all: [] })
    expect(defaultGroup('any')).toEqual({ any: [] })
    expect(defaultGroup()).toEqual({ all: [] })
  })

  it('recognizes groups but not comparisons or not', () => {
    expect(isGroup({ all: [] })).toBe(true)
    expect(isGroup({ any: [] })).toBe(true)
    expect(isGroup({ not: defaultComparison() })).toBe(false)
    expect(isGroup(defaultComparison())).toBe(false)
  })
})
