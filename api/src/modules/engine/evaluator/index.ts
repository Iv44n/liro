import { type Env, env } from '#shared/config/env'
import { FakeEvaluator } from './adapters/fake'
import { createTypeSafeEvaluator } from './adapters/typesafe'
import { createVercelGatewayEvaluator } from './adapters/vercel-gateway'
import {
  withDeadline,
  withFallback,
  withGate,
  withRetry,
  withTelemetry
} from './decorators'
import type { Evaluator, ProviderId } from './port'

export { FakeEvaluator } from './adapters/fake'
export * from './port'

/** Whole-run budget for synchronous evaluations, retries included. */
export const EVALUATION_DEADLINE_MS = 20_000

type EvaluatorEnv = Pick<
  Env,
  | 'EVALUATOR_PROVIDER'
  | 'EVALUATOR_FALLBACK_PROVIDER'
  | 'AI_GATEWAY_API_KEY'
  | 'TYPESAFE_API_KEY'
  | 'JEV_MODEL_VERSION'
>

/**
 * Builds a provider adapter, undecorated: the one selected by
 * `EVALUATOR_PROVIDER` unless another `provider` is named.
 */
export function createAdapter(
  config: EvaluatorEnv,
  provider: ProviderId = config.EVALUATOR_PROVIDER
): Evaluator {
  switch (provider) {
    case 'vercel-gateway':
      if (!config.AI_GATEWAY_API_KEY) {
        throw new Error('AI_GATEWAY_API_KEY is required for vercel-gateway')
      }
      return createVercelGatewayEvaluator({ apiKey: config.AI_GATEWAY_API_KEY })
    case 'typesafe':
      if (!config.TYPESAFE_API_KEY) {
        throw new Error('TYPESAFE_API_KEY is required for typesafe')
      }
      return createTypeSafeEvaluator({
        apiKey: config.TYPESAFE_API_KEY,
        ...(config.JEV_MODEL_VERSION
          ? { modelVersion: config.JEV_MODEL_VERSION }
          : {})
      })
    case 'fake':
      return new FakeEvaluator()
  }
}

/** The `EVALUATOR_FALLBACK_PROVIDER` adapter, when one is configured. */
export function createFallbackAdapter(
  config: EvaluatorEnv
): Evaluator | undefined {
  return config.EVALUATOR_FALLBACK_PROVIDER
    ? createAdapter(config, config.EVALUATOR_FALLBACK_PROVIDER)
    : undefined
}

/**
 * Wraps an adapter with the behavior every provider shares. Order matters:
 * the deadline bounds all retries; the gate is consulted per attempt; the
 * fallback sits innermost, so a fallback call counts as the same attempt
 * (one quota token, one retry slot) as the primary call it replaces.
 */
export function decorateEvaluator(
  adapter: Evaluator,
  fallback?: Evaluator
): Evaluator {
  const provider = fallback ? withFallback(adapter, fallback) : adapter

  return withTelemetry(
    withDeadline(
      withRetry(
        withGate(provider, {
          platform: { requestsPerMinute: 1_000 },
          organization: { requestsPerMinute: 300, maxConcurrent: 20 },
          liveReserve: 0.2
        }),
        { maxRetries: { live: 1, playground: 1, evaluation: 4 } }
      ),
      { timeoutMs: EVALUATION_DEADLINE_MS }
    )
  )
}

let adapter: Evaluator | undefined
let evaluator: Evaluator | undefined

/** The process-wide evaluator (adapter + decorators). */
export function getEvaluator(): Evaluator {
  adapter ??= createAdapter(env)
  evaluator ??= decorateEvaluator(adapter, createFallbackAdapter(env))
  return evaluator
}

/**
 * The underlying `FakeEvaluator` when `EVALUATOR_PROVIDER=fake`, so tests can
 * script answers/failures and inspect the requests the engine sent.
 */
export function getFakeEvaluator(): FakeEvaluator {
  getEvaluator()
  if (!(adapter instanceof FakeEvaluator)) {
    throw new Error('getFakeEvaluator() requires EVALUATOR_PROVIDER=fake')
  }
  return adapter
}
