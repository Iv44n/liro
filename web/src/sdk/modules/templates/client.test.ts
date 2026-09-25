import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import { AppError } from '#/sdk/core/app.error'
import { HttpClient } from '#/sdk/http/http-client'
import { reviewsClient } from '#/sdk/modules/reviews/client'
import { runsClient } from '#/sdk/modules/runs/client'
import { v1Client } from '#/sdk/modules/v1/client'
import { templatesClient } from './client'

const definition = {
  kind: 'custom',
  model: { family: 'jev' },
  input: { fields: [] },
  state: {},
  decisions: [],
  preconditions: [],
  questions: {},
  signals: [],
  flagRules: [],
  rules: [],
  fallback: { decision: 'needs_review' }
} satisfies TemplateDefinition

const draft = {
  id: 'ver_1',
  definition,
  definitionHash: 'hash-1',
  updatedAt: '2026-09-01T00:00:00.000Z',
  lint: [],
  changes: [],
  breaking: false,
  nextVersion: { minor: '1.0', major: '1.0' },
  basedOn: null,
  warnings: []
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  })
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn(
    async (_url: URL | RequestInfo, _init?: RequestInit) => response
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const lastCall = (fetchMock: ReturnType<typeof mockFetch>) => {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? []
  return { url: String(url), init: init ?? {} }
}

const dashboard = HttpClient.create({ baseURL: 'http://api.test/api' })
const publicApi = HttpClient.create({ baseURL: 'http://api.test' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('templates.getDraft()', () => {
  it('reads the draft ETag, unquoted', async () => {
    const fetchMock = mockFetch(
      json(draft, { headers: { ETag: '"etag-from-header"' } })
    )

    const result = await templatesClient(dashboard).getDraft('tpl 1')

    expect(result.etag).toBe('etag-from-header')
    expect(result.draft.definitionHash).toBe('hash-1')
    expect(lastCall(fetchMock).url).toBe(
      'http://api.test/api/templates/tpl%201/draft'
    )
  })

  it('falls back to definitionHash when the header is not exposed', async () => {
    mockFetch(json(draft))

    const result = await templatesClient(dashboard).getDraft('tpl_1')

    expect(result.etag).toBe('hash-1')
  })
})

describe('templates.saveDraft()', () => {
  it('sends the definition with a quoted If-Match', async () => {
    const fetchMock = mockFetch(
      json(
        { ...draft, definitionHash: 'hash-2' },
        { headers: { ETag: '"hash-2"' } }
      )
    )

    const result = await templatesClient(dashboard).saveDraft(
      'tpl_1',
      definition,
      'hash-1'
    )

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('http://api.test/api/templates/tpl_1/draft')
    expect(init.method).toBe('PUT')
    const headers = new Headers(init.headers)
    expect(headers.get('If-Match')).toBe('"hash-1"')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ definition })
    expect(result.etag).toBe('hash-2')
  })

  it('throws DRAFT_CONFLICT as an AppError with status and details', async () => {
    mockFetch(
      json(
        {
          error: {
            code: 'DRAFT_CONFLICT',
            message: 'The draft changed',
            details: { currentHash: 'hash-9' }
          }
        },
        { status: 409 }
      )
    )

    const error = await templatesClient(dashboard)
      .saveDraft('tpl_1', definition, 'hash-1')
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'DRAFT_CONFLICT',
      status: 409,
      details: { currentHash: 'hash-9' }
    })
  })
})

describe('templates.lint()', () => {
  it('posts to /templates/lint and returns the body as-is (no envelope)', async () => {
    const fetchMock = mockFetch(
      json({ lint: [], changes: [{ path: 'kind', severity: 'breaking' }] })
    )

    const result = await templatesClient(dashboard).lint({
      definition,
      templateId: 'tpl_1'
    })

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('http://api.test/api/templates/lint')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      definition,
      templateId: 'tpl_1'
    })
    expect(result).toEqual({
      lint: [],
      changes: [{ path: 'kind', severity: 'breaking' }]
    })
  })
})

describe('envelopes and query strings', () => {
  it('unwraps `{ data }` and passes the status filter', async () => {
    const fetchMock = mockFetch(json({ data: [{ id: 'tpl_1' }] }))

    const templates = await templatesClient(dashboard).list({
      status: 'archived'
    })

    expect(templates).toEqual([{ id: 'tpl_1' }])
    expect(lastCall(fetchMock).url).toBe(
      'http://api.test/api/templates?status=archived'
    )
  })

  it('keeps the cursor page of runs and skips empty filters', async () => {
    const fetchMock = mockFetch(json({ data: [], nextCursor: null }))

    const page = await runsClient(dashboard).list({
      templateId: 'tpl_1',
      decision: undefined,
      cursor: 'run_9',
      limit: 20
    })

    expect(page).toEqual({ data: [], nextCursor: null })
    expect(lastCall(fetchMock).url).toBe(
      'http://api.test/api/runs?templateId=tpl_1&cursor=run_9&limit=20'
    )
  })

  it('dismisses a review with an empty JSON body by default', async () => {
    const fetchMock = mockFetch(json({ review: { id: 'rev_1' } }))

    const review = await reviewsClient(dashboard).dismiss('rev_1')

    const { url, init } = lastCall(fetchMock)
    expect(review).toEqual({ id: 'rev_1' })
    expect(url).toBe('http://api.test/api/reviews/rev_1/dismiss')
    expect(init.body).toBe('{}')
  })
})

describe('v1.decisions.run()', () => {
  it('calls /v1 without the /api prefix, with an Idempotency-Key', async () => {
    const fetchMock = mockFetch(json({ id: 'run_1', decision: 'yes' }))

    const run = await v1Client(publicApi).decisions.run(
      'ticket-triage@1',
      { input: { message: 'hola' } },
      { idempotencyKey: 'key-1' }
    )

    const { url, init } = lastCall(fetchMock)
    expect(run).toMatchObject({ id: 'run_1' })
    expect(url).toBe('http://api.test/v1/decisions/ticket-triage%401/run')
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-1')
    expect(JSON.parse(String(init.body))).toEqual({
      input: { message: 'hola' }
    })
  })

  it('omits the Idempotency-Key header when not given', async () => {
    const fetchMock = mockFetch(json({ id: 'run_1' }))

    await v1Client(publicApi).decisions.run('ticket-triage', { input: {} })

    const { init } = lastCall(fetchMock)
    expect(new Headers(init.headers).has('Idempotency-Key')).toBe(false)
  })
})
