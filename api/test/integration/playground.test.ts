import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import { reviewTasks } from '#modules/reviews/reviews.schemas'
import { usageDaily } from '#modules/runs/runs.schemas'
import {
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import { hashJson } from '#shared/core/hash'
import { db } from '#shared/db/config'
import { classifySupport } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import { addMember, createOrg, type TestOrg } from '../helpers/factories'
import {
  type InsertTemplateOptions,
  insertTemplate
} from '../helpers/templates'

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())

const lowConfidenceBug: Record<string, CanonicalAnswer> = {
  category: {
    type: 'choice',
    choice: 'bug',
    probabilities: { bug: 0.5, billing: 0.3, other: 0.2 }
  }
}

const input = {
  ticket: { message: 'The export button crashes the app' },
  customer: { email: 'jane@example.com' }
}

interface Setup {
  org: TestOrg
  templateId: string
  slug: string
  draftId: string | null
  draftHash: string | null
}

async function setup(
  options: Omit<InsertTemplateOptions, 'definition'> & {
    definition?: TemplateDefinitionInput
  } = {}
): Promise<Setup> {
  const org = await createOrg()
  const { template, draft } = await insertTemplate(org, {
    definition: classifySupport,
    draft: true,
    ...options
  })
  return {
    org,
    templateId: template.id,
    slug: template.slug,
    draftId: draft?.id ?? null,
    draftHash: draft?.definitionHash ?? null
  }
}

const testDraft = (
  templateId: string,
  body: unknown,
  cookie: string
): Promise<Response> =>
  api.post(`/api/templates/${templateId}/draft/test`, { body, cookie })

