import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { type EvaluationRequest, EvaluatorError } from '../port'
import {
  createTypeSafeEvaluator,
  TYPESAFE_API_URL,
  toEvaluatorError,
  typeSafeModelId
} from './typesafe'

/**
 * Edge cases of the TypeSafe adapter beyond the shared contract
 * (evaluator.contract.test.ts): the rest of the error mapping, response
 * validation and the SDK settings Liro depends on.
 */

const request: EvaluationRequest = {
  state: { ticket: 'I was charged twice' },
  questions: {
    category: {
      type: 'choice',
      instructions: 'What is the ticket about?',
      criteria: { billing: null, bug: null }
    },
    severity: {
      type: 'score',
      instructions: 'How blocked is the customer?',
      criteria: ['Not blocked', 'Blocked']
    },
    refund: { type: 'boolean', instructions: 'Is a refund requested?' }
  },
  model: { family: 'jev' },
  organizationId: 'org_typesafe',
  priority: 'live'
}

const okBody = {
  model: 'jev-1.13.0',
  answers: {
    category: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.8, bug: 0.2 },
      confidence: 0.6
    },
    severity: {
      type: 'score',
      score: 0.25,
      legend: { '0': 'Not blocked', '1': 'Blocked' },
      probabilities: { '0': 0.75, '1': 0.25 },
      confidence: 0.5
    },
    refund: { type: 'noul', noul: 0.9 }
  },
  usage: { input_tokens: 90, output_tokens: 12 }
}

function respondWith(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input.toString(), init })
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      {
        status,
        headers: { 'content-type': 'application/json', ...headers }
      }
    )
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const evaluatorFor = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  createTypeSafeEvaluator({
    apiKey: 'test-key',
    baseURL: 'https://typesafe.test',
    fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  })

