import { describe, expect, test } from 'bun:test'
import { canonicalJson, hashJson, sha256Hex } from './hash'

describe('canonical hashing', () => {
  test('key order and undefined members do not change the JSON', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })
    ).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}')
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  test('equal values hash equally; different values differently', () => {
    expect(hashJson({ a: 1, b: [1, 2] })).toBe(hashJson({ b: [1, 2], a: 1 }))
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }))
  })

  test('sha256Hex matches a known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
