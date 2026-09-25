import {
  type CanonicalAnswer,
  type CanonicalQuestion,
  type EvaluationRequest,
  type EvaluationResult,
  type Evaluator,
  type EvaluatorCapabilities,
  EvaluatorError,
  type EvaluatorErrorCode,
  type RateLimitScope
} from '../port'

type Scripted =
  | {
      kind: 'answers'
      answers: Record<string, CanonicalAnswer>
      delayMs?: number
    }
  | { kind: 'error'; error: EvaluatorError; delayMs?: number }

/**
 * Deterministic in-process evaluator. Used by tests (scripted answers and
 * failures, plus a record of every request it received) and for local
 * development without a provider key (`EVALUATOR_PROVIDER=fake`), where it
 * answers with stable pseudo-random distributions derived from the input.
 */
export class FakeEvaluator implements Evaluator {
  readonly provider = 'fake' as const
  capabilities: EvaluatorCapabilities = {
    probabilities: 'always',
    versionedModels: true,
    maxContextTokens: 64_000,
    questionTypes: ['choice', 'score', 'boolean']
  }

  readonly calls: EvaluationRequest[] = []
  private readonly scripted: Scripted[] = []

  /** The next call answers with `answers` (questions not listed get generated answers). */
  enqueue(
    answers: Record<string, CanonicalAnswer>,
    options: { delayMs?: number } = {}
  ): this {
    this.scripted.push({ kind: 'answers', answers, ...options })
    return this
  }

  /**
   * The next call fails with `code`. A `RATE_LIMITED` failure comes from the
   * provider unless `scope` says otherwise — e.g. `organization` to simulate
   * the gate's per-org quota (which callers answer with 429, not 503).
   */
  fail(
    code: EvaluatorErrorCode,
    options: {
      retryAfterMs?: number
      delayMs?: number
      message?: string
      scope?: RateLimitScope
    } = {}
  ): this {
    const { delayMs, message, ...errorOptions } = options
    this.scripted.push({
      kind: 'error',
      error: new EvaluatorError(code, message ?? `Fake evaluator: ${code}`, {
        provider: 'fake',
        ...(code === 'RATE_LIMITED' ? { scope: 'provider' as const } : {}),
        ...errorOptions
      }),
      ...(delayMs === undefined ? {} : { delayMs })
    })
    return this
  }

  reset(): void {
    this.calls.length = 0
    this.scripted.length = 0
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    this.calls.push(request)
    const startedAt = performance.now()
    const next = this.scripted.shift()

    if (next?.delayMs) await sleep(next.delayMs, request.signal)
    if (request.signal?.aborted) {
      throw new EvaluatorError('TIMEOUT', 'Evaluation was aborted', {
        provider: 'fake'
      })
    }
    if (next?.kind === 'error') throw next.error

    const scriptedAnswers = next?.kind === 'answers' ? next.answers : {}
    const answers: Record<string, CanonicalAnswer> = {}
    for (const [key, question] of Object.entries(request.questions)) {
      answers[key] =
        scriptedAnswers[key] ??
        generateAnswer(question, `${key}:${JSON.stringify(request.state)}`)
    }

    const inputTokens = Math.ceil(
      JSON.stringify({ state: request.state, questions: request.questions })
        .length / 4
    )

    return {
      answers,
      usage: { inputTokens, outputTokens: 0 },
      provider: 'fake',
      model: {
        requested: request.model.version
          ? `jev-${request.model.version}`
          : 'jev-fake',
        resolved: 'jev-fake'
      },
      providerRequestId: `fake_${this.calls.length}`,
      latencyMs: performance.now() - startedAt
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/** FNV-1a — a stable seed per (question, state). */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function distribution(labels: string[], seed: number): Record<string, number> {
  const weights = labels.map((_, i) => ((hash(`${seed}:${i}`) % 1000) + 1) ** 2)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return Object.fromEntries(
    labels.map((label, i) => [label, (weights[i] ?? 0) / total])
  )
}

function argmax(probabilities: Record<string, number>): string {
  let best = ''
  let bestP = -1
  for (const [label, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      best = label
      bestP = p
    }
  }
  return best
}

export function generateAnswer(
  question: CanonicalQuestion,
  seedText: string
): CanonicalAnswer {
  const seed = hash(seedText)

  switch (question.type) {
    case 'choice': {
      const probabilities = distribution(Object.keys(question.criteria), seed)
      return { type: 'choice', choice: argmax(probabilities), probabilities }
    }
    case 'score': {
      const levels = question.criteria.map((_, i) => String(i))
      const probabilities = distribution(levels, seed)
      const score = levels.reduce(
        (sum, level) => sum + Number(level) * (probabilities[level] ?? 0),
        0
      )
      return { type: 'score', score, probabilities }
    }
    case 'boolean':
      return { type: 'boolean', probability: (seed % 1000) / 999 }
  }
}
