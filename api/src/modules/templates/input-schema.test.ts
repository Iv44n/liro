import { describe, expect, test } from 'bun:test'
import type { JsonValue } from '#modules/engine/evaluator/port'
import {
  type InputField,
  inputFieldSchema,
  templateDefinitionSchema
} from './definition'
import {
  buildInputValidator,
  inputJsonSchema,
  policyInputOf,
  SAMPLE_DATETIME,
  sampleInput,
  storedInputOf
} from './input-schema'
import type { JsonObject } from './paths'

/** Fields go through the DSL schema so defaults (`required: false`) apply. */
const fields = (...raw: unknown[]): InputField[] =>
  raw.map(field => inputFieldSchema.parse(field))

const field = (raw: Record<string, unknown>): InputField =>
  inputFieldSchema.parse(raw)

/** The support-ticket shape used across these tests. */
const TICKET_FIELDS = fields(
  { path: 'ticket.subject', type: 'string', description: 'Subject line' },
  {
    path: 'ticket.message',
    type: 'string',
    required: true,
    description: 'The customer message'
  },
  { path: 'customer.plan', type: 'enum', enum: ['free', 'pro', 'enterprise'] }
)

/** The issue paths of a failed parse, or `null` when it succeeds. */
function issuePaths(
  schema: ReturnType<typeof buildInputValidator>,
  value: unknown
): string[] | null {
  const result = schema.safeParse(value)
  return result.success
    ? null
    : result.error.issues.map(issue => issue.path.join('.'))
}

type Schema = Record<string, unknown>
const at = (schema: Schema, ...keys: string[]): Schema => {
  let current: unknown = schema
  for (const key of keys) current = (current as Schema)[key]
  return current as Schema
}

