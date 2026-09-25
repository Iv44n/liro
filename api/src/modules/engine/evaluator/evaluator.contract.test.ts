import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import canonicalAnswers from '#/../test/fixtures/evaluator/support-triage.canonical.json'
import triageRequest from '#/../test/fixtures/evaluator/support-triage.request.json'
import typesafeErrors from '#/../test/fixtures/evaluator/typesafe/support-triage.errors.json'
import typesafeTriage from '#/../test/fixtures/evaluator/typesafe/support-triage.response.json'
import gatewayNoProbabilities from '#/../test/fixtures/evaluator/vercel-gateway/support-triage.no-probabilities.response.json'
import gatewayTriage from '#/../test/fixtures/evaluator/vercel-gateway/support-triage.response.json'
import { FakeEvaluator } from './adapters/fake'
import {
  createTypeSafeEvaluator,
  type TypeSafeEvaluatorOptions
} from './adapters/typesafe'
import { createVercelGatewayEvaluator } from './adapters/vercel-gateway'
import {
  type CanonicalAnswer,
  type EvaluationRequest,
  type Evaluator,
  EvaluatorError,
  type EvaluatorErrorCode
} from './port'

/**
 * The contract every provider adapter must honor: the same canonical request
 * yields the same canonical answers, and provider failures map to the same
 * `EvaluatorError` codes. A new adapter is added to `adapters` below with
 * its own wire fixtures (test/fixtures/evaluator/<provider>/).
 */

interface RecordedResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

const request: EvaluationRequest = {
  ...(triageRequest as Pick<EvaluationRequest, 'state' | 'questions'>),
  model: { family: 'jev' },
  organizationId: 'org_contract',
  priority: 'live'
}

const expectedAnswers = canonicalAnswers as Record<string, CanonicalAnswer>

/** A `fetch` that replays one recorded response and captures what was sent. */
function replay(recorded: RecordedResponse) {
  const sent: { url: string; body: unknown; headers: Headers }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: input.toString(),
      body: JSON.parse(String(init?.body ?? 'null')),
      headers: new Headers(init?.headers)
    })
    return new Response(JSON.stringify(recorded.body), {
      status: recorded.status,
      headers: recorded.headers
    })
  }) as typeof globalThis.fetch
  return { fetch, sent }
}

const gatewayWith = (recorded: RecordedResponse) => {
  const { fetch, sent } = replay(recorded)
  const evaluator = createVercelGatewayEvaluator({
    apiKey: 'test-key',
    baseURL: 'https://gateway.test/v4/ai',
    fetch
  })
  return { evaluator, sent }
}

const typesafeWith = (
  recorded: RecordedResponse,
  options: Partial<TypeSafeEvaluatorOptions> = {}
) => {
  const { fetch, sent } = replay(recorded)
  const evaluator = createTypeSafeEvaluator({
    apiKey: 'test-key',
    baseURL: 'https://typesafe.test',
    fetch,
    ...options
  })
  return { evaluator, sent }
}

interface AdapterHarness {
  name: string
  /** An evaluator that will answer `request` with `expectedAnswers`. */
  answering(): Evaluator
  /** An evaluator whose next call fails the way `code` manifests for this provider. */
  failing(code: EvaluatorErrorCode): Evaluator | null
}

