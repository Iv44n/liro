import { describe, expect, test } from 'bun:test'
import type { EvaluationRequest } from '../port'
import { FakeEvaluator, generateAnswer } from './fake'

const request: EvaluationRequest = {
  state: { ticket: 'The export button crashes the app' },
  questions: {
    category: {
      type: 'choice',
      instructions: 'Category?',
      criteria: { bug: null, billing: null, other: null }
    },
    severity: {
      type: 'score',
      instructions: 'Severity?',
      criteria: ['low', 'medium', 'high']
    },
    urgent: { type: 'boolean', instructions: 'Urgent?' }
  },
  model: { family: 'jev', version: '1.13.0' },
  organizationId: 'org_fake',
  priority: 'playground'
}

const sum = (values: Record<string, number>) =>
  Object.values(values).reduce((total, value) => total + value, 0)

describe('FakeEvaluator (development mode)', () => {
  test('generates valid, deterministic answers for every question', async () => {
    const fake = new FakeEvaluator()

    const first = await fake.evaluate(request)
    const second = await fake.evaluate(request)

    expect(second.answers).toEqual(first.answers)

    const { category, severity, urgent } = first.answers
    if (category?.type !== 'choice' || !category.probabilities)
      throw new Error('choice')
    expect(['bug', 'billing', 'other']).toContain(category.choice)
    expect(sum(category.probabilities)).toBeCloseTo(1)
    expect(category.probabilities[category.choice]).toBe(
      Math.max(...Object.values(category.probabilities))
    )

    if (severity?.type !== 'score' || !severity.probabilities)
      throw new Error('score')
    expect(sum(severity.probabilities)).toBeCloseTo(1)
    const expected = Object.entries(severity.probabilities).reduce(
      (total, [level, p]) => total + Number(level) * p,
      0
    )
    expect(severity.score).toBeCloseTo(expected)

    if (urgent?.type !== 'boolean') throw new Error('boolean')
    expect(urgent.probability).toBeGreaterThanOrEqual(0)
    expect(urgent.probability).toBeLessThanOrEqual(1)

    expect(first.model).toEqual({
      requested: 'jev-1.13.0',
      resolved: 'jev-fake'
    })
  })

  test('different inputs yield different answers', () => {
    const question = request.questions.urgent
    if (!question) throw new Error('missing question')

    const a = generateAnswer(question, 'urgent:{"ticket":"a"}')
    const b = generateAnswer(question, 'urgent:{"ticket":"b"}')

    expect(a).not.toEqual(b)
  })

  test('scripted answers override generated ones, then it falls back to generation', async () => {
    const fake = new FakeEvaluator().enqueue({
      urgent: { type: 'boolean', probability: 1 }
    })

    const scripted = await fake.evaluate(request)
    expect(scripted.answers.urgent).toEqual({ type: 'boolean', probability: 1 })
    expect(scripted.answers.category?.type).toBe('choice')

    const generated = await fake.evaluate(request)
    expect(generated.answers.urgent).not.toEqual({
      type: 'boolean',
      probability: 1
    })
  })

  test('reset clears calls and scripted responses', async () => {
    const fake = new FakeEvaluator().fail('OVERLOADED')
    fake.reset()

    await expect(fake.evaluate(request)).resolves.toBeDefined()
    expect(fake.calls).toHaveLength(1)
  })

  test('rate limits come from the provider unless a scope is given', async () => {
    const fake = new FakeEvaluator()
      .fail('RATE_LIMITED', { retryAfterMs: 1_500 })
      .fail('RATE_LIMITED', { scope: 'organization', retryAfterMs: 2_000 })
      .fail('OVERLOADED')

    await expect(fake.evaluate(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      scope: 'provider',
      retryAfterMs: 1_500,
      provider: 'fake'
    })
    await expect(fake.evaluate(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      scope: 'organization',
      retryAfterMs: 2_000
    })
    await expect(fake.evaluate(request)).rejects.toMatchObject({
      code: 'OVERLOADED',
      scope: undefined
    })
  })

  test('honors abort signals while delayed', async () => {
    const fake = new FakeEvaluator().enqueue({}, { delayMs: 1_000 })
    const controller = new AbortController()

    const pending = fake.evaluate({ ...request, signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
