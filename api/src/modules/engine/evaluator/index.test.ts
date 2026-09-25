import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import triageRequest from '#/../test/fixtures/evaluator/support-triage.request.json'
import typesafeTriage from '#/../test/fixtures/evaluator/typesafe/support-triage.response.json'
import { FakeEvaluator } from './adapters/fake'
import { TYPESAFE_API_URL } from './adapters/typesafe'
import {
  createAdapter,
  createFallbackAdapter,
  decorateEvaluator,
  getEvaluator,
  getFakeEvaluator
} from './index'
import type { EvaluationRequest, Evaluator } from './port'

type Config = Parameters<typeof createAdapter>[0]

const config = (overrides: Partial<Config> = {}): Config => ({
  EVALUATOR_PROVIDER: 'fake',
  EVALUATOR_FALLBACK_PROVIDER: undefined,
  AI_GATEWAY_API_KEY: undefined,
  TYPESAFE_API_KEY: undefined,
  JEV_MODEL_VERSION: undefined,
  ...overrides
})

const request: EvaluationRequest = {
  state: { ticket: 'I was charged twice' },
  questions: {
    refund_requested: {
      type: 'boolean',
      instructions: 'Does the customer ask for a refund?'
    }
  },
  model: { family: 'jev' },
  organizationId: 'org_factory',
  priority: 'live'
}

describe('createAdapter', () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined

  afterEach(() => {
    fetchSpy?.mockRestore()
    fetchSpy = undefined
  })

  test('builds the adapter EVALUATOR_PROVIDER names', () => {
    expect(createAdapter(config())).toBeInstanceOf(FakeEvaluator)
    expect(
      createAdapter(
        config({
          EVALUATOR_PROVIDER: 'vercel-gateway',
          AI_GATEWAY_API_KEY: 'gw_x'
        })
      ).provider
    ).toBe('vercel-gateway')

    const typesafe = createAdapter(
      config({ EVALUATOR_PROVIDER: 'typesafe', TYPESAFE_API_KEY: 'ts_x' })
    )
    expect(typesafe.provider).toBe('typesafe')
    expect(typesafe.capabilities.versionedModels).toBe(true)
  })

  test("refuses a provider whose key isn't configured", () => {
    expect(() =>
      createAdapter(config({ EVALUATOR_PROVIDER: 'vercel-gateway' }))
    ).toThrow('AI_GATEWAY_API_KEY')
    expect(() =>
      createAdapter(config({ EVALUATOR_PROVIDER: 'typesafe' }))
    ).toThrow('TYPESAFE_API_KEY')
  })

  test('the typesafe adapter calls the official API with JEV_MODEL_VERSION pinned', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(typesafeTriage.body), {
        headers: typesafeTriage.headers
      })
    )
    const questions = triageRequest.questions as EvaluationRequest['questions']

    const result = await createAdapter(
      config({
        EVALUATOR_PROVIDER: 'typesafe',
        TYPESAFE_API_KEY: 'ts_x',
        JEV_MODEL_VERSION: '1.13.0'
      })
    ).evaluate({ ...request, questions })

    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe(`${TYPESAFE_API_URL}/v1/systemone`)
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'jev-1.13.0'
    })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ts_x')
    expect(result.model.requested).toBe('jev-1.13.0')
  })

  test('createFallbackAdapter builds EVALUATOR_FALLBACK_PROVIDER, if any', () => {
    expect(createFallbackAdapter(config())).toBeUndefined()

    const fallback = createFallbackAdapter(
      config({
        EVALUATOR_PROVIDER: 'typesafe',
        EVALUATOR_FALLBACK_PROVIDER: 'vercel-gateway',
        TYPESAFE_API_KEY: 'ts_x',
        AI_GATEWAY_API_KEY: 'gw_x'
      })
    )
    expect(fallback?.provider).toBe('vercel-gateway')
  })
})

describe('decorateEvaluator', () => {
  test('without a fallback, decorates the adapter alone', async () => {
    const fake = new FakeEvaluator()
    const evaluator = decorateEvaluator(fake)

    expect(evaluator.provider).toBe('fake')
    expect(evaluator.capabilities).toEqual(fake.capabilities)

    await evaluator.evaluate(request)
    expect(fake.calls[0]?.deadline).toBeNumber()
    expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  test('the fallback sits inside retry: each attempt tries primary then secondary', async () => {
    const primary = new FakeEvaluator()
      .fail('UNAVAILABLE', { retryAfterMs: 1 })
      .fail('UNAVAILABLE', { retryAfterMs: 1 })
    const secondary = new FakeEvaluator().fail('OVERLOADED')
    const gatewaySized: Evaluator = {
      provider: secondary.provider,
      capabilities: { ...secondary.capabilities, maxContextTokens: 32_000 },
      evaluate: req => secondary.evaluate(req)
    }

    const evaluator = decorateEvaluator(primary, gatewaySized)
    const result = await evaluator.evaluate(request)

    expect(result.answers.refund_requested?.type).toBe('boolean')
    // Attempt 1: primary down, secondary overloaded → retry.
    // Attempt 2: primary down, secondary answers.
    expect(primary.calls).toHaveLength(2)
    expect(secondary.calls).toHaveLength(2)
    expect(evaluator.capabilities.maxContextTokens).toBe(32_000)
  })

  test('a non-retryable primary failure never reaches the fallback', async () => {
    const primary = new FakeEvaluator().fail('INPUT_TOO_LARGE')
    const secondary = new FakeEvaluator()

    const error = await decorateEvaluator(primary, secondary)
      .evaluate(request)
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'INPUT_TOO_LARGE' })
    expect(secondary.calls).toHaveLength(0)
  })
})

describe('getEvaluator', () => {
  test('is a process-wide singleton over the configured adapter (fake in tests)', () => {
    expect(getEvaluator()).toBe(getEvaluator())
    expect(getEvaluator().provider).toBe('fake')
    expect(getFakeEvaluator()).toBeInstanceOf(FakeEvaluator)
  })
})