describe('buildInputValidator', () => {
  describe('nested required semantics', () => {
    const validator = buildInputValidator(TICKET_FIELDS)

    test('a parent with a required descendant is required', () => {
      expect(issuePaths(validator, {})).toEqual(['ticket'])
      expect(issuePaths(validator, { ticket: {} })).toEqual(['ticket.message'])
      expect(issuePaths(validator, { ticket: { subject: 'Hi' } })).toEqual([
        'ticket.message'
      ])
    })

    test('a parent whose descendants are all optional is optional', () => {
      const minimal = { ticket: { message: 'It crashes' } }
      expect(validator.parse(minimal)).toEqual(minimal)
      expect(validator.parse({ ...minimal, customer: {} })).toEqual({
        ...minimal,
        customer: {}
      })
      expect(
        validator.parse({ ...minimal, customer: { plan: 'pro' } })
      ).toEqual({ ...minimal, customer: { plan: 'pro' } })
    })

    test('requiredness propagates through every ancestor', () => {
      const deep = buildInputValidator(
        fields(
          { path: 'a.b.c', type: 'number', required: true },
          { path: 'a.b.d', type: 'number' },
          { path: 'a.e', type: 'number' }
        )
      )
      expect(issuePaths(deep, {})).toEqual(['a'])
      expect(issuePaths(deep, { a: {} })).toEqual(['a.b'])
      expect(issuePaths(deep, { a: { b: {} } })).toEqual(['a.b.c'])
      expect(deep.parse({ a: { b: { c: 1 } } })).toEqual({ a: { b: { c: 1 } } })
    })

    test('one required leaf among optional siblings makes the parent required', () => {
      const validator = buildInputValidator(
        fields(
          { path: 'meta.one', type: 'string' },
          { path: 'meta.two', type: 'string' },
          { path: 'meta.three', type: 'boolean', required: true }
        )
      )
      expect(issuePaths(validator, {})).toEqual(['meta'])
      expect(validator.parse({ meta: { three: true } })).toEqual({
        meta: { three: true }
      })
    })

    test('reports every missing required field at once', () => {
      const validator = buildInputValidator(
        fields(
          { path: 'a', type: 'string', required: true },
          { path: 'b.c', type: 'string', required: true }
        )
      )
      expect(issuePaths(validator, {})).toEqual(['a', 'b'])
    })
  })

  describe('unknown keys', () => {
    const validator = buildInputValidator(TICKET_FIELDS)

    test('are stripped at the top level and inside parents', () => {
      const input = {
        ticket: { message: 'Hi', attachments: 3 },
        customer: { plan: 'free', email: 'a@b.c' },
        extra: true
      }
      expect(validator.parse(input)).toEqual({
        ticket: { message: 'Hi' },
        customer: { plan: 'free' }
      })
    })

    test('are kept inside object and array fields, which take any JSON', () => {
      const validator = buildInputValidator(
        fields(
          { path: 'data', type: 'object' },
          { path: 'items', type: 'array' }
        )
      )
      const input = {
        data: { anything: { nested: [1, 'two', null, { deep: true }] } },
        items: [{ free: 'form' }, [1, 2], null]
      }
      expect(validator.parse(input)).toEqual(input)
    })

    test('parsing never mutates the input', () => {
      const input = { ticket: { message: 'Hi', extra: 1 }, other: 2 }
      const before = structuredClone(input)
      validator.parse(input)
      expect(input).toEqual(before)
    })
  })

  describe('null', () => {
    const validator = buildInputValidator(TICKET_FIELDS)

    test.each([
      ['a required field', { ticket: { message: null } }, 'ticket.message'],
      [
        'an optional field',
        { ticket: { message: 'Hi', subject: null } },
        'ticket.subject'
      ],
      [
        'an optional enum field',
        { ticket: { message: 'Hi' }, customer: { plan: null } },
        'customer.plan'
      ],
      ['a required parent', { ticket: null }, 'ticket'],
      [
        'an optional parent',
        { ticket: { message: 'Hi' }, customer: null },
        'customer'
      ]
    ])('is rejected for %s', (_, input, path) => {
      expect(issuePaths(validator, input)).toEqual([path])
    })
  })

  describe('the input itself', () => {
    test.each([
      ['null', null],
      ['an array', []],
      ['a string', 'text'],
      ['a number', 1],
      ['undefined', undefined]
    ])('must be an object, not %s', (_, value) => {
      expect(buildInputValidator(TICKET_FIELDS).safeParse(value).success).toBe(
        false
      )
    })

    test('without fields, any object is accepted and emptied', () => {
      const validator = buildInputValidator([])
      expect(validator.parse({})).toEqual({})
      expect(validator.parse({ a: 1, b: { c: 2 } })).toEqual({})
      expect(validator.safeParse(null).success).toBe(false)
    })
  })

  describe('field types', () => {
    const cases: [string, Record<string, unknown>, JsonValue[], unknown[]][] = [
      [
        'string',
        { type: 'string' },
        ['', 'x', 'a much longer text'],
        [1, true, [], {}]
      ],
      [
        'number',
        { type: 'number' },
        [0, -1.5, 42, 1e308],
        ['1', true, Number.NaN, Number.POSITIVE_INFINITY, -Infinity]
      ],
      [
        'integer',
        { type: 'integer' },
        [0, -3, 7, Number.MAX_SAFE_INTEGER],
        [1.5, '1', Number.NaN, 2 ** 53, Number.POSITIVE_INFINITY]
      ],
      ['boolean', { type: 'boolean' }, [true, false], ['true', 0, 1, '']],
      [
        'datetime',
        { type: 'datetime' },
        [
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00.123Z',
          '2026-01-01T08:30:00-03:00',
          '2026-06-15T23:59:59.5+05:30',
          '2026-01-01',
          '2024-02-29'
        ],
        [
          '2026-01-01T00:00:00',
          '2026-13-01',
          '2026-02-30',
          '2025-02-29',
          '2026-01-01T25:00:00Z',
          '01/02/2026',
          'tomorrow',
          '',
          1_767_225_600_000
        ]
      ],
      [
        'enum',
        { type: 'enum', enum: ['free', 'pro'] },
        ['free', 'pro'],
        ['FREE', 'gold', '', 1]
      ],
      [
        'array',
        { type: 'array' },
        [[], [1, 'a', null, { b: [true] }]],
        [{}, 'a', 1]
      ],
      [
        'object',
        { type: 'object' },
        [{}, { a: { b: [1, null] } }],
        [[], 'x', 1, true]
      ]
    ]

    describe.each(cases)('%s', (_, spec, valid, invalid) => {
      const validator = buildInputValidator(
        fields({ path: 'value', required: true, ...spec })
      )

      test.each(valid.map(value => [JSON.stringify(value), value]))(
        'accepts %s',
        (_, value) => {
          expect(validator.parse({ value })).toEqual({ value } as JsonObject)
        }
      )

      test.each(
        invalid.map(value => [
          typeof value === 'number' ? String(value) : JSON.stringify(value),
          value
        ])
      )('rejects %s', (_, value) => {
        expect(issuePaths(validator, { value })).toEqual(['value'])
      })

      test('rejects null and absence', () => {
        expect(issuePaths(validator, { value: null })).toEqual(['value'])
        expect(issuePaths(validator, {})).toEqual(['value'])
      })
    })

    test('an optional field of any type may be absent', () => {
      const validator = buildInputValidator(
        fields(
          { path: 's', type: 'string' },
          { path: 'n', type: 'number' },
          { path: 'i', type: 'integer' },
          { path: 'b', type: 'boolean' },
          { path: 'd', type: 'datetime' },
          { path: 'e', type: 'enum', enum: ['x'] },
          { path: 'a', type: 'array' },
          { path: 'o', type: 'object' }
        )
      )
      expect(validator.parse({})).toEqual({})
    })

    test('an invalid datetime explains the accepted forms', () => {
      const validator = buildInputValidator(
        fields({ path: 'at', type: 'datetime', required: true })
      )
      const result = validator.safeParse({ at: '2026-01-01T00:00:00' })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toContain('ISO 8601')
    })

    test('an enum field without values accepts nothing', () => {
      const unchecked = {
        path: 'plan',
        type: 'enum',
        required: true
      } as InputField
      const validator = buildInputValidator([unchecked])
      expect(validator.safeParse({ plan: 'free' }).success).toBe(false)
    })
  })

  describe('maxLength', () => {
    const validator = buildInputValidator(
      fields({ path: 'code', type: 'string', maxLength: 5 })
    )

    test('accepts strings up to the limit', () => {
      expect(validator.parse({ code: 'abcde' })).toEqual({ code: 'abcde' })
      expect(validator.parse({ code: '' })).toEqual({ code: '' })
    })

    test('rejects longer strings', () => {
      expect(issuePaths(validator, { code: 'abcdef' })).toEqual(['code'])
    })

    test('without maxLength, length is unbounded', () => {
      const unbounded = buildInputValidator(
        fields({ path: 'code', type: 'string' })
      )
      expect(unbounded.parse({ code: 'x'.repeat(100_000) }).code).toHaveLength(
        100_000
      )
    })
  })

  describe('conflicting paths', () => {
    test.each([
      [
        'a duplicate path',
        ['ticket.message', 'ticket.message'],
        /Duplicate input field `ticket\.message`/
      ],
      [
        'a duplicate top-level path',
        ['text', 'text'],
        /Duplicate input field `text`/
      ],
      [
        'a field declared before its child',
        ['ticket', 'ticket.message'],
        /`ticket` is also the parent of `ticket\.message`/
      ],
      [
        'a field declared after its child',
        ['ticket.message', 'ticket'],
        /`ticket` is also the parent of other fields/
      ],
      [
        'a nested field that is also a parent',
        ['a.b', 'a.b.c.d'],
        /`a\.b` is also the parent of `a\.b\.c\.d`/
      ]
    ])('throw for %s', (_, paths, message) => {
      const conflicting = paths.map(path => field({ path, type: 'string' }))
      expect(() => buildInputValidator(conflicting)).toThrow(message)
    })

    test('siblings and equal names under different parents do not conflict', () => {
      const validator = buildInputValidator(
        fields(
          { path: 'a.x', type: 'number', required: true },
          { path: 'a.y', type: 'number', required: true },
          { path: 'b.x', type: 'number', required: true },
          { path: 'x', type: 'number', required: true }
        )
      )
      const input = { a: { x: 1, y: 2 }, b: { x: 3 }, x: 4 }
      expect(validator.parse(input)).toEqual(input)
    })
  })

  // zod reads inherited members for absent keys (an optional `toString`
  // would reject `{}`) and treats `__proto__` as the prototype (a required
  // `__proto__.x` would pass on `{}`), so these names are refused outright.
  describe('Object.prototype member names', () => {
    test.each([
      ['__proto__.x', '__proto__'],
      ['constructor', 'constructor'],
      ['ticket.toString', 'toString'],
      ['hasOwnProperty.a', 'hasOwnProperty'],
      ['a.b.valueOf', 'valueOf'],
      ['__defineGetter__', '__defineGetter__']
    ])('throw for %s', (path, reserved) => {
      // The DSL schema rejects these paths; injected after parsing, the
      // builders must still refuse them rather than reach the prototype.
      expect(inputFieldSchema.safeParse({ path, type: 'number' }).success).toBe(
        false
      )
      const reservedFields = [
        field({ path: 'ok', type: 'string' }),
        { ...field({ path: 'amount', type: 'number', required: true }), path }
      ]
      const message = `Input path \`${path}\` uses the reserved name \`${reserved}\``
      expect(() => buildInputValidator(reservedFields)).toThrow(message)
      expect(() => inputJsonSchema(reservedFields)).toThrow(message)
      expect(() => sampleInput(reservedFields)).toThrow(message)
    })

    test('names that merely contain them are fine', () => {
      const validator = buildInputValidator(
        fields(
          { path: 'proto.constructorName', type: 'string', required: true },
          { path: 'toStringValue', type: 'string' },
          { path: 'Constructor', type: 'string' }
        )
      )
      expect(validator.parse({ proto: { constructorName: 'c' } })).toEqual({
        proto: { constructorName: 'c' }
      })
    })
  })
})