const gatewayErrors: Partial<Record<EvaluatorErrorCode, RecordedResponse>> = {
  RATE_LIMITED: {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '2' },
    body: {
      error: { message: 'Rate limit exceeded', type: 'rate_limit_exceeded' }
    }
  },
  AUTH: {
    status: 401,
    headers: { 'content-type': 'application/json' },
    body: {
      error: { message: 'Invalid API key', type: 'authentication_error' }
    }
  },
  MODEL_NOT_FOUND: {
    status: 404,
    headers: { 'content-type': 'application/json' },
    body: {
      error: {
        message: 'Model typesafe-ai/jev not found',
        type: 'model_not_found',
        param: { modelId: 'typesafe-ai/jev' }
      }
    }
  },
  INPUT_TOO_LARGE: {
    status: 400,
    headers: { 'content-type': 'application/json' },
    body: {
      error: {
        message: 'State exceeds the context window',
        type: 'invalid_request_error'
      }
    }
  },
  INVALID_REQUEST: {
    status: 400,
    headers: { 'content-type': 'application/json' },
    body: {
      error: {
        message: 'questions.severity: invalid',
        type: 'invalid_request_error'
      }
    }
  },
  OVERLOADED: {
    status: 503,
    headers: { 'content-type': 'application/json' },
    body: { error: { message: 'Overloaded', type: 'internal_server_error' } }
  },
  UNAVAILABLE: {
    status: 500,
    headers: { 'content-type': 'application/json' },
    body: {
      error: { message: 'Internal error', type: 'internal_server_error' }
    }
  },
  BAD_RESPONSE: {
    // A choice outside the question's options fails the AI SDK's validation.
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: {
      answers: {
        category: { type: 'choice', choice: 'not-an-option' },
        severity: { type: 'score', score: 0.5 },
        refund_requested: { type: 'boolean', probability: 0.9 }
      }
    }
  }
}

const adapters: AdapterHarness[] = [
  {
    name: 'vercel-gateway',
    answering: () => gatewayWith(gatewayTriage).evaluator,
    failing: code => {
      const recorded = gatewayErrors[code]
      return recorded ? gatewayWith(recorded).evaluator : null
    }
  },
  {
    name: 'typesafe',
    answering: () => typesafeWith(typesafeTriage).evaluator,
    failing: code => {
      const recorded = (
        typesafeErrors as Partial<Record<EvaluatorErrorCode, RecordedResponse>>
      )[code]
      return recorded ? typesafeWith(recorded).evaluator : null
    }
  },
  {
    name: 'fake',
    answering: () => new FakeEvaluator().enqueue(expectedAnswers),
    failing: code => new FakeEvaluator().fail(code)
  }
]

const errorCodes: EvaluatorErrorCode[] = [
  'RATE_LIMITED',
  'AUTH',
  'MODEL_NOT_FOUND',
  'INPUT_TOO_LARGE',
  'INVALID_REQUEST',
  'OVERLOADED',
  'UNAVAILABLE',
  'BAD_RESPONSE'
]

