import { beforeEach, describe, expect, test } from 'bun:test'
import z from 'zod'
import {
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import { ApiError } from '#shared/http/errors'
import {
  COMPILED_CACHE_SIZE,
  clearCompiledCache,
  compileVersion,
  LruCache,
  MAX_JSON_DEPTH,
  NUL_MESSAGE,
  refineStorableJson,
  storableJsonIssues
} from './compiled-cache'

const parse = (definition: TemplateDefinitionInput) =>
  templateDefinitionSchema.parse(definition)

const definition = parse({
  kind: 'classify',
  input: {
    fields: [
      { path: 'ticket.message', type: 'string', required: true, maxLength: 20 },
      { path: 'ticket.priority', type: 'integer' },
      { path: 'customer.email', type: 'string', pii: true }
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
  rules: [
    {
      id: 'urgent',
      when: {
        op: 'gte',
        left: { input: 'ticket.priority' },
        right: { value: 3 }
      },
      decision: 'bug'
    }
  ]
})

/** The thrown `ApiError` (fails the test when nothing is thrown). */
function thrown(fn: () => unknown): ApiError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected an ApiError')
}

beforeEach(() => clearCompiledCache())

describe('compileVersion()', () => {
  test('derives the policy paths, labels and field paths', () => {
    const compiled = compileVersion({
      id: 'v1',
      definitionHash: 'h1',
      definition
    })

    expect(compiled.definition).toBe(definition)
    expect(compiled.policyPaths).toEqual(['ticket.message', 'ticket.priority'])
    expect(compiled.labels).toEqual(['bug', 'other'])
    expect(compiled.fieldPaths).toEqual([
      'ticket.message',
      'ticket.priority',
      'customer.email'
    ])
  })

  test('validateInput returns the input with unknown keys stripped', () => {
    const { validateInput } = compileVersion({
      id: 'v1',
      definitionHash: 'h1',
      definition
    })

    expect(
      validateInput({
        ticket: { message: 'It crashes', extra: true },
        unknown: 1
      })
    ).toEqual({ ticket: { message: 'It crashes' } })
  })

  test('validation failures are 422 VALIDATION_FAILED with input. paths', () => {
    const { validateInput } = compileVersion({
      id: 'v1',
      definitionHash: 'h1',
      definition
    })

    const error = thrown(() =>
      validateInput({
        ticket: { message: 'x'.repeat(21), priority: 1.5 },
        customer: { email: 42 }
      })
    )

    expect(error.status).toBe(422)
    expect(error.code).toBe('VALIDATION_FAILED')
    const issues = (error.body as { issues: { path: string }[] }).issues
    expect(issues.map(issue => issue.path).sort()).toEqual([
      'input.customer.email',
      'input.ticket.message',
      'input.ticket.priority'
    ])
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path'])
    }
  })

  test.each<[string, unknown, string]>([
    ['a missing required field', {}, 'input.ticket'],
    ['a non-object input', 'hello', 'input'],
    ['null', null, 'input'],
    ['an array', [], 'input']
  ])('rejects %s', (_, input, path) => {
    const { validateInput } = compileVersion({
      id: 'v1',
      definitionHash: 'h1',
      definition
    })

    const error = thrown(() => validateInput(input))
    const issues = (error.body as { issues: { path: string }[] }).issues
    expect(issues[0]?.path).toBe(path)
  })

  test('memoizes per id and definition hash', () => {
    const first = compileVersion({ id: 'v1', definitionHash: 'h1', definition })

    expect(compileVersion({ id: 'v1', definitionHash: 'h1', definition })).toBe(
      first
    )
    expect(
      compileVersion({ id: 'v1', definitionHash: 'h2', definition })
    ).not.toBe(first)
    expect(
      compileVersion({ id: 'v2', definitionHash: 'h1', definition })
    ).not.toBe(first)
  })

  test(`keeps the ${COMPILED_CACHE_SIZE} most recently used versions`, () => {
    const first = compileVersion({ id: 'v0', definitionHash: 'h', definition })
    const second = compileVersion({ id: 'v1', definitionHash: 'h', definition })
    for (let index = 2; index < COMPILED_CACHE_SIZE; index++) {
      compileVersion({ id: `v${index}`, definitionHash: 'h', definition })
    }
    // Touch v0 so v1 becomes the least recently used entry.
    expect(compileVersion({ id: 'v0', definitionHash: 'h', definition })).toBe(
      first
    )

    compileVersion({ id: 'overflow', definitionHash: 'h', definition })

    expect(compileVersion({ id: 'v0', definitionHash: 'h', definition })).toBe(
      first
    )
    expect(
      compileVersion({ id: 'v1', definitionHash: 'h', definition })
    ).not.toBe(second)
  })

  test('an unbuildable input contract is 422 TEMPLATE_INVALID and not cached', () => {
    const conflicting = parse({
      kind: 'custom',
      input: {
        fields: [
          { path: 'a', type: 'string' },
          { path: 'a.b', type: 'string' }
        ]
      },
      decisions: [{ label: 'yes' }]
    })

    const error = thrown(() =>
      compileVersion({
        id: 'bad',
        definitionHash: 'h',
        definition: conflicting
      })
    )
    expect(error.status).toBe(422)
    expect(error.code).toBe('TEMPLATE_INVALID')

    // Still failing (not a cached half-built entry).
    expect(() =>
      compileVersion({
        id: 'bad',
        definitionHash: 'h',
        definition: conflicting
      })
    ).toThrow(ApiError)
  })
})

/** `depth` levels of arrays: `nest(1)` is `[]`. */
function nest(depth: number): unknown {
  let value: unknown = []
  for (let level = 1; level < depth; level++) value = [value]
  return value
}

describe('storableJsonIssues()', () => {
  test('accepts ordinary JSON', () => {
    expect(
      storableJsonIssues({ a: 'x', b: [1, true, null, { c: 'y' }], d: 2.5 })
    ).toEqual([])
  })

  test('reports a NUL in any string, at its path', () => {
    expect(
      storableJsonIssues({ a: { b: ['ok', 'x\u0000y'] }, c: '\u0000' })
    ).toEqual([
      { path: ['a', 'b', 1], message: NUL_MESSAGE },
      { path: ['c'], message: NUL_MESSAGE }
    ])
  })

  test('reports a NUL in a key at the object holding it', () => {
    expect(storableJsonIssues({ a: { 'k\u0000': 1 } })).toEqual([
      { path: ['a'], message: 'Keys must not contain NUL characters' }
    ])
  })

  test(`allows ${MAX_JSON_DEPTH} levels of nesting, not one more`, () => {
    expect(storableJsonIssues(nest(MAX_JSON_DEPTH))).toEqual([])
    const [issue, ...rest] = storableJsonIssues(nest(MAX_JSON_DEPTH + 1))
    expect(rest).toEqual([])
    expect(issue?.path).toHaveLength(MAX_JSON_DEPTH)
    expect(issue?.message).toContain(`${MAX_JSON_DEPTH} levels`)
    expect(storableJsonIssues({ a: nest(3) }, 3)).toHaveLength(1)
  })

  test('walks any depth without overflowing the stack', () => {
    // JSON.parse builds it fine; JSON.stringify and recursive schemas overflow.
    const deep = JSON.parse(`${'['.repeat(200_000)}${']'.repeat(200_000)}`)
    expect(() => JSON.stringify(deep)).toThrow(RangeError)
    expect(storableJsonIssues(deep)).toHaveLength(1)
  })

  test('stops after 10 issues', () => {
    const many = Array.from({ length: 1_000 }, () => '\u0000')
    expect(storableJsonIssues(many)).toHaveLength(10)
  })

  test('refineStorableJson reports them as zod issues at their paths', () => {
    const schema = z.object({ v: z.unknown().superRefine(refineStorableJson) })
    const result = schema.safeParse({ v: { a: ['\u0000'] } })
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['v', 'a', 0], message: NUL_MESSAGE })
    ])
  })
})