describe('inputJsonSchema', () => {
  const schema = inputJsonSchema(TICKET_FIELDS)

  test('is a draft 2020-12 object schema with nested properties', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.type).toBe('object')
    expect(Object.keys(at(schema, 'properties'))).toEqual([
      'ticket',
      'customer'
    ])
    expect(at(schema, 'properties', 'ticket')).toEqual({
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Subject line' },
        message: { type: 'string', description: 'The customer message' }
      },
      required: ['message']
    })
    expect(at(schema, 'properties', 'customer')).toEqual({
      type: 'object',
      properties: {
        plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] }
      }
    })
  })

  test('marks a parent required iff a descendant is', () => {
    expect(schema.required).toEqual(['ticket'])
    expect(at(schema, 'properties', 'customer')).not.toHaveProperty('required')
  })

  test('allows additional properties, since unknown keys are stripped', () => {
    expect(schema).not.toHaveProperty('additionalProperties')
    expect(at(schema, 'properties', 'ticket')).not.toHaveProperty(
      'additionalProperties'
    )
    expect(at(schema, 'properties', 'customer')).not.toHaveProperty(
      'additionalProperties'
    )
  })

  test('maps every field type', () => {
    const all = inputJsonSchema(
      fields(
        { path: 's', type: 'string', maxLength: 10, required: true },
        { path: 'n', type: 'number' },
        { path: 'i', type: 'integer' },
        { path: 'b', type: 'boolean' },
        { path: 'd', type: 'datetime', description: 'When it happened' },
        { path: 'e', type: 'enum', enum: ['x', 'y'] },
        { path: 'a', type: 'array' },
        { path: 'o', type: 'object' }
      )
    )
    const property = (key: string) => at(all, 'properties', key)

    expect(property('s')).toEqual({ type: 'string', maxLength: 10 })
    expect(property('n')).toEqual({ type: 'number' })
    expect(property('i')).toEqual({
      type: 'integer',
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER
    })
    expect(property('b')).toEqual({ type: 'boolean' })
    expect(property('e')).toEqual({ type: 'string', enum: ['x', 'y'] })

    const datetime = property('d')
    expect(datetime.description).toBe('When it happened')
    expect(
      (datetime.anyOf as Schema[]).map(branch => [branch.type, branch.format])
    ).toEqual([
      ['string', 'date-time'],
      ['string', 'date']
    ])

    expect(property('a')).toEqual({
      type: 'array',
      items: { $ref: '#/$defs/JsonValue' }
    })
    expect(property('o')).toEqual({
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: { $ref: '#/$defs/JsonValue' }
    })
    expect(all.required).toEqual(['s'])
  })

  test('defines JsonValue once, recursively, when array/object fields exist', () => {
    const withJson = inputJsonSchema(
      fields({ path: 'a', type: 'array' }, { path: 'x.o', type: 'object' })
    )
    const defs = at(withJson, '$defs')
    expect(Object.keys(defs)).toEqual(['JsonValue'])
    const branches = at(defs, 'JsonValue').anyOf as Schema[]
    expect(branches.map(branch => branch.type)).toEqual([
      'string',
      'number',
      'boolean',
      'null',
      'array',
      'object'
    ])
    expect(branches[4]).toEqual({
      type: 'array',
      items: { $ref: '#/$defs/JsonValue' }
    })

    expect(schema).not.toHaveProperty('$defs')
  })

  test('includes descriptions of required and optional fields', () => {
    expect(at(schema, 'properties', 'ticket', 'properties', 'message')).toEqual(
      { type: 'string', description: 'The customer message' }
    )
    expect(at(schema, 'properties', 'ticket', 'properties', 'subject')).toEqual(
      { type: 'string', description: 'Subject line' }
    )
  })

  test('is deterministic and follows field order', () => {
    expect(inputJsonSchema(TICKET_FIELDS)).toEqual(schema)
    expect(JSON.stringify(inputJsonSchema(TICKET_FIELDS))).toBe(
      JSON.stringify(schema)
    )

    const reordered = inputJsonSchema([...TICKET_FIELDS].reverse())
    expect(Object.keys(at(reordered, 'properties'))).toEqual([
      'customer',
      'ticket'
    ])
    expect(
      Object.keys(at(reordered, 'properties', 'ticket', 'properties'))
    ).toEqual(['message', 'subject'])
  })

  test('without fields, describes an empty object', () => {
    expect(inputJsonSchema([])).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {}
    })
  })

  test('throws on conflicting paths', () => {
    expect(() =>
      inputJsonSchema(
        fields({ path: 'a', type: 'string' }, { path: 'a.b', type: 'string' })
      )
    ).toThrow(/`a` is also the parent/)
  })
})

