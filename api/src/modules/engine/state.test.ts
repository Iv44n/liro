import { describe, expect, test } from 'bun:test'
import triageRequest from '#/../test/fixtures/evaluator/support-triage.request.json'
import {
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import type { JsonObject } from '#modules/templates/paths'
import { buildState } from './state'

const FIELDS: TemplateDefinitionInput['input']['fields'] = [
  { path: 'ticket.message', type: 'string', required: true },
  { path: 'ticket.customer.plan', type: 'enum', enum: ['free', 'pro'] },
  { path: 'ticket.customer.email', type: 'string', pii: true },
  { path: 'amount', type: 'number' }
]

const define = (
  state?: TemplateDefinitionInput['state'],
  fields: TemplateDefinitionInput['input']['fields'] = FIELDS
) =>
  templateDefinitionSchema.parse({
    kind: 'custom',
    input: { fields },
    ...(state === undefined ? {} : { state }),
    decisions: [{ label: 'ok' }]
  })

const ticket = (): JsonObject => ({
  message: 'I was charged twice',
  customer: { plan: 'pro', email: 'ana@example.com' }
})

const fullInput = (): JsonObject => ({ ticket: ticket(), amount: 42 })

describe('buildState — shared input paths', () => {
  test('defaults to every declared field, pii included', () => {
    expect(buildState(define(), fullInput())).toStrictEqual(fullInput())
  })

  test('defaults to every declared field when `state` is empty', () => {
    expect(buildState(define({}), fullInput())).toStrictEqual(fullInput())
  })

  test('never sends input keys the template does not declare', () => {
    const input = {
      ...fullInput(),
      secret: 'not declared',
      ticket: { message: 'Hi', internal: true }
    }

    expect(buildState(define(), input)).toStrictEqual({
      ticket: { message: 'Hi' },
      amount: 42
    })
  })

  test('`include` restricts the state to those paths', () => {
    const definition = define({
      include: ['ticket.message', 'ticket.customer.plan']
    })

    expect(buildState(definition, fullInput())).toStrictEqual({
      ticket: { message: 'I was charged twice', customer: { plan: 'pro' } }
    })
  })

  test('reproduces the support-triage fixture state', () => {
    const definition = define({
      include: ['ticket.message', 'ticket.customer.plan']
    })
    const input = {
      ticket: {
        message: triageRequest.state.ticket.message,
        customer: { plan: 'pro', email: 'ana@example.com' }
      },
      amount: 10
    }

    const state = buildState(definition, input)

    expect(state).toStrictEqual(triageRequest.state)
    expect(JSON.stringify(state)).toBe(JSON.stringify(triageRequest.state))
  })

  test('an ancestor path in `include` shares the whole subtree', () => {
    const definition = define({ include: ['ticket'] })

    expect(buildState(definition, fullInput())).toStrictEqual({
      ticket: ticket()
    })
  })

  test('overlapping `include` paths pick the same values in any order', () => {
    const expected = { ticket: ticket() }

    for (const include of [
      ['ticket', 'ticket.message'],
      ['ticket.message', 'ticket']
    ]) {
      expect(buildState(define({ include }), fullInput())).toStrictEqual(
        expected
      )
    }
  })

  test('an empty `include` shares no input at all', () => {
    expect(buildState(define({ include: [] }), fullInput())).toStrictEqual({})
  })

  test('no fields and no context → an empty state', () => {
    expect(buildState(define(undefined, []), fullInput())).toStrictEqual({})
  })

  test('paths absent from the input are skipped', () => {
    expect(
      buildState(define(), { ticket: { message: 'Only this' } })
    ).toStrictEqual({ ticket: { message: 'Only this' } })
    expect(buildState(define(), {})).toStrictEqual({})
  })

  test('keeps falsy and null values that are present', () => {
    const fields: TemplateDefinitionInput['input']['fields'] = [
      { path: 'empty', type: 'string' },
      { path: 'zero', type: 'number' },
      { path: 'off', type: 'boolean' },
      { path: 'none', type: 'string' },
      { path: 'list', type: 'array' },
      { path: 'meta', type: 'object' }
    ]
    const input = {
      empty: '',
      zero: 0,
      off: false,
      none: null,
      list: [1, { a: 'b' }],
      meta: { nested: { deep: [] } }
    }

    expect(buildState(define(undefined, fields), input)).toStrictEqual(input)
  })

  test('key order follows the definition, not the input', () => {
    const definition = define({
      include: ['amount', 'ticket.customer.plan', 'ticket.message']
    })
    const input = fullInput()
    const reordered: JsonObject = {
      ticket: {
        customer: { email: 'ana@example.com', plan: 'pro' },
        message: 'I was charged twice'
      },
      amount: 42
    }

    const state = buildState(definition, input)

    expect(JSON.stringify(state)).toBe(
      '{"amount":42,"ticket":{"customer":{"plan":"pro"},"message":"I was charged twice"}}'
    )
    expect(JSON.stringify(buildState(definition, reordered))).toBe(
      JSON.stringify(state)
    )
  })
})

describe('buildState — static context', () => {
  test('merges `context` at the top level, after the input', () => {
    const definition = define({
      include: ['ticket.message'],
      context: {
        company: 'Acme',
        policy: { refundDays: 30, channels: ['email', 'chat'] }
      }
    })

    const state = buildState(definition, fullInput())

    expect(state).toStrictEqual({
      ticket: { message: 'I was charged twice' },
      company: 'Acme',
      policy: { refundDays: 30, channels: ['email', 'chat'] }
    })
    expect(Object.keys(state)).toEqual(['ticket', 'company', 'policy'])
  })

  test('a context key wins over the input, replacing (not merging) it', () => {
    const definition = define({
      context: { ticket: { priority: 'high' }, amount: null }
    })

    expect(buildState(definition, fullInput())).toStrictEqual({
      ticket: { priority: 'high' },
      amount: null
    })
  })

  test('context alone when no input path is shared', () => {
    const definition = define({ include: [], context: { lang: 'es' } }, [])

    expect(buildState(definition, fullInput())).toStrictEqual({ lang: 'es' })
  })

  test('an empty context adds nothing', () => {
    expect(buildState(define({ context: {} }), fullInput())).toStrictEqual(
      fullInput()
    )
  })
})

describe('buildState — purity', () => {
  test('never mutates the input or the definition', () => {
    const definition = define({ context: { policy: { refundDays: 30 } } })
    const input = fullInput()
    const inputBefore = structuredClone(input)
    const definitionBefore = structuredClone(definition)

    buildState(definition, input)

    expect(input).toStrictEqual(inputBefore)
    expect(definition).toStrictEqual(definitionBefore)
  })

  test('accepts a deeply frozen input and definition', () => {
    const definition = deepFreeze(
      define({ context: { policy: { refundDays: 30 } } })
    )

    expect(buildState(definition, deepFreeze(fullInput()))).toStrictEqual({
      ...fullInput(),
      policy: { refundDays: 30 }
    })
  })

  test('the state shares no objects with the input or the context', () => {
    const definition = define({ context: { policy: { refundDays: 30 } } })
    const input = fullInput()

    const state = buildState(definition, input)
    ;(state.ticket as JsonObject).message = 'changed'
    ;(state.policy as JsonObject).refundDays = 0

    expect(input).toStrictEqual(fullInput())
    expect(definition.state.context).toStrictEqual({
      policy: { refundDays: 30 }
    })
    expect(buildState(definition, input)).toStrictEqual({
      ...fullInput(),
      policy: { refundDays: 30 }
    })
  })

  test('is deterministic across calls', () => {
    const definition = define({ context: { lang: 'es' } })

    expect(JSON.stringify(buildState(definition, fullInput()))).toBe(
      JSON.stringify(buildState(definition, fullInput()))
    )
  })

  test.each([
    ['a declared field', undefined],
    ['`state.include`', ['__proto__.polluted']]
  ])('never follows a `__proto__` path from %s', (_, include) => {
    const definition = define(
      include === undefined ? undefined : { include: ['ticket.message'] },
      [{ path: 'ticket.message', type: 'string' }]
    )
    // The schema rejects `__proto__` segments; injected after parsing, so this
    // checks that `buildState` itself never follows one.
    definition.input.fields.unshift({
      path: '__proto__.polluted',
      type: 'string',
      required: false
    })
    if (include !== undefined) {
      definition.state.include = [...include, 'ticket.message']
    }
    const input = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "ticket": {"message": "Hi"}}'
    ) as JsonObject

    try {
      expect(buildState(definition, input)).toStrictEqual({
        ticket: { message: 'Hi' }
      })
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted
    }
  })
})

describe('buildState — unvalidated definitions', () => {
  test('an own `__proto__` context key stays a key, never the prototype', () => {
    const context = JSON.parse('{"__proto__": {"polluted": "yes"}}')

    const state = buildState(
      { input: { fields: [] }, state: { context } },
      fullInput()
    )

    expect(Object.getPrototypeOf(state)).toBe(Object.prototype)
    expect((state as Record<string, unknown>).polluted).toBeUndefined()
    expect(JSON.stringify(state)).toBe('{"__proto__":{"polluted":"yes"}}')
  })
})

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
