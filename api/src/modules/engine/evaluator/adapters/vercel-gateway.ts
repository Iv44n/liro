import { createGateway } from '@ai-sdk/gateway'
import {
  APICallError,
  experimental_evaluate as evaluate,
  InvalidResponseDataError
} from 'ai'
import {
  type CanonicalAnswer,
  type EvaluationRequest,
  type EvaluationResult,
  type Evaluator,
  EvaluatorError,
  type EvaluatorErrorCode
} from '../port'

export const GATEWAY_JEV_MODEL_ID = 'typesafe-ai/jev'

export interface VercelGatewayEvaluatorOptions {
  apiKey: string
  /** Defaults to the gateway's own (`https://ai-gateway.vercel.sh/v4/ai`). */
  baseURL?: string
  /** Injectable for tests (recorded responses). */
  fetch?: typeof globalThis.fetch
  modelId?: string
}

type GatewayAnswers = Awaited<ReturnType<typeof evaluate>>['answers']

/**
 * Jev through Vercel AI Gateway (`experimental_evaluate` from the AI SDK).
 *
 * Differences from TypeSafe's own API that this adapter absorbs: no
 * `confidence`/`legend` in answers, `probabilities` may be missing, and the
 * model id (`typesafe-ai/jev`) is unversioned.
 */
export function createVercelGatewayEvaluator(
  options: VercelGatewayEvaluatorOptions
): Evaluator {
  const gateway = createGateway({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const modelId = options.modelId ?? GATEWAY_JEV_MODEL_ID
  const model = gateway.evaluationModel(modelId)

  return {
    provider: 'vercel-gateway',
    capabilities: {
      probabilities: 'optional',
      versionedModels: false,
      maxContextTokens: 32_000,
      questionTypes: ['choice', 'score', 'boolean']
    },

    async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
      const startedAt = performance.now()

      try {
        const result = await evaluate({
          model,
          state: request.state,
          // The canonical question shapes are the AI SDK's (choice / score /
          // boolean with the same criteria layout), so they pass through as-is.
          questions: request.questions,
          // Retries are handled uniformly by Liro's retry decorator.
          maxRetries: 0,
          ...(request.signal ? { abortSignal: request.signal } : {})
        })

        return {
          answers: toCanonicalAnswers(result.answers),
          usage: {
            inputTokens: result.usage.inputTokens ?? null,
            outputTokens: result.usage.outputTokens ?? null
          },
          provider: 'vercel-gateway',
          model: {
            requested: modelId,
            resolved: result.response.modelId ?? null
          },
          providerRequestId: requestIdOf(
            result.providerMetadata,
            result.response.headers
          ),
          latencyMs: performance.now() - startedAt
        }
      } catch (error) {
        throw toEvaluatorError(error, request.signal)
      }
    }
  }
}

function toCanonicalAnswers(
  answers: GatewayAnswers
): Record<string, CanonicalAnswer> {
  const canonical: Record<string, CanonicalAnswer> = {}

  for (const [key, answer] of Object.entries(answers)) {
    switch (answer.type) {
      case 'choice':
        canonical[key] = {
          type: 'choice',
          choice: answer.choice,
          probabilities: answer.probabilities ?? null
        }
        break
      case 'score':
        canonical[key] = {
          type: 'score',
          score: answer.score,
          probabilities: answer.probabilities ?? null
        }
        break
      case 'boolean':
        canonical[key] = { type: 'boolean', probability: answer.probability }
        break
    }
  }

  return canonical
}

function requestIdOf(
  providerMetadata: unknown,
  headers: Record<string, string> | undefined
): string | null {
  const gatewayMetadata = (
    providerMetadata as { gateway?: { generationId?: unknown } } | undefined
  )?.gateway
  if (typeof gatewayMetadata?.generationId === 'string') {
    return gatewayMetadata.generationId
  }

  return headers?.['x-vercel-id'] ?? headers?.['x-request-id'] ?? null
}

interface GatewayErrorLike {
  name: string
  message: string
  statusCode?: number
  generationId?: string
  cause?: unknown
}

function isGatewayError(error: unknown): error is GatewayErrorLike {
  return (
    error instanceof Error &&
    error.name.startsWith('Gateway') &&
    error.name.endsWith('Error')
  )
}

/** `retry-after-ms` / `retry-after` from the underlying HTTP response, if any. */
function retryAfterOf(error: GatewayErrorLike): number | undefined {
  const cause = error.cause
  if (!APICallError.isInstance(cause)) return undefined

  const headers = cause.responseHeaders ?? {}
  const ms = Number(headers['retry-after-ms'])
  if (Number.isFinite(ms) && ms >= 0) return ms

  const seconds = Number(headers['retry-after'])
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const date = Date.parse(headers['retry-after'] ?? '')
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

const TOO_LARGE =
  /context|too (large|long)|token limit|max(imum)? tokens|exceed/i

function codeOf(error: GatewayErrorLike): EvaluatorErrorCode {
  switch (error.name) {
    case 'GatewayRateLimitError':
      return 'RATE_LIMITED'
    case 'GatewayTimeoutError':
      return 'TIMEOUT'
    case 'GatewayAuthenticationError':
    case 'GatewayForbiddenError':
      return 'AUTH'
    case 'GatewayModelNotFoundError':
      return 'MODEL_NOT_FOUND'
    case 'GatewayInvalidRequestError':
      return TOO_LARGE.test(error.message)
        ? 'INPUT_TOO_LARGE'
        : 'INVALID_REQUEST'
  }

  const status = error.statusCode ?? 500
  if (status === 429) return 'RATE_LIMITED'
  if (status === 529 || status === 503) return 'OVERLOADED'
  if (status === 413) return 'INPUT_TOO_LARGE'
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 404) return 'MODEL_NOT_FOUND'
  if (status >= 400 && status < 500) return 'INVALID_REQUEST'
  return 'UNAVAILABLE'
}

export function toEvaluatorError(
  error: unknown,
  signal?: AbortSignal
): EvaluatorError {
  if (error instanceof EvaluatorError) return error

  if (
    signal?.aborted ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new EvaluatorError('TIMEOUT', 'Evaluation was aborted', {
      provider: 'vercel-gateway',
      cause: error
    })
  }

  if (isGatewayError(error)) {
    const code = codeOf(error)
    return new EvaluatorError(code, error.message, {
      provider: 'vercel-gateway',
      ...(code === 'RATE_LIMITED' ? { scope: 'provider' as const } : {}),
      ...(error.generationId ? { providerRequestId: error.generationId } : {}),
      ...withRetryAfter(retryAfterOf(error)),
      cause: error
    })
  }

  if (InvalidResponseDataError.isInstance(error)) {
    return new EvaluatorError('BAD_RESPONSE', error.message, {
      provider: 'vercel-gateway',
      cause: error
    })
  }

  // AI SDK argument validation (e.g. unsupported question type) happens
  // before any I/O: the request itself is wrong.
  if (
    error instanceof Error &&
    (error.name === 'AI_InvalidArgumentError' ||
      error.name === 'AI_EvaluationUnsupportedQuestionTypeError')
  ) {
    return new EvaluatorError('INVALID_REQUEST', error.message, {
      provider: 'vercel-gateway',
      cause: error
    })
  }

  return new EvaluatorError(
    'UNAVAILABLE',
    error instanceof Error ? error.message : 'Unknown evaluator error',
    { provider: 'vercel-gateway', cause: error }
  )
}

function withRetryAfter(retryAfterMs: number | undefined) {
  return retryAfterMs === undefined ? {} : { retryAfterMs }
}
