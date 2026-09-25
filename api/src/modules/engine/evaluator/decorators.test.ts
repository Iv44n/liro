import { beforeEach, describe, expect, test } from 'bun:test'
import { FakeEvaluator } from './adapters/fake'
import {
  withDeadline,
  withFallback,
  withGate,
  withRetry,
  withTelemetry
} from './decorators'
import {
  type EvaluationRequest,
  type Evaluator,
  EvaluatorError,
  type EvaluatorErrorCode
} from './port'

const request = (
  overrides: Partial<EvaluationRequest> = {}
): EvaluationRequest => ({
  state: { ticket: 'My invoice is wrong' },
  questions: {
    refund: {
      type: 'boolean',
      instructions: 'Does the customer ask for a refund?'
    }
  },
  model: { family: 'jev' },
  organizationId: 'org_a',
  priority: 'live',
  ...overrides
})

async function rejection(promise: Promise<unknown>): Promise<EvaluatorError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof EvaluatorError) return error
    throw error
  }
  throw new Error('Expected the evaluation to fail')
}

let fake: FakeEvaluator
let clock: number
const now = () => clock

beforeEach(() => {
  fake = new FakeEvaluator()
  clock = 1_000_000
})

describe('withGate', () => {
  test('caps requests per organization and refills over time', async () => {
    const gated = withGate(fake, {
      platform: { requestsPerMinute: 100 },
      organization: { requestsPerMinute: 2, maxConcurrent: 10 },
      now
    })

    await gated.evaluate(request())
    await gated.evaluate(request())
    const error = await rejection(gated.evaluate(request()))

    expect(error.code).toBe('RATE_LIMITED')
    expect(error.scope).toBe('organization')
    expect(error.retryAfterMs).toBe(30_000)

    // Another organization has its own bucket.
    await gated.evaluate(request({ organizationId: 'org_b' }))

    clock += 30_000
    await gated.evaluate(request())
    expect(fake.calls).toHaveLength(4)
  })

  test('reserves part of the platform capacity for live traffic', async () => {
    const gated = withGate(fake, {
      platform: { requestsPerMinute: 10 },
      organization: { requestsPerMinute: 100, maxConcurrent: 100 },
      liveReserve: 0.2,
      now
    })

    for (let i = 0; i < 8; i++) {
      await gated.evaluate(
        request({ priority: 'playground', organizationId: `org_${i}` })
      )
    }
    const error = await rejection(
      gated.evaluate(request({ priority: 'evaluation' }))
    )
    expect(error.scope).toBe('platform')

    // The last 20% is still available to live requests.
    await gated.evaluate(request({ priority: 'live' }))
    await gated.evaluate(request({ priority: 'live' }))
    expect(
      (await rejection(gated.evaluate(request({ priority: 'live' })))).scope
    ).toBe('platform')
  })

  test('a clock moving backwards does not drain the buckets', async () => {
    const gated = withGate(fake, {
      platform: { requestsPerMinute: 2 },
      organization: { requestsPerMinute: 2, maxConcurrent: 10 },
      now
    })

    clock += 3_600_000
    await gated.evaluate(request())
    clock -= 3_600_000 // e.g. an NTP correction
    await gated.evaluate(request())
    clock += 30_000
    await gated.evaluate(request())
    expect(fake.calls).toHaveLength(3)
  })

  test('caps concurrent evaluations per organization', async () => {
    const gated = withGate(fake, {
      platform: { requestsPerMinute: 100 },
      organization: { requestsPerMinute: 100, maxConcurrent: 1 },
      now
    })
    fake.enqueue({}, { delayMs: 20 })

    const first = gated.evaluate(request())
    const error = await rejection(gated.evaluate(request()))
    await first

    expect(error.scope).toBe('organization')
    await gated.evaluate(request()) // slot released
  })
})

describe('withDeadline', () => {
  test('aborts the in-flight attempt and reports TIMEOUT', async () => {
    const bounded = withDeadline(fake, { timeoutMs: 20 })
    fake.enqueue({}, { delayMs: 500 })

    const error = await rejection(bounded.evaluate(request()))

    expect(error.code).toBe('TIMEOUT')
    expect(fake.calls[0]?.signal?.aborted).toBe(true)
  })

  test('passes the deadline down so inner decorators can respect it', async () => {
    const bounded = withDeadline(fake, { timeoutMs: 5_000, now })

    await bounded.evaluate(request())

    expect(fake.calls[0]?.deadline).toBe(clock + 5_000)
  })
})

