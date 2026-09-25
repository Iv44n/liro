import { describe, expect, test } from 'bun:test'
import triageRequest from '#/../test/fixtures/evaluator/support-triage.request.json'
import { createTypeSafeEvaluator } from '#modules/engine/evaluator/adapters/typesafe'
import type { EvaluationRequest } from '#modules/engine/evaluator/port'

/**
 * Real calls to TypeSafe's official API (costs a fraction of a cent). Run with
 * `bun run test:smoke` and TYPESAFE_API_KEY set; skipped otherwise.
 */
const apiKey = process.env.TYPESAFE_API_KEY
// JEV_MODEL_VERSION may be `1.13.0` or `jev-1.13.0`; an alias can't be checked here.
const pinnedVersion = (process.env.JEV_MODEL_VERSION || '1.13.0').replace(
  /^jev-/,
  ''
)
const checkablePin = /^\d+\.\d+\.\d+$/.test(pinnedVersion)
  ? pinnedVersion
  : '1.13.0'

const request: EvaluationRequest = {
  ...(triageRequest as Pick<EvaluationRequest, 'state' | 'questions'>),
  model: { family: 'jev' },
  organizationId: 'smoke',
  priority: 'live'
}

describe.skipIf(!apiKey)('TypeSafe official API (live)', () => {
  // Built per test: the describe body runs even when skipped (no key).
  const evaluator = {
    evaluate: (req: EvaluationRequest) =>
      createTypeSafeEvaluator({ apiKey: apiKey ?? '' }).evaluate(req)
  }

  test('evaluates one question of each type, with full distributions', async () => {
    const result = await evaluator.evaluate(request)

    const { category, severity, refund_requested } = result.answers
    expect(category?.type).toBe('choice')
    if (category?.type === 'choice') {
      expect(['bug', 'billing', 'feature_request']).toContain(category.choice)
      // capabilities.probabilities is 'always' on this provider.
      expect(category.probabilities).not.toBeNull()
    }
    expect(severity?.type).toBe('score')
    if (severity?.type === 'score') {
      expect(severity.score).toBeGreaterThanOrEqual(0)
      expect(severity.score).toBeLessThanOrEqual(2)
      expect(Object.keys(severity.probabilities ?? {}).sort()).toEqual([
        '0',
        '1',
        '2'
      ])
    }
    expect(refund_requested?.type).toBe('boolean')

    expect(result.provider).toBe('typesafe')
    expect(result.model.requested).toBe('jev-latest')
    expect(result.model.resolved).toMatch(/^jev-\d+\.\d+\.\d+$/)
    expect(result.usage.inputTokens).toBeGreaterThan(0)

    console.info('[smoke] typesafe:', {
      resolved: result.model.resolved,
      latencyMs: Math.round(result.latencyMs),
      providerRequestId: result.providerRequestId
    })
  }, 30_000)

  test('a pinned version answers with that exact model', async () => {
    const result = await evaluator.evaluate({
      ...request,
      model: { family: 'jev', version: checkablePin }
    })

    expect(result.model).toEqual({
      requested: `jev-${checkablePin}`,
      resolved: `jev-${checkablePin}`
    })
  }, 30_000)

  test('an unknown model maps to MODEL_NOT_FOUND', async () => {
    const error = await evaluator
      .evaluate({ ...request, model: { family: 'jev', version: '0.0.0' } })
      .catch((err: unknown) => err)

    // For the record: the adapter expects a 400 naming the model, but the API
    // reference only documents 401/422/429/529 — this checks the real answer.
    const { code, message } = error as { code?: string; message?: string }
    console.info('[smoke] unknown model:', { code, message })
    expect(code).toBe('MODEL_NOT_FOUND')
  }, 30_000)
})
