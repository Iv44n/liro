import { describe, expect, it } from 'vitest'
import type {
  InputField,
  JsonObject
} from '#/features/templates/types/definition'
import {
  buildInput,
  controlOf,
  DATETIME_HINT,
  getPath,
  isIsoDatetime,
  isLongTextField,
  parseFieldValue,
  parseInputJson,
  readValue,
  sampleInput,
  setPath,
  undeclaredPaths,
  valuesFromInput
} from './input-form'

const field = (overrides: Partial<InputField> = {}): InputField => ({
  path: 'text',
  type: 'string',
  required: true,
  ...overrides
})

describe('controlOf() / isLongTextField()', () => {
  it('picks a textarea for likely free text, else a single-line input', () => {
    expect(controlOf(field({ path: 'message' }))).toBe('textarea')
    expect(controlOf(field({ path: 'ticket.description' }))).toBe('textarea')
    expect(controlOf(field({ path: 'name' }))).toBe('text')
  })

  it('a string with a long maxLength is treated as free text regardless of its name', () => {
    expect(isLongTextField(field({ path: 'name', maxLength: 500 }))).toBe(true)
    expect(isLongTextField(field({ path: 'name', maxLength: 50 }))).toBe(false)
  })

  it('maps the rest of the field types to their control', () => {
    expect(controlOf(field({ type: 'number' }))).toBe('number')
    expect(controlOf(field({ type: 'integer' }))).toBe('integer')
    expect(controlOf(field({ type: 'boolean' }))).toBe('boolean')
    expect(controlOf(field({ type: 'datetime' }))).toBe('datetime')
    expect(controlOf(field({ type: 'enum', enum: ['a'] }))).toBe('enum')
    expect(controlOf(field({ type: 'array' }))).toBe('json')
    expect(controlOf(field({ type: 'object' }))).toBe('json')
  })
})

describe('isIsoDatetime()', () => {
  it('accepts an ISO date or an offset date-time', () => {
    expect(isIsoDatetime('2026-01-01')).toBe(true)
    expect(isIsoDatetime('2026-01-01T09:30:00Z')).toBe(true)
    expect(isIsoDatetime('2026-01-01T09:30:00+02:00')).toBe(true)
  })

  it('rejects a date-time without an offset, and garbage', () => {
    expect(isIsoDatetime('2026-01-01T09:30:00')).toBe(false)
    expect(isIsoDatetime('not a date')).toBe(false)
  })

  it('exposes a Spanish hint', () => {
    expect(DATETIME_HINT).toMatch(/2026-01-01/)
  })
})

describe('getPath() / setPath()', () => {
  it('reads and writes nested paths', () => {
    const target: JsonObject = {}
    setPath(target, 'ticket.message', 'hola')
    expect(target).toEqual({ ticket: { message: 'hola' } })
    expect(getPath(target, 'ticket.message')).toBe('hola')
    expect(getPath(target, 'ticket.missing')).toBeUndefined()
  })

  it('leaves a conflicting parent alone instead of overwriting it', () => {
    const target: JsonObject = { a: 'not an object' }
    setPath(target, 'a.b', 1)
    expect(target).toEqual({ a: 'not an object' })
  })

  it('never replaces an already-set object at the leaf', () => {
    const target: JsonObject = { a: { b: 1 } }
    setPath(target, 'a', 'x')
    expect(target).toEqual({ a: { b: 1 } })
  })
})

describe('parseFieldValue()', () => {
  it('treats an empty value as missing (not sent)', () => {
    expect(parseFieldValue(field(), '')).toEqual({ kind: 'missing' })
    expect(parseFieldValue(field(), '   ')).toEqual({ kind: 'missing' })
    expect(
      parseFieldValue(field({ type: 'boolean', required: false }), undefined)
    ).toEqual({ kind: 'missing' })
  })

  it('parses each type, in Spanish on error', () => {
    expect(parseFieldValue(field({ type: 'number' }), '3.5')).toEqual({
      kind: 'value',
      value: 3.5
    })
    expect(parseFieldValue(field({ type: 'number' }), 'x')).toEqual({
      kind: 'error',
      message: 'Debe ser un número.'
    })
    expect(parseFieldValue(field({ type: 'integer' }), '3.5')).toEqual({
      kind: 'error',
      message: 'Debe ser un número entero.'
    })
    expect(parseFieldValue(field({ type: 'boolean' }), true)).toEqual({
      kind: 'value',
      value: true
    })
    expect(
      parseFieldValue(field({ type: 'datetime' }), '2026-01-01T00:00:00Z')
    ).toEqual({ kind: 'value', value: '2026-01-01T00:00:00Z' })
    expect(parseFieldValue(field({ type: 'datetime' }), 'nope').kind).toBe(
      'error'
    )
  })

  it('enforces enum membership and array/object JSON shape', () => {
    expect(
      parseFieldValue(field({ type: 'enum', enum: ['a', 'b'] }), 'a')
    ).toEqual({ kind: 'value', value: 'a' })
    expect(
      parseFieldValue(field({ type: 'enum', enum: ['a', 'b'] }), 'c').kind
    ).toBe('error')
    expect(parseFieldValue(field({ type: 'array' }), '["a"]')).toEqual({
      kind: 'value',
      value: ['a']
    })
    expect(parseFieldValue(field({ type: 'array' }), '{}').kind).toBe('error')
    expect(parseFieldValue(field({ type: 'object' }), '{"a":1}')).toEqual({
      kind: 'value',
      value: { a: 1 }
    })
    expect(parseFieldValue(field({ type: 'object' }), '[]').kind).toBe('error')
    expect(parseFieldValue(field({ type: 'object' }), '{bad').kind).toBe(
      'error'
    )
  })

  it('enforces maxLength on strings', () => {
    expect(parseFieldValue(field({ maxLength: 3 }), 'abcd').kind).toBe('error')
    expect(parseFieldValue(field({ maxLength: 3 }), 'abc')).toEqual({
      kind: 'value',
      value: 'abc'
    })
  })
})

