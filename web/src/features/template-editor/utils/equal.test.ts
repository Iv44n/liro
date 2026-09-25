import { describe, expect, it } from 'vitest'
import { jsonEqual, withoutUndefined } from './equal'

describe('jsonEqual()', () => {
  it('treats an undefined property as absent', () => {
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('ignores object key order, but not array order', () => {
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(jsonEqual([1, 2], [2, 1])).toBe(false)
  })

  it('compares nested structures recursively', () => {
    expect(
      jsonEqual({ a: [{ x: 1 }, { y: 2 }] }, { a: [{ x: 1 }, { y: 2 }] })
    ).toBe(true)
    expect(jsonEqual({ a: [{ x: 1 }] }, { a: [{ x: 2 }] })).toBe(false)
  })

  it('null is not an object, and is not equal to a missing value', () => {
    expect(jsonEqual(null, {})).toBe(false)
    expect(jsonEqual({ a: null }, {})).toBe(false)
  })

  it('an array is never equal to an object', () => {
    expect(jsonEqual([], {})).toBe(false)
  })
})

describe('withoutUndefined()', () => {
  it('drops undefined properties recursively, keeping everything else', () => {
    expect(
      withoutUndefined({ a: 1, b: undefined, c: { d: undefined, e: 2 } })
    ).toEqual({
      a: 1,
      c: { e: 2 }
    })
  })

  it('keeps array order and items (including nested undefineds inside objects)', () => {
    expect(withoutUndefined([{ a: undefined, b: 1 }, 2])).toEqual([{ b: 1 }, 2])
  })
})