async function failure(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<EvaluatorError> {
  const { fetch } = respondWith(status, body, headers)
  return evaluatorFor(fetch)
    .evaluate(request)
    .then(
      () => {
        throw new Error('Expected the evaluation to fail')
      },
      (error: EvaluatorError) => error
    )
}

describe('typeSafeModelId', () => {
  test('prefixes versions and defaults to the jev-latest alias', () => {
    expect(typeSafeModelId({ family: 'jev', version: '1.13.0' })).toBe(
      'jev-1.13.0'
    )
    expect(typeSafeModelId({ family: 'jev' }, '1.12.0')).toBe('jev-1.12.0')
    expect(typeSafeModelId({ family: 'jev', version: '' }, '1.12.0')).toBe(
      'jev-1.12.0'
    )
    expect(typeSafeModelId({ family: 'jev' })).toBe('jev-latest')
    // A full model id (or alias) is accepted as-is.
    expect(typeSafeModelId({ family: 'jev' }, 'jev-preview')).toBe(
      'jev-preview'
    )
  })
})

describe('TypeSafe error mapping', () => {
  test.each([
    [403, { detail: 'Forbidden' }, 'AUTH'],
    [503, { detail: 'Service unavailable' }, 'UNAVAILABLE'],
    [502, 'Bad gateway', 'UNAVAILABLE'],
    [408, { detail: 'Request timeout' }, 'TIMEOUT'],
    [413, 'Payload too large', 'INPUT_TOO_LARGE'],
    [
      400,
      { detail: 'State exceeds the 32k context budget' },
      'INPUT_TOO_LARGE'
    ],
    [404, { detail: 'Model jev-0.0.1 does not exist' }, 'MODEL_NOT_FOUND'],
    [404, { detail: 'Not found' }, 'INVALID_REQUEST'],
    [400, { detail: 'questions must not be empty' }, 'INVALID_REQUEST'],
    [400, { detail: 'Unknown model: jev-9.9.9' }, 'MODEL_NOT_FOUND'],
    [400, { detail: "Model 'jev-0.1.0' not found" }, 'MODEL_NOT_FOUND'],
    // Mentioning the model is not enough: MODEL_NOT_FOUND retires a
    // published version for good.
    [
      400,
      { detail: 'The model could not parse question severity' },
      'INVALID_REQUEST'
    ],
    [400, { detail: 'state is required by the model' }, 'INVALID_REQUEST'],
    [422, { detail: 'choice criteria exceed 255 options' }, 'INVALID_REQUEST'],
    [
      422,
      { detail: 'Request has 71234 tokens, over the limit' },
      'INPUT_TOO_LARGE'
    ],
    [409, { detail: 'Conflict' }, 'INVALID_REQUEST']
  ] as const)('%i %j → %s', async (status, body, code) => {
    const error = await failure(status, body)

    expect(error).toBeInstanceOf(EvaluatorError)
    expect(error.code).toBe(code)
    expect(error.provider).toBe('typesafe')
  })

  test('honors retry-after-ms and HTTP-date Retry-After, and keeps the request id', async () => {
    const ms = await failure(
      529,
      { detail: 'Overloaded' },
      { 'retry-after-ms': '750', 'x-typesafe-request-id': 'req_529' }
    )
    expect(ms).toMatchObject({
      code: 'OVERLOADED',
      retryAfterMs: 750,
      providerRequestId: 'req_529',
      retryable: true
    })
    expect(ms.scope).toBeUndefined()

    const date = await failure(
      429,
      { detail: 'Slow down' },
      { 'retry-after': new Date(Date.now() + 60_000).toUTCString() }
    )
    expect(date.retryAfterMs).toBeGreaterThan(50_000)
    expect(date.retryAfterMs).toBeLessThanOrEqual(60_000)

    const invalid = await failure(
      429,
      { detail: 'Slow down' },
      { 'retry-after': 'soon' }
    )
    expect(invalid.retryAfterMs).toBeUndefined()

    const negative = await failure(
      429,
      { detail: 'Slow down' },
      { 'retry-after': '-1' }
    )
    expect(negative.retryAfterMs).toBeUndefined()
  })

  test('error messages never carry the raw body (it may echo the state)', async () => {
    const secret = 'SECRET-STATE'
    const echoed = await failure(422, {
      detail: [{ loc: ['body', 'state'], type: 'x', input: secret }]
    })
    expect(echoed.code).toBe('INVALID_REQUEST')
    expect(echoed.message).toBe('422 error from TypeSafe (no details)')

    const validation = await failure(422, {
      detail: [
        { loc: ['body', 'model'], msg: 'Input should be a string', input: 7 },
        { loc: ['body', 'state'], msg: 'Field required', input: secret }
      ]
    })
    expect(validation.message).toBe(
      '422 model: Input should be a string; state: Field required'
    )

    const shapes = [
      [{ error: 'plain error' }, '400 plain error'],
      [{ error: { message: 'nested error' } }, '400 nested error'],
      [{ message: 'top message' }, '400 top message'],
      [{ detail: { message: 'detail message' } }, '400 detail message'],
      [{ detail: [{ msg: 'no location' }] }, '400 no location'],
      ['', '400 error from TypeSafe (no details)']
    ] as const
    for (const [body, message] of shapes) {
      expect((await failure(400, body)).message).toBe(message)
    }

    const long = await failure(400, { detail: 'x'.repeat(1_000) })
    expect(long.message.length).toBeLessThanOrEqual(301)
    expect(long.message.endsWith('…')).toBe(true)
  })

  test('an already-aborted request never reaches the network', async () => {
    const { fetch, calls } = respondWith(200, okBody)
    const controller = new AbortController()
    controller.abort()

    const error = await evaluatorFor(fetch)
      .evaluate({ ...request, signal: controller.signal })
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({ code: 'TIMEOUT', provider: 'typesafe' })
    expect(calls).toHaveLength(0)
  })

  test("the server's status wins over a signal that fired while reading it", async () => {
    const { fetch } = respondWith(401, { detail: 'Invalid API key' })
    const controller = new AbortController()
    const error = await evaluatorFor(fetch)
      .evaluate({ ...request, signal: controller.signal })
      .catch((err: unknown) => err)
    controller.abort()

    expect(
      toEvaluatorError((error as EvaluatorError).cause, controller.signal)
    ).toMatchObject({ code: 'AUTH', retryable: false })
  })

  test('a connection failure is UNAVAILABLE', async () => {
    const refused = (async () => {
      throw new TypeError('fetch failed: ECONNREFUSED')
    }) as unknown as typeof globalThis.fetch

    const error = await evaluatorFor(refused)
      .evaluate(request)
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({ code: 'UNAVAILABLE', retryable: true })
  })

  test("the SDK's per-attempt timeout is TIMEOUT", async () => {
    const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('x')))
      })) as typeof globalThis.fetch

    const error = await evaluatorFor(hanging, 5)
      .evaluate(request)
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({ code: 'TIMEOUT', retryable: true })
  })

  test('questions the SDK rejects before any I/O are INVALID_REQUEST', async () => {
    const { fetch, calls } = respondWith(200, okBody)

    const error = await evaluatorFor(fetch)
      .evaluate({
        ...request,
        questions: {
          severity: {
            type: 'score',
            instructions: 'How blocked?',
            criteria: ['Only one level']
          }
        }
      })
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({ code: 'INVALID_REQUEST', retryable: false })
    expect(calls).toHaveLength(0)
  })

  test('passes EvaluatorErrors through and wraps anything unknown', () => {
    const original = new EvaluatorError('AUTH', 'nope')
    expect(toEvaluatorError(original)).toBe(original)
    expect(toEvaluatorError('boom')).toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Unknown evaluator error'
    })
    expect(toEvaluatorError(new Error('weird'))).toMatchObject({
      code: 'UNAVAILABLE',
      message: 'weird'
    })
  })
})