describe('withRetry', () => {
  const sleeps: number[] = []
  const retryOptions = {
    maxRetries: { live: 1, playground: 1, evaluation: 4 },
    now,
    random: () => 0,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    }
  }

  beforeEach(() => {
    sleeps.length = 0
  })

  test('retries retryable provider errors with exponential backoff', async () => {
    const retried = withRetry(fake, retryOptions)
    fake.fail('OVERLOADED').fail('UNAVAILABLE').fail('RATE_LIMITED')

    const result = await retried.evaluate(request({ priority: 'evaluation' }))

    expect(result.provider).toBe('fake')
    expect(fake.calls).toHaveLength(4)
    expect(sleeps).toEqual([500, 1_000, 2_000])
  })

  test('synchronous priorities get fewer retries', async () => {
    const retried = withRetry(fake, retryOptions)
    fake.fail('OVERLOADED').fail('OVERLOADED')

    const error = await rejection(
      retried.evaluate(request({ priority: 'live' }))
    )

    expect(error.code).toBe('OVERLOADED')
    expect(fake.calls).toHaveLength(2)
  })

  test("honors the provider's Retry-After", async () => {
    const retried = withRetry(fake, retryOptions)
    fake.fail('RATE_LIMITED', { retryAfterMs: 1_234 })

    await retried.evaluate(request())

    expect(sleeps).toEqual([1_234])
  })

  test('never sleeps past the deadline — rethrows so the caller can send Retry-After', async () => {
    const retried = withRetry(fake, retryOptions)
    fake.fail('RATE_LIMITED', { retryAfterMs: 10_000 })

    const error = await rejection(
      retried.evaluate(request({ deadline: clock + 5_000 }))
    )

    expect(error.retryAfterMs).toBe(10_000)
    expect(sleeps).toEqual([])
    expect(fake.calls).toHaveLength(1)
  })

  test('does not retry non-retryable errors or quota rejections', async () => {
    const retried = withRetry(fake, retryOptions)

    fake.fail('INVALID_REQUEST')
    expect((await rejection(retried.evaluate(request()))).code).toBe(
      'INVALID_REQUEST'
    )

    const gated = withRetry(
      withGate(fake, {
        platform: { requestsPerMinute: 100 },
        organization: { requestsPerMinute: 1, maxConcurrent: 10 },
        now
      }),
      retryOptions
    )
    await gated.evaluate(request({ organizationId: 'org_quota' }))
    const quota = await rejection(
      gated.evaluate(request({ organizationId: 'org_quota' }))
    )

    expect(quota.scope).toBe('organization')
    expect(sleeps).toEqual([])
  })
})

describe('withRetry (default sleep)', () => {
  test('waits between attempts and stops when the caller aborts', async () => {
    const retried = withRetry(fake, {
      maxRetries: { live: 3, playground: 3, evaluation: 3 },
      baseDelayMs: 5
    })
    fake.fail('OVERLOADED')
    await retried.evaluate(request())
    expect(fake.calls).toHaveLength(2)

    const controller = new AbortController()
    fake.fail('OVERLOADED', { retryAfterMs: 1_000 })
    const pending = retried.evaluate(request({ signal: controller.signal }))
    setTimeout(() => controller.abort(new Error('caller gave up')), 5)

    await expect(pending).rejects.toThrow('caller gave up')
  })
})