for (const adapter of adapters) {
  describe(`${adapter.name} adapter contract`, () => {
    test('produces the canonical answers', async () => {
      const result = await adapter.answering().evaluate(request)

      expect(result.answers).toEqual(expectedAnswers)
      expect(result.usage.inputTokens).toBeGreaterThan(0)
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    test.each(errorCodes)('maps provider failures to %s', async code => {
      const evaluator = adapter.failing(code)
      if (!evaluator) return

      const error = await evaluator.evaluate(request).then(
        () => null,
        (err: unknown) => err
      )

      expect(error).toBeInstanceOf(EvaluatorError)
      expect((error as EvaluatorError).code).toBe(code)
      expect((error as EvaluatorError).retryable).toBe(
        ['RATE_LIMITED', 'OVERLOADED', 'UNAVAILABLE', 'TIMEOUT'].includes(code)
      )
    })
  })
}

/**
 * Responses recorded from the real providers (`bun run fixtures:record`): the
 * answers vary between recordings, so they're checked for shape and
 * consistency rather than against `expectedAnswers`.
 */
const recordedSources: {
  provider: string
  replayWith: (recorded: RecordedResponse) => Evaluator
}[] = [
  {
    provider: 'vercel-gateway',
    replayWith: recorded => gatewayWith(recorded).evaluator
  },
  {
    provider: 'typesafe',
    replayWith: recorded => typesafeWith(recorded).evaluator
  }
]

for (const { provider, replayWith } of recordedSources) {
  const recordedDir = new URL(
    `../../../../test/fixtures/evaluator/${provider}/recorded/`,
    import.meta.url
  )
  const recordedFiles = existsSync(recordedDir) ? readdirSync(recordedDir) : []

  describe.skipIf(recordedFiles.length === 0)(
    `${provider} recorded responses`,
    () => {
      test.each(recordedFiles)(
        '%s parses into valid canonical answers',
        async file => {
          const recorded = JSON.parse(
            readFileSync(new URL(file, recordedDir), 'utf8')
          )
          const result = await replayWith(recorded).evaluate(request)

          for (const [key, question] of Object.entries(request.questions)) {
            const answer = result.answers[key]
            expect(answer?.type).toBe(question.type)
            if (answer?.type === 'choice' && question.type === 'choice') {
              expect(Object.keys(question.criteria)).toContain(answer.choice)
            }
            if (answer?.type !== 'boolean' && answer?.probabilities) {
              const total = Object.values(answer.probabilities).reduce(
                (sum, p) => sum + p,
                0
              )
              expect(total).toBeCloseTo(1, 2)
            }
          }
        }
      )
    }
  )
}

describe('vercel-gateway specifics', () => {
  test('sends the canonical questions unchanged to /evaluation-model', async () => {
    const { evaluator, sent } = gatewayWith(gatewayTriage)

    await evaluator.evaluate(request)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://gateway.test/v4/ai/evaluation-model')
    expect(sent[0]?.headers.get('ai-model-id')).toBe('typesafe-ai/jev')
    expect(sent[0]?.body).toMatchObject({
      state: request.state,
      questions: request.questions
    })
  })

  test('records provider, model and request id', async () => {
    const result = await gatewayWith(gatewayTriage).evaluator.evaluate(request)

    expect(result.provider).toBe('vercel-gateway')
    expect(result.model.requested).toBe('typesafe-ai/jev')
    expect(result.providerRequestId).toBe('iad1::fixture-123')
    expect(result.usage).toEqual({ inputTokens: 212, outputTokens: 0 })
  })

  test('answers without probabilities become null (never invented)', async () => {
    const result = await gatewayWith(gatewayNoProbabilities).evaluator.evaluate(
      request
    )

    expect(result.answers.category).toEqual({
      type: 'choice',
      choice: 'billing',
      probabilities: null
    })
    expect(result.answers.severity).toEqual({
      type: 'score',
      score: 0.5,
      probabilities: null
    })
    expect(result.usage.outputTokens).toBeNull()
  })

  test('surfaces Retry-After on rate limits, scoped to the provider', async () => {
    const recorded = gatewayErrors.RATE_LIMITED as RecordedResponse
    const error = await gatewayWith(recorded)
      .evaluator.evaluate(request)
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      scope: 'provider',
      retryAfterMs: 2_000
    })
  })

  test('an aborted request reports TIMEOUT', async () => {
    const controller = new AbortController()
    controller.abort()

    const error = await gatewayWith(gatewayTriage)
      .evaluator.evaluate({ ...request, signal: controller.signal })
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({ code: 'TIMEOUT' })
  })

  test('declares the capabilities the engine relies on', () => {
    const { evaluator } = gatewayWith(gatewayTriage)

    expect(evaluator.capabilities).toEqual({
      probabilities: 'optional',
      versionedModels: false,
      maxContextTokens: 32_000,
      questionTypes: ['choice', 'score', 'boolean']
    })
  })
})