describe('TypeSafe response validation', () => {
  const withAnswers = (answers: Record<string, unknown>) => ({
    ...okBody,
    answers: { ...okBody.answers, ...answers }
  })

  test.each([
    ['a non-JSON body', 'upstream proxy error page'],
    ['a body without answers', { model: 'jev-1.13.0' }],
    [
      'a missing answer',
      { ...okBody, answers: { category: okBody.answers.category } }
    ],
    [
      'a noul answer to a choice question',
      withAnswers({ category: { type: 'noul', noul: 0.5 } })
    ],
    [
      'a choice answer without probabilities',
      withAnswers({ category: { type: 'choice', choice: 'billing' } })
    ],
    [
      'a score outside its levels',
      withAnswers({ severity: { ...okBody.answers.severity, score: 1.5 } })
    ],
    [
      'a noul outside [0, 1]',
      withAnswers({ refund: { type: 'noul', noul: 1.2 } })
    ]
  ])('%s is BAD_RESPONSE', async (_, body) => {
    const error = await failure(200, body, {
      'x-typesafe-request-id': 'req_bad'
    })

    expect(error).toMatchObject({
      code: 'BAD_RESPONSE',
      retryable: false,
      providerRequestId: 'req_bad'
    })
  })

  test('maps a valid answer set and ignores answers nobody asked for', async () => {
    const { fetch } = respondWith(
      200,
      withAnswers({ extra: { type: 'noul', noul: 0.1 } })
    )

    const result = await evaluatorFor(fetch).evaluate(request)

    expect(result.answers).toEqual({
      category: {
        type: 'choice',
        choice: 'billing',
        probabilities: { billing: 0.8, bug: 0.2 }
      },
      severity: {
        type: 'score',
        score: 0.25,
        probabilities: { '0': 0.75, '1': 0.25 }
      },
      refund: { type: 'boolean', probability: 0.9 }
    })
    expect(result.providerRequestId).toBeNull()
  })

  test('missing usage and model become null (never invented)', async () => {
    const { fetch } = respondWith(200, {
      answers: okBody.answers
    })

    const result = await evaluatorFor(fetch).evaluate(request)

    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null })
    expect(result.model).toEqual({ requested: 'jev-latest', resolved: null })
  })
})

describe('TypeSafe SDK settings', () => {
  const saved = { ...process.env }

  afterEach(() => {
    for (const key of ['TYPESAFE_LOG_LEVEL', 'TYPESAFE_BASE_URL']) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("SDK environment variables can't turn on body logging or redirect traffic", async () => {
    process.env.TYPESAFE_LOG_LEVEL = 'debug'
    process.env.TYPESAFE_BASE_URL = 'https://attacker.test'
    const debug = spyOn(console, 'debug').mockImplementation(() => {})
    const info = spyOn(console, 'info').mockImplementation(() => {})
    const { fetch, calls } = respondWith(200, okBody)

    try {
      await createTypeSafeEvaluator({ apiKey: 'test-key', fetch }).evaluate(
        request
      )

      expect(calls[0]?.url).toBe(`${TYPESAFE_API_URL}/v1/systemone`)
      expect(debug).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
    } finally {
      debug.mockRestore()
      info.mockRestore()
    }
  })
})