// ── Stored views ─────────────────────────────────────────────────────────

const definition = templateDefinitionSchema.parse({
  kind: 'custom',
  input: {
    fields: [
      { path: 'ticket.subject', type: 'string' },
      { path: 'ticket.message', type: 'string', required: true },
      { path: 'ticket.channel', type: 'string' },
      { path: 'customer.plan', type: 'enum', enum: ['free', 'pro'] },
      { path: 'customer.email', type: 'string', pii: true },
      { path: 'customer.name', type: 'string', pii: false },
      { path: 'contact.phone', type: 'string', pii: true },
      { path: 'score', type: 'number' }
    ]
  },
  decisions: [{ label: 'bug' }, { label: 'other' }],
  preconditions: [
    {
      id: 'empty',
      when: {
        op: 'len_lt',
        left: { input: 'ticket.message' },
        right: { value: 3 }
      },
      decision: 'other'
    }
  ],
  questions: {
    urgent: {
      type: 'boolean',
      instructions: 'Is the customer blocked?',
      when: { op: 'exists', left: { input: 'ticket.channel' } }
    }
  },
  signals: [{ name: 'risk', kind: 'max', of: [{ input: 'score' }] }],
  rules: [
    {
      id: 'pro',
      when: {
        op: 'eq',
        left: { input: 'customer.plan' },
        right: { value: 'pro' }
      },
      decision: 'bug'
    }
  ]
})

