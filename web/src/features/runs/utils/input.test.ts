import { describe, expect, it } from 'vitest'
import {
  flattenInput,
  inputPreview,
  inputValueText,
  isBlockValue
} from './input'

describe('flattenInput()', () => {
  it('flattens nested objects into dotted paths', () => {
    expect(
      flattenInput({
        message: 'Hola',
        customer: { name: 'Ana', address: { city: 'Lima' } },
        tags: ['a', 'b'],
        extra: {},
        amount: 12.5
      })
    ).toEqual([
      { path: 'message', value: 'Hola' },
      { path: 'customer.name', value: 'Ana' },
      { path: 'customer.address.city', value: 'Lima' },
      { path: 'tags', value: ['a', 'b'] },
      { path: 'extra', value: {} },
      { path: 'amount', value: 12.5 }
    ])
  })

  it('returns nothing for a missing input', () => {
    expect(flattenInput(null)).toEqual([])
  })
})

describe('isBlockValue()', () => {
  it('detects long text and JSON values', () => {
    expect(isBlockValue('corto')).toBe(false)
    expect(isBlockValue('línea 1\nlínea 2')).toBe(true)
    expect(isBlockValue('x'.repeat(81))).toBe(true)
    expect(isBlockValue(['a'])).toBe(true)
    expect(isBlockValue(3)).toBe(false)
    expect(isBlockValue(null)).toBe(false)
  })
})

describe('inputPreview()', () => {
  it('uses the first non-empty text, collapsed and cut', () => {
    expect(
      inputPreview({
        amount: 3,
        subject: '   ',
        body: { text: 'Hola,\n\n  necesito   ayuda' }
      })
    ).toBe('Hola, necesito ayuda')
    expect(inputPreview({ message: 'x'.repeat(200) }, 10)).toBe(
      `${'x'.repeat(9)}…`
    )
  })

  it('is null without text values', () => {
    expect(inputPreview({ amount: 3 })).toBeNull()
    expect(inputPreview(null)).toBeNull()
  })
})

describe('inputValueText()', () => {
  it('prints strings raw and the rest as JSON', () => {
    expect(inputValueText('hola')).toBe('hola')
    expect(inputValueText(true)).toBe('true')
    expect(inputValueText(null)).toBe('null')
    expect(inputValueText(4)).toBe('4')
    expect(inputValueText({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})