describe('validateInput() and unstorable input', () => {
  const compiled = () =>
    compileVersion({ id: 'v-json', definitionHash: 'h', definition })

  test('a NUL is 422 VALIDATION_FAILED at its input. path', () => {
    const error = thrown(() =>
      compiled().validateInput({ ticket: { message: 'crash\u0000' } })
    )
    expect(error.status).toBe(422)
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.body).toEqual({
      issues: [
        { path: 'input.ticket.message', message: NUL_MESSAGE, code: 'custom' }
      ]
    })
  })

  test('deep nesting, even under a key the contract strips, is 422', () => {
    const error = thrown(() =>
      compiled().validateInput({
        ticket: { message: 'hello there' },
        extra: nest(100_000)
      })
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    const [issue] = (error.body as { issues: { path: string }[] }).issues
    expect(issue?.path).toStartWith('input.extra.0.0')
  })
})

describe('LruCache', () => {
  test('evicts the least recently used entry past its capacity', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)

    cache.set('c', 3)

    expect(cache.size).toBe(2)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.get('c')).toBe(3)
  })

  test('re-setting a key refreshes it without growing', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10)
    cache.set('c', 3)

    expect(cache.get('a')).toBe(10)
    expect(cache.has('b')).toBe(false)
    expect(cache.size).toBe(2)
  })

  test('get of a missing key is undefined; clear empties it', () => {
    const cache = new LruCache<string, number>(1)
    expect(cache.get('missing')).toBeUndefined()
    cache.set('a', 1)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  test('rejects a capacity below 1', () => {
    expect(() => new LruCache(0)).toThrow(RangeError)
  })
})