const customer = { plan: 'pro', email: 'ana@example.com', name: 'Ana' }
const contact = { phone: '+51 999' }
const input: JsonObject = {
  ticket: { subject: 'Crash', message: 'The app crashes', channel: 'email' },
  customer,
  contact,
  score: 0.4
}

describe('policyInputOf', () => {
  test('keeps only the paths the policy reads', () => {
    expect(policyInputOf(definition, input)).toEqual({
      ticket: { message: 'The app crashes', channel: 'email' },
      customer: { plan: 'pro' },
      score: 0.4
    })
  })

  test('skips policy paths missing from the input', () => {
    expect(policyInputOf(definition, { ticket: { message: 'Hi' } })).toEqual({
      ticket: { message: 'Hi' }
    })
    expect(policyInputOf(definition, {})).toEqual({})
  })

  test('reading an ancestor keeps its whole subtree, pii included', () => {
    const reader = templateDefinitionSchema.parse({
      ...definition,
      rules: [
        {
          id: 'known',
          when: { op: 'exists', left: { input: 'customer' } },
          decision: 'bug'
        }
      ],
      preconditions: [],
      questions: {},
      signals: []
    })
    expect(policyInputOf(reader, input)).toEqual({ customer })
  })

  test('is empty when the policy reads no input', () => {
    const blind = templateDefinitionSchema.parse({
      kind: 'custom',
      input: { fields: [{ path: 'text', type: 'string' }] },
      decisions: [{ label: 'bug' }],
      rules: [{ id: 'all', when: { all: [] }, decision: 'bug' }]
    })
    expect(policyInputOf(blind, { text: 'hello' })).toEqual({})
  })

  // With an own `__proto__` key (as JSON.parse makes), `pickPaths` would set
  // `Object.prototype.polluted`.
  test('a policy path through __proto__ throws and pollutes nothing', () => {
    const hostile = templateDefinitionSchema.parse({
      kind: 'custom',
      input: { fields: [{ path: 'meta', type: 'object' }] },
      decisions: [{ label: 'bug' }],
      rules: [
        {
          id: 'r',
          when: { op: 'exists', left: { input: 'meta.polluted' } },
          decision: 'bug'
        }
      ]
    })
    // The schema rejects `__proto__` segments; injected after parsing, so this
    // checks that `policyInputOf` refuses the path on its own.
    const [rule] = hostile.rules
    if (!rule) throw new Error('No rule')
    rule.when = { op: 'exists', left: { input: 'meta.__proto__.polluted' } }
    const raw = JSON.parse('{"meta":{"__proto__":{"polluted":1}}}')
    expect(() => policyInputOf(hostile, raw)).toThrow(
      'Input path `meta.__proto__.polluted` uses the reserved name `__proto__`'
    )
    expect(() => storedInputOf(hostile, raw, 'policy')).toThrow('__proto__')
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
  })

  test('returns a deep copy', () => {
    const picked = policyInputOf(definition, input)
    ;(picked.ticket as JsonObject).message = 'changed'
    expect((input.ticket as JsonObject).message).toBe('The app crashes')
  })
})

