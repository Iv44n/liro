import { describe, expect, test } from 'bun:test'
import triageRequest from '#/../test/fixtures/evaluator/support-triage.request.json'
import { createVercelGatewayEvaluator } from '#modules/engine/evaluator/adapters/vercel-gateway'
import type { EvaluationRequest } from '#modules/engine/evaluator/port'

/**
 * Real calls to Vercel AI Gateway (costs a fraction of a cent). Run with
 * `bun run test:smoke` and AI_GATEWAY_API_KEY set; skipped otherwise.
 */
const apiKey = process.env.AI_GATEWAY_API_KEY

describe.skipIf(!apiKey)('Vercel AI Gateway (live)', () => {
  test('evaluates one question of each type', async () => {
    const evaluator = createVercelGatewayEvaluator({ apiKey: apiKey ?? '' })
    const request: EvaluationRequest = {
      ...(triageRequest as Pick<EvaluationRequest, 'state' | 'questions'>),
      model: { family: 'jev' },
      organizationId: 'smoke',
      priority: 'live'
    }

    const result = await evaluator.evaluate(request)

    const { category, severity, refund_requested } = result.answers
    expect(category?.type).toBe('choice')
    if (category?.type === 'choice') {
      expect(['bug', 'billing', 'feature_request']).toContain(category.choice)
    }
    expect(severity?.type).toBe('score')
    if (severity?.type === 'score') {
      expect(severity.score).toBeGreaterThanOrEqual(0)
      expect(severity.score).toBeLessThanOrEqual(2)
    }
    expect(refund_requested?.type).toBe('boolean')

    expect(result.provider).toBe('vercel-gateway')
    expect(result.usage.inputTokens).toBeGreaterThan(0)

    // Whether the gateway returns distributions decides how often confidence
    // is null (fail-closed → review); report it for the record.
    console.info('[smoke] probabilities present:', {
      category: category?.type === 'choice' && category.probabilities !== null,
      severity: severity?.type === 'score' && severity.probabilities !== null,
      latencyMs: Math.round(result.latencyMs),
      providerRequestId: result.providerRequestId
    })
  }, 30_000)
})