describe('POST /api/templates/:id/draft/test', () => {
  test('runs the saved draft in test mode, at playground priority', async () => {
    const { org, templateId, slug, draftId, draftHash } = await setup()
    fake.enqueue({
      category: {
        type: 'choice',
        choice: 'billing',
        probabilities: { bug: 0.02, billing: 0.97, other: 0.01 }
      }
    })

    const response = await testDraft(templateId, { input }, org.owner.cookie)

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(Object.keys(body).sort()).toEqual(['lint', 'run', 'trace'])
    expect(body.run).toMatchObject({
      template: slug,
      version: null,
      versionId: draftId,
      definitionHash: draftHash,
      mode: 'test',
      source: 'playground',
      status: 'succeeded',
      decision: 'billing',
      finalDecision: 'billing',
      confidence: 0.955,
      provider: 'fake',
      apiKeyId: null,
      userId: org.owner.id,
      templateId,
      review: null
    })
    expect(body.lint).toEqual([])
    expect(body.trace).toEqual({
      state: { ticket: { message: input.ticket.message } },
      questions: ['category'],
      tokens: { estimate: expect.any(Number), limit: 64_000, status: 'ok' }
    })

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toMatchObject({
      priority: 'playground',
      organizationId: org.id,
      state: { ticket: { message: input.ticket.message } }
    })
  })

  test('stores a snapshot of the definition it ran', async () => {
    const { org, templateId } = await setup()

    const response = await testDraft(templateId, { input }, org.owner.cookie)

    const { run } = await json(response)
    const stored = await db.query.decisionRuns.findFirst({
      where: { id: run.id }
    })
    expect(stored?.definition).toEqual(
      templateDefinitionSchema.parse(classifySupport)
    )
    // pii is never stored, in the playground either.
    expect(JSON.stringify(stored)).not.toContain('jane@example.com')
  })

  test('runs the unsaved definition from the body instead of the draft', async () => {
    const { org, templateId, draftId, draftHash } = await setup()
    const unsaved = templateDefinitionSchema.parse({
      ...classifySupport,
      decisions: [
        { label: 'bug', minConfidence: 0.1 },
        { label: 'billing', minConfidence: 0.1 },
        { label: 'other', minConfidence: 0.1 }
      ]
    })
    fake.enqueue(lowConfidenceBug).enqueue(lowConfidenceBug)

    const saved = await json(
      await testDraft(templateId, { input }, org.owner.cookie)
    )
    const edited = await json(
      await testDraft(
        templateId,
        { input, definition: unsaved },
        org.owner.cookie
      )
    )

    expect(saved.run.decision).toBe('needs_review')
    expect(edited.run).toMatchObject({
      decision: 'bug',
      confidence: 0.25,
      versionId: draftId
    })
    expect(edited.run.definitionHash).toBe(hashJson(unsaved))
    expect(edited.run.definitionHash).not.toBe(draftHash)
    const stored = await db.query.decisionRuns.findFirst({
      where: { id: edited.run.id }
    })
    expect(stored?.definition).toEqual(unsaved)
  })

  test('needs_review creates no review task', async () => {
    const { org, templateId } = await setup()
    fake.enqueue(lowConfidenceBug)

    const response = await testDraft(templateId, { input }, org.owner.cookie)

    const { run } = await json(response)
    expect(run).toMatchObject({
      decision: 'needs_review',
      finalDecision: null,
      suggestion: 'bug',
      reviewReason: 'low_confidence',
      review: null
    })
    const tasks = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.organizationId, org.id))
    expect(tasks).toHaveLength(0)
  })

  test('a precondition decides without evaluating (empty trace)', async () => {
    const { org, templateId } = await setup()

    const response = await testDraft(
      templateId,
      { input: { ticket: { message: 'hi' } } },
      org.owner.cookie
    )

    const body = await json(response)
    expect(body.run).toMatchObject({ decision: 'other', rule: 'empty_message' })
    expect(body.trace).toEqual({ state: null, questions: [], tokens: null })
    expect(fake.calls).toHaveLength(0)
  })

  test('lint errors block the run with 422 LINT_FAILED', async () => {
    const { org, templateId } = await setup()
    const broken = {
      ...classifySupport,
      rules: [{ id: 'nope', when: { all: [] }, decision: 'refund' }]
    }

    const response = await testDraft(
      templateId,
      { input, definition: broken },
      org.owner.cookie
    )

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('LINT_FAILED')
    expect(error.details.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'UNKNOWN_LABEL',
        path: expect.stringMatching(/^rules\.0/)
      })
    )
    expect(fake.calls).toHaveLength(0)
  })

  test('lint warnings are returned but do not block', async () => {
    const { org, templateId } = await setup()
    const withUnusedQuestion = {
      ...classifySupport,
      questions: {
        ...classifySupport.questions,
        unused: { type: 'boolean', instructions: 'Is it Monday?' }
      }
    }

    const response = await testDraft(
      templateId,
      { input, definition: withUnusedQuestion },
      org.owner.cookie
    )

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.lint).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'UNUSED_QUESTION' })
    )
    expect(body.trace.questions).toEqual(['category', 'unused'])
  })

  test('an invalid definition is 422 VALIDATION_FAILED with definition. paths', async () => {
    const { org, templateId } = await setup()

    const response = await testDraft(
      templateId,
      { input, definition: { ...classifySupport, kind: 'magic' } },
      org.owner.cookie
    )

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details.issues[0].path).toBe('definition.kind')
  })

  test('an input breaking the contract is 422 with input. paths', async () => {
    const { org, templateId } = await setup()

    const response = await testDraft(
      templateId,
      { input: { ticket: { message: 42 } } },
      org.owner.cookie
    )

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details.issues[0].path).toBe('input.ticket.message')
  })

  test.each([
    [
      'a NUL in the input',
      { input: { ticket: { message: 'crash \u0000 here' } } },
      'input.ticket.message'
    ],
    [
      'a NUL in the unsaved definition',
      {
        input,
        definition: {
          ...classifySupport,
          decisions: [
            { label: 'bug', description: 'bad \u0000 desc' },
            { label: 'billing' },
            { label: 'other' }
          ]
        }
      },
      'definition.decisions.0.description'
    ]
  ])('%s is 422 before the evaluator is called', async (_, body, path) => {
    const { org, templateId } = await setup()

    const response = await testDraft(templateId, body, org.owner.cookie)

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details.issues[0]).toMatchObject({
      path,
      message: 'Must not contain NUL characters'
    })
    expect(fake.calls).toHaveLength(0)
    const runs = await db.query.decisionRuns.findMany({
      where: { organizationId: org.id }
    })
    expect(runs).toHaveLength(0)
  })

  test('a deeply nested definition is 422, not a stack overflow', async () => {
    const { org, templateId } = await setup()
    const deep = `${'['.repeat(50_000)}${']'.repeat(50_000)}`
    const definition = JSON.stringify(classifySupport).replace(
      /}$/,
      `,"extra":${deep}}`
    )

    const response = await testDraft(
      templateId,
      `{"input":${JSON.stringify(input)},"definition":${definition}}`,
      org.owner.cookie
    )

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details.issues[0].path).toStartWith('definition.extra')
    expect(fake.calls).toHaveLength(0)
  })

  test('a template without a draft gets one from its latest version', async () => {
    const { org, templateId } = await setup({ draft: false })

    const response = await testDraft(
      templateId,
      { input: { ticket: { message: 'hi' } } },
      org.owner.cookie
    )

    expect(response.status).toBe(200)
    const { run } = await json(response)
    const draft = await db.query.decisionTemplateVersions.findFirst({
      where: { templateId, status: 'draft' }
    })
    expect(draft).toBeDefined()
    expect(run.versionId).toBe(draft?.id)
  })

  test('evaluator failures map like /v1 (and store a failed playground run)', async () => {
    const { org, templateId } = await setup()
    fake.fail('RATE_LIMITED', { scope: 'organization', retryAfterMs: 4_000 })

    const quota = await testDraft(templateId, { input }, org.owner.cookie)
    expect(quota.status).toBe(429)
    expect(quota.headers.get('Retry-After')).toBe('4')

    fake.fail('AUTH')
    const failed = await testDraft(templateId, { input }, org.owner.cookie)
    expect(failed.status).toBe(500)
    const { error } = await json(failed)
    const stored = await db.query.decisionRuns.findFirst({
      where: { id: error.details.runId }
    })
    expect(stored).toMatchObject({
      status: 'failed',
      source: 'playground',
      mode: 'test',
      errorCode: 'AUTH'
    })
  })

  test('playground usage is counted apart from api usage', async () => {
    const { org, templateId } = await setup()

    await testDraft(templateId, { input }, org.owner.cookie)

    const rows = await db
      .select()
      .from(usageDaily)
      .where(
        and(
          eq(usageDaily.organizationId, org.id),
          eq(usageDaily.templateId, templateId)
        )
      )
    expect(rows).toEqual([
      expect.objectContaining({
        source: 'playground',
        mode: 'test',
        provider: 'fake',
        runs: 1,
        evaluations: 1
      })
    ])
  })

  test('members can test drafts', async () => {
    const { org, templateId } = await setup()
    const member = await addMember(org, 'member')

    const response = await testDraft(
      templateId,
      { input: { ticket: { message: 'hi' } } },
      member.cookie
    )

    expect(response.status).toBe(200)
    expect((await json(response)).run.userId).toBe(member.id)
  })

  test("another organization's template is 404", async () => {
    const { templateId } = await setup()
    const other = await createOrg()

    const response = await testDraft(templateId, { input }, other.owner.cookie)

    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('NOT_FOUND')
    expect(fake.calls).toHaveLength(0)
  })

  test('requires a session', async () => {
    const { templateId } = await setup()

    const response = await api.post(`/api/templates/${templateId}/draft/test`, {
      body: { input }
    })

    expect(response.status).toBe(401)
  })
})