describe('storedInputOf', () => {
  test('full: the whole input minus every pii field', () => {
    expect(storedInputOf(definition, input, 'full')).toEqual({
      ticket: {
        subject: 'Crash',
        message: 'The app crashes',
        channel: 'email'
      },
      customer: { plan: 'pro', name: 'Ana' },
      // The parent of a removed pii field stays, empty.
      contact: {},
      score: 0.4
    })
  })

  test('full: without pii fields, a copy of the input', () => {
    const plain = templateDefinitionSchema.parse({
      kind: 'custom',
      input: { fields: [{ path: 'text', type: 'string' }] },
      decisions: [{ label: 'bug' }]
    })
    const stored = storedInputOf(plain, { text: 'hello' }, 'full')
    expect(stored).toEqual({ text: 'hello' })

    const original = { text: 'hello' }
    expect(storedInputOf(plain, original, 'full')).not.toBe(original)
  })

  test('policy: only the policy paths, minus pii', () => {
    expect(storedInputOf(definition, input, 'policy')).toEqual(
      policyInputOf(definition, input)
    )

    const reader = templateDefinitionSchema.parse({
      ...definition,
      rules: [
        {
          id: 'known',
          when: { op: 'exists', left: { input: 'customer' } },
          decision: 'bug'
        },
        {
          id: 'reachable',
          when: { op: 'exists', left: { input: 'contact.phone' } },
          decision: 'bug'
        }
      ],
      preconditions: [],
      questions: {},
      signals: []
    })
    expect(storedInputOf(reader, input, 'policy')).toEqual({
      customer: { plan: 'pro', name: 'Ana' },
      contact: {}
    })
    // policyInput itself keeps the pii the policy reads.
    expect(policyInputOf(reader, input)).toEqual({
      customer,
      contact
    })
  })

  test('none: nothing', () => {
    expect(storedInputOf(definition, input, 'none')).toBeNull()
  })

  test('policy: a read inside a pii object field is removed with it', () => {
    const profiled = templateDefinitionSchema.parse({
      kind: 'custom',
      input: {
        fields: [
          { path: 'profile', type: 'object', pii: true },
          { path: 'text', type: 'string' }
        ]
      },
      decisions: [{ label: 'bug' }],
      rules: [
        {
          id: 'adult',
          when: {
            op: 'gte',
            left: { input: 'profile.age' },
            right: { value: 18 }
          },
          decision: 'bug'
        }
      ]
    })
    const profile = { age: 30, name: 'Ana' }
    const raw = { profile, text: 'hi' }
    expect(policyInputOf(profiled, raw)).toEqual({ profile: { age: 30 } })
    expect(storedInputOf(profiled, raw, 'policy')).toEqual({})
    expect(storedInputOf(profiled, raw, 'full')).toEqual({ text: 'hi' })
  })

  test('throws on an unknown mode instead of storing anything', () => {
    expect(() =>
      storedInputOf(definition, input, 'everything' as 'full')
    ).toThrow('Unknown storeInput mode `everything`')
  })

  // `omitPaths` would run `delete Object.prototype.hasOwnProperty` here.
  test('a pii path through __proto__ throws and leaves Object.prototype alone', () => {
    const hostile = templateDefinitionSchema.parse({
      kind: 'custom',
      input: {
        fields: [{ path: 'secret.name', type: 'string', pii: true }]
      },
      decisions: [{ label: 'bug' }]
    })
    // The schema rejects `__proto__` segments; injected after parsing, so this
    // checks that `storedInputOf` refuses the path on its own.
    hostile.input.fields = hostile.input.fields.map(pii => ({
      ...pii,
      path: '__proto__.hasOwnProperty'
    }))
    for (const mode of ['full', 'policy'] as const) {
      expect(() => storedInputOf(hostile, { x: 1 }, mode)).toThrow(
        'uses the reserved name `__proto__`'
      )
    }
    expect(typeof Object.prototype.hasOwnProperty).toBe('function')
    expect(storedInputOf(hostile, { x: 1 }, 'none')).toBeNull()
  })

  test('pii fields absent from the input are fine', () => {
    expect(
      storedInputOf(definition, { ticket: { message: 'Hi' } }, 'full')
    ).toEqual({ ticket: { message: 'Hi' } })
    expect(storedInputOf(definition, {}, 'policy')).toEqual({})
  })

  test('never mutates the input', () => {
    const before = structuredClone(input)
    storedInputOf(definition, input, 'full')
    storedInputOf(definition, input, 'policy')
    storedInputOf(definition, input, 'none')
    expect(input).toEqual(before)
  })
})

