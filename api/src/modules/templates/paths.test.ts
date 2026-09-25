import { describe, expect, test } from 'bun:test'
import {
  getPath,
  isPathPrefix,
  type JsonObject,
  omitPaths,
  pickPaths,
  setPath
} from './paths'

describe('paths', () => {
  const input: JsonObject = {
    ticket: { message: 'hi', meta: { tags: ['a'] } },
    plan: 'pro'
  }

  test('getPath reads own properties only', () => {
    expect(getPath(input, 'ticket.message')).toBe('hi')
    expect(getPath(input, 'ticket.missing')).toBeUndefined()
    expect(getPath(input, 'plan.length')).toBeUndefined()
    expect(getPath(input, 'constructor')).toBeUndefined()
  })

  test('pickPaths copies only the requested paths, deeply', () => {
    const picked = pickPaths(input, ['ticket.meta.tags', 'nope.x'])
    expect(picked).toEqual({ ticket: { meta: { tags: ['a'] } } })
    ;(picked.ticket as JsonObject).meta = null
    expect(input.ticket).toEqual({ message: 'hi', meta: { tags: ['a'] } })
  })

  test('omitPaths removes paths from a copy', () => {
    expect(omitPaths(input, ['ticket.meta', 'plan', 'x.y'])).toEqual({
      ticket: { message: 'hi' }
    })
    expect(input.plan).toBe('pro')
  })

  test('isPathPrefix', () => {
    expect(isPathPrefix('a', 'a.b')).toBe(true)
    expect(isPathPrefix('a', 'a')).toBe(true)
    expect(isPathPrefix('a', 'ab')).toBe(false)
  })

  test('never pollutes Object.prototype through __proto__ segments', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":"yes"}}') as JsonObject
    const picked = pickPaths(hostile, ['__proto__.polluted'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(picked)).toBe(Object.prototype)

    const target: JsonObject = {}
    setPath(target, '__proto__.polluted', 'yes')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.hasOwn(target, '__proto__')).toBe(true)

    omitPaths({}, ['__proto__.hasOwnProperty'])
    expect(typeof Object.prototype.hasOwnProperty).toBe('function')
  })
})