describe('buildInput()', () => {
  it('builds nested JSON, skipping empty optional fields', () => {
    const fields = [
      field({ path: 'ticket.message', required: true }),
      field({ path: 'ticket.priority', type: 'integer', required: false })
    ]
    const result = buildInput(fields, { 'ticket.message': 'hola' })
    expect(result).toEqual({
      input: { ticket: { message: 'hola' } },
      errors: {}
    })
  })

  it('reports a missing required field and an invalid one, keeping only the valid part', () => {
    const fields = [
      field({ path: 'message', required: true }),
      field({ path: 'count', type: 'integer', required: true })
    ]
    const result = buildInput(fields, { count: 'x' })
    expect(result.input).toEqual({})
    expect(result.errors).toEqual({
      message: 'Campo obligatorio.',
      count: 'Debe ser un número entero.'
    })
  })
})

describe('valuesFromInput() / undeclaredPaths()', () => {
  const fields = [
    field({ path: 'ticket.message' }),
    field({ path: 'priority', type: 'integer', required: false })
  ]

  it('reads each declared path back as form text', () => {
    expect(
      valuesFromInput(fields, { ticket: { message: 'hola' }, priority: 2 })
    ).toEqual({ 'ticket.message': 'hola', priority: '2' })
  })

  it('finds input keys no field declares, without walking into declared ones', () => {
    expect(
      undeclaredPaths(fields, {
        ticket: { message: 'hola', extra: 1 },
        priority: 2,
        other: 'x'
      })
    ).toEqual(['ticket.extra', 'other'])
  })
})

describe('parseInputJson()', () => {
  it('accepts an empty string as an empty object', () => {
    expect(parseInputJson('')).toEqual({ ok: true, input: {} })
    expect(parseInputJson('   ')).toEqual({ ok: true, input: {} })
  })

  it('rejects invalid JSON and non-object JSON, in Spanish', () => {
    expect(parseInputJson('{bad')).toEqual({
      ok: false,
      error: 'El JSON no es válido.'
    })
    expect(parseInputJson('[1,2]').ok).toBe(false)
  })

  it('parses a valid JSON object', () => {
    expect(parseInputJson('{"a": 1}')).toEqual({ ok: true, input: { a: 1 } })
  })
})

describe('sampleInput()', () => {
  it('fills every declared field, required or not, with a valid value', () => {
    const fields = [
      field({ path: 'message', required: true }),
      field({ path: 'age', type: 'integer', required: false }),
      field({ path: 'active', type: 'boolean', required: false }),
      field({ path: 'when', type: 'datetime', required: false }),
      field({ path: 'kind', type: 'enum', enum: ['a', 'b'], required: false }),
      field({ path: 'tags', type: 'array', required: false }),
      field({ path: 'meta', type: 'object', required: false })
    ]
    const sample = sampleInput(fields, { datetime: '2026-05-01T00:00:00Z' })
    expect(sample).toEqual({
      message: 'Texto de ejemplo para message',
      age: 0,
      active: false,
      when: '2026-05-01T00:00:00Z',
      kind: 'a',
      tags: [],
      meta: {}
    })
  })

  it('trims a sample string to the field maxLength', () => {
    const [sample] = Object.values(
      sampleInput([field({ path: 'name', maxLength: 5 })])
    )
    expect((sample as string).length).toBeLessThanOrEqual(5)
  })
})

describe('readValue()', () => {
  it('reads a stale value of the wrong type back as the default', () => {
    const boolField = field({ type: 'boolean', required: true })
    expect(readValue(boolField, { text: 'not a boolean' })).toBe(false)
    expect(readValue(field(), {})).toBe('')
  })
})