describe('sampleInput', () => {
  test('gives every field, required or not, a value per type', () => {
    expect(
      sampleInput(
        fields(
          { path: 'text', type: 'string', required: true },
          { path: 'n', type: 'number' },
          { path: 'i', type: 'integer' },
          { path: 'b', type: 'boolean' },
          { path: 'd', type: 'datetime' },
          { path: 'e', type: 'enum', enum: ['first', 'second'] },
          { path: 'a', type: 'array' },
          { path: 'o', type: 'object' }
        )
      )
    ).toEqual({
      text: 'Example text',
      n: 0,
      i: 0,
      b: false,
      d: SAMPLE_DATETIME,
      e: 'first',
      a: [],
      o: {}
    })
    expect(SAMPLE_DATETIME).toBe('2026-01-01T00:00:00Z')
  })

  test('nests dot paths and derives strings from the path', () => {
    expect(sampleInput(TICKET_FIELDS)).toEqual({
      ticket: {
        subject: 'Example ticket subject',
        message: 'Example ticket message'
      },
      customer: { plan: 'free' }
    })
  })

  test.each([
    ['customer.firstName', 'Example customer first name'],
    ['order.shipping_address', 'Example order shipping address'],
    ['HTTPStatus', 'Example httpstatus'],
    ['_private', 'Example private'],
    ['_', 'Example']
  ])('names %s as "%s"', (path, expected) => {
    let value: unknown = sampleInput(fields({ path, type: 'string' }))
    for (const segment of path.split('.')) {
      value = (value as JsonObject)[segment]
    }
    expect(value).toBe(expected)
  })

  test('fits strings within maxLength', () => {
    expect(
      sampleInput(
        fields({ path: 'ticket.message', type: 'string', maxLength: 7 })
      )
    ).toEqual({ ticket: { message: 'Example' } })
    expect(
      sampleInput(fields({ path: 'code', type: 'string', maxLength: 1 }))
    ).toEqual({ code: 'E' })
  })

  test('passes the validator built from the same fields', () => {
    const all = fields(
      ...TICKET_FIELDS,
      { path: 'ticket.code', type: 'string', maxLength: 3, required: true },
      { path: 'order.total', type: 'number', required: true },
      { path: 'order.items', type: 'integer' },
      { path: 'order.paid', type: 'boolean' },
      { path: 'order.placed_at', type: 'datetime', required: true },
      { path: 'order.lines', type: 'array' },
      { path: 'order.meta.raw', type: 'object' }
    )
    const sample = sampleInput(all)
    expect(buildInputValidator(all).parse(sample)).toEqual(sample)
  })

  test('without fields, an empty object', () => {
    expect(sampleInput([])).toEqual({})
  })

  test('an enum field without values gets an empty string', () => {
    const unchecked = { path: 'plan', type: 'enum', required: false }
    expect(sampleInput([unchecked as InputField])).toEqual({ plan: '' })
  })

  test('throws on conflicting paths, like the validator', () => {
    expect(() =>
      sampleInput(
        fields({ path: 'a.b', type: 'string' }, { path: 'a.b', type: 'number' })
      )
    ).toThrow(/Duplicate input field `a\.b`/)
  })
})
