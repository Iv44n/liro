/**
 * Provider-neutral contract between Liro's decision engine and whatever serves
 * Jev (Vercel AI Gateway today, TypeSafe's official API later). The engine only
 * ever sees these types; each adapter translates to and from its provider.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** What Jev accepts for state, instructions and criteria descriptions. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[]

export type CanonicalQuestion =
  | {
      type: 'choice'
      instructions: EntryType
      /** Option name → description (`null` when the name speaks for itself). ≤255 options. */
      criteria: Record<string, EntryType | null>
    }
  | {
      type: 'score'
      instructions: EntryType
      /** Ordered levels, lowest first; a level's number is its index. 2..10 levels. */
      criteria: (EntryType | null)[]
    }
  | {
      type: 'boolean'
      instructions: EntryType
      criteria?: { true?: EntryType | null; false?: EntryType | null }
    }

export type CanonicalQuestionType = CanonicalQuestion['type']

export type CanonicalAnswer =
  | {
      type: 'choice'
      choice: string
      /** Full distribution over the options, when the provider returns it. */
      probabilities: Record<string, number> | null
    }
  | {
      type: 'score'
      /** Expected level in [0, levels - 1]. */
      score: number
      /** Distribution keyed by level index ("0".."n-1"), when the provider returns it. */
      probabilities: Record<string, number> | null
    }
  | {
      type: 'boolean'
      /** P(true). Not a confidence in either outcome. */
      probability: number
    }

export type ProviderId = 'vercel-gateway' | 'typesafe' | 'fake'

export type EvaluationPriority = 'live' | 'playground' | 'evaluation'

/** Stored per template version; `version` only applies to versioned providers. */
export interface ModelRef {
  family: 'jev'
  version?: string
}

export interface EvaluationRequest {
  state: EntryType
  questions: Record<string, CanonicalQuestion>
  model: ModelRef
  organizationId: string
  priority: EvaluationPriority
  signal?: AbortSignal
  /** Epoch ms after which no new attempt may start (set by the deadline decorator). */
  deadline?: number
}

export interface EvaluationResult {
  answers: Record<string, CanonicalAnswer>
  usage: { inputTokens: number | null; outputTokens: number | null }
  provider: ProviderId
  model: { requested: string; resolved: string | null }
  providerRequestId: string | null
  latencyMs: number
}

export interface EvaluatorCapabilities {
  /** `optional`: answers may come back without `probabilities` (confidence becomes null). */
  probabilities: 'always' | 'optional'
  /** Whether `ModelRef.version` can pin an exact model. */
  versionedModels: boolean
  maxContextTokens: number
  questionTypes: readonly CanonicalQuestionType[]
}

export interface Evaluator {
  readonly provider: ProviderId
  readonly capabilities: EvaluatorCapabilities
  evaluate(request: EvaluationRequest): Promise<EvaluationResult>
}

export type EvaluatorErrorCode =
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INPUT_TOO_LARGE'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'AUTH'
  | 'BAD_RESPONSE'

/**
 * Where a rate limit came from: the provider itself, Liro's shared platform
 * quota, or the calling organization's own quota. Callers map these to
 * different HTTP responses (503 vs 429).
 */
export type RateLimitScope = 'provider' | 'platform' | 'organization'

const RETRYABLE_CODES: ReadonlySet<EvaluatorErrorCode> = new Set([
  'RATE_LIMITED',
  'OVERLOADED',
  'UNAVAILABLE',
  'TIMEOUT'
])

export class EvaluatorError extends Error {
  readonly code: EvaluatorErrorCode
  readonly retryable: boolean
  readonly retryAfterMs: number | undefined
  readonly scope: RateLimitScope | undefined
  readonly provider: ProviderId | undefined
  readonly providerRequestId: string | undefined

  constructor(
    code: EvaluatorErrorCode,
    message: string,
    options: {
      retryable?: boolean
      retryAfterMs?: number
      scope?: RateLimitScope
      provider?: ProviderId
      providerRequestId?: string
      cause?: unknown
    } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = 'EvaluatorError'
    this.code = code
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code)
    this.retryAfterMs = options.retryAfterMs
    this.scope = options.scope
    this.provider = options.provider
    this.providerRequestId = options.providerRequestId
  }
}