describe('withFallback', () => {
  let secondaryFake: FakeEvaluator
  /** A second provider with the gateway's narrower capabilities. */
  let secondary: Evaluator

  beforeEach(() => {
    secondaryFake = new FakeEvaluator()
    secondary = {
      provider: 'vercel-gateway',
      capabilities: {
        probabilities: 'optional',
        versionedModels: false,
        maxContextTokens: 32_000,
        questionTypes: ['choice', 'score', 'boolean']
      },
      evaluate: async req => ({
        ...(await secondaryFake.evaluate(req)),
        provider: 'vercel-gateway'
      })
    }
  })

  test.each(['UNAVAILABLE', 'OVERLOADED', 'RATE_LIMITED'] as const)(
    'a primary %s is answered by the secondary',
    async code => {
      fake.fail(code)

      const result = await withFallback(fake, secondary).evaluate(request())

      expect(result.provider).toBe('vercel-gateway')
      expect(fake.calls).toHaveLength(1)
      expect(secondaryFake.calls).toHaveLength(1)
    }
  )

  test('the primary answers when it can; the secondary is not called', async () => {
    const result = await withFallback(fake, secondary).evaluate(request())

    expect(result.provider).toBe('fake')
    expect(secondaryFake.calls).toHaveLength(0)
  })

  test.each<EvaluatorErrorCode>([
    'INVALID_REQUEST',
    'INPUT_TOO_LARGE',
    'AUTH',
    'MODEL_NOT_FOUND',
    'BAD_RESPONSE',
    'TIMEOUT'
  ])('a primary %s is rethrown without trying the secondary', async code => {
    fake.fail(code)

    const error = await rejection(
      withFallback(fake, secondary).evaluate(request())
    )

    expect(error.code).toBe(code)
    expect(secondaryFake.calls).toHaveLength(0)
  })

  test("never spills Liro's own quota rejections or unknown errors over", async () => {
    const quota = withGate(fake, {
      platform: { requestsPerMinute: 100 },
      organization: { requestsPerMinute: 1, maxConcurrent: 10 },
      now
    })
    const fallback = withFallback(quota, secondary)
    await fallback.evaluate(request())

    const error = await rejection(fallback.evaluate(request()))
    expect(error.scope).toBe('organization')

    const broken: Evaluator = {
      provider: 'fake',
      capabilities: fake.capabilities,
      evaluate: async () => {
        throw new Error('bug')
      }
    }
    await expect(
      withFallback(broken, secondary).evaluate(request())
    ).rejects.toThrow('bug')
    expect(secondaryFake.calls).toHaveLength(0)
  })

  test("if the secondary fails too, the primary's error is rethrown (tried once)", async () => {
    fake.fail('OVERLOADED', { retryAfterMs: 1_500 })
    secondaryFake.fail('INPUT_TOO_LARGE')

    const error = await rejection(
      withFallback(fake, secondary).evaluate(request())
    )

    expect(error).toMatchObject({ code: 'OVERLOADED', retryAfterMs: 1_500 })
    expect(secondaryFake.calls).toHaveLength(1)
  })

  test('does not start the secondary once the caller aborted or the deadline passed', async () => {
    const controller = new AbortController()
    // The caller gives up while the primary is failing.
    const abandoned: Evaluator = {
      provider: 'fake',
      capabilities: fake.capabilities,
      evaluate: async () => {
        controller.abort()
        throw new EvaluatorError('UNAVAILABLE', 'down')
      }
    }
    const aborted = await rejection(
      withFallback(abandoned, secondary).evaluate(
        request({ signal: controller.signal })
      )
    )
    expect(aborted.code).toBe('UNAVAILABLE')

    fake.fail('UNAVAILABLE')
    const late = await rejection(
      withFallback(fake, secondary, { now }).evaluate(
        request({ deadline: clock })
      )
    )
    expect(late.code).toBe('UNAVAILABLE')
    expect(secondaryFake.calls).toHaveLength(0)
  })

  test('a request pinned to a model version never falls back to an unversioned provider', async () => {
    const pinned = request({ model: { family: 'jev', version: '1.13.0' } })
    fake.fail('UNAVAILABLE')

    const error = await rejection(
      withFallback(fake, secondary).evaluate(pinned)
    )
    expect(error.code).toBe('UNAVAILABLE')
    expect(secondaryFake.calls).toHaveLength(0)

    // A secondary that can pin the version still takes it.
    const versioned = new FakeEvaluator()
    fake.fail('UNAVAILABLE')
    const result = await withFallback(fake, versioned).evaluate(pinned)
    expect(result.provider).toBe('fake')
    expect(versioned.calls).toHaveLength(1)
  })

  test("keeps the primary's identity with capabilities both providers can honor", () => {
    const combined = withFallback(fake, secondary)

    expect(combined.provider).toBe('fake')
    expect(combined.capabilities).toEqual({
      probabilities: 'optional',
      versionedModels: true,
      maxContextTokens: 32_000,
      questionTypes: ['choice', 'score', 'boolean']
    })
    expect(withFallback(fake, new FakeEvaluator()).capabilities).toEqual(
      fake.capabilities
    )
  })
})

describe('withTelemetry', () => {
  test('is transparent for results and errors', async () => {
    const observed = withTelemetry(fake)
    expect(observed.provider).toBe('fake')
    expect(observed.capabilities).toBe(fake.capabilities)

    const result = await observed.evaluate(request())
    expect(result.provider).toBe('fake')

    fake.fail('AUTH')
    expect((await rejection(observed.evaluate(request()))).code).toBe('AUTH')
  })
})