describe('typesafe specifics', () => {
  test('sends one POST /v1/systemone with booleans as noul questions', async () => {
    const { evaluator, sent } = typesafeWith(typesafeTriage)

    await evaluator.evaluate(request)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://typesafe.test/v1/systemone')
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer test-key')
    expect(sent[0]?.body).toEqual({
      state: request.state,
      model: 'jev-latest',
      questions: {
        category: request.questions.category,
        severity: request.questions.severity,
        refund_requested: {
          type: 'noul',
          instructions: 'Does the customer explicitly ask for a refund?',
          criteria: {
            true: 'Asks for money back',
            false: 'No refund requested'
          }
        }
      }
    })
  })

  test('pins jev-<version> from the request, else the configured version, else jev-latest', async () => {
    const pinned = typesafeWith(typesafeTriage)
    const result = await pinned.evaluator.evaluate({
      ...request,
      model: { family: 'jev', version: '1.13.0' }
    })
    expect(pinned.sent[0]?.body).toMatchObject({ model: 'jev-1.13.0' })
    expect(result.model).toEqual({
      requested: 'jev-1.13.0',
      resolved: 'jev-1.13.0'
    })

    const configured = typesafeWith(typesafeTriage, { modelVersion: '1.12.0' })
    await configured.evaluator.evaluate(request)
    await configured.evaluator.evaluate({
      ...request,
      model: { family: 'jev', version: '1.13.0' }
    })
    expect(configured.sent.map(call => call.body)).toMatchObject([
      { model: 'jev-1.12.0' },
      { model: 'jev-1.13.0' }
    ])

    const latest =
      await typesafeWith(typesafeTriage).evaluator.evaluate(request)
    expect(latest.model).toEqual({
      requested: 'jev-latest',
      resolved: 'jev-1.13.0'
    })
  })

  test('records provider, request id and usage', async () => {
    const result =
      await typesafeWith(typesafeTriage).evaluator.evaluate(request)

    expect(result.provider).toBe('typesafe')
    expect(result.providerRequestId).toBe('req_fixture_123')
    expect(result.usage).toEqual({ inputTokens: 212, outputTokens: 18 })
  })

  test('discards the native confidence and legend (Liro computes its own)', async () => {
    const result =
      await typesafeWith(typesafeTriage).evaluator.evaluate(request)

    expect(result.answers.category).not.toHaveProperty('confidence')
    expect(result.answers.severity).not.toHaveProperty('confidence')
    expect(result.answers.severity).not.toHaveProperty('legend')
    expect(result.answers.refund_requested).toEqual({
      type: 'boolean',
      probability: 0.93
    })
  })

  test('surfaces Retry-After and the request id on rate limits, scoped to the provider', async () => {
    const error = await typesafeWith(
      typesafeErrors.RATE_LIMITED as RecordedResponse
    )
      .evaluator.evaluate(request)
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      scope: 'provider',
      retryAfterMs: 2_000,
      provider: 'typesafe',
      providerRequestId: 'req_rate_limited'
    })
  })

  test("the SDK's own retries are off: one failed response, one request", async () => {
    const { evaluator, sent } = typesafeWith(
      typesafeErrors.OVERLOADED as RecordedResponse
    )

    await evaluator.evaluate(request).catch(() => null)

    expect(sent).toHaveLength(1)
  })

  test('an aborted request reports TIMEOUT', async () => {
    const controller = new AbortController()
    controller.abort()

    const error = await typesafeWith(typesafeTriage)
      .evaluator.evaluate({ ...request, signal: controller.signal })
      .catch((err: EvaluatorError) => err)

    expect(error).toMatchObject({ code: 'TIMEOUT', provider: 'typesafe' })
  })

  test('aborting mid-flight reaches the HTTP call and reports TIMEOUT', async () => {
    let received: AbortSignal | undefined
    const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        received = init?.signal ?? undefined
        received?.addEventListener('abort', () => reject(received?.reason), {
          once: true
        })
      })) as typeof globalThis.fetch
    const evaluator = createTypeSafeEvaluator({
      apiKey: 'test-key',
      baseURL: 'https://typesafe.test',
      fetch: hanging
    })
    const controller = new AbortController()

    const pending = evaluator
      .evaluate({ ...request, signal: controller.signal })
      .catch((err: EvaluatorError) => err)
    setTimeout(() => controller.abort(new Error('deadline')), 5)

    expect(await pending).toMatchObject({ code: 'TIMEOUT' })
    expect(received?.aborted).toBe(true)
  })

  test('declares the capabilities the engine relies on', () => {
    const { evaluator } = typesafeWith(typesafeTriage)

    expect(evaluator.capabilities).toEqual({
      probabilities: 'always',
      versionedModels: true,
      maxContextTokens: 64_000,
      questionTypes: ['choice', 'score', 'boolean']
    })
  })
})
