import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from 'bun:test'
import { and, eq } from 'drizzle-orm'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  IDEMPOTENCY_ABANDONED_MS,
  IDEMPOTENCY_TTL_MS,
  idempotencyRequestHash,
  purgeExpiredIdempotencyKeys,
  releaseIdempotencyKey
} from '#modules/runs/idempotency'
import { decisionRuns, idempotencyKeys } from '#modules/runs/runs.schemas'
import {
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import { inputJsonSchema } from '#modules/templates/input-schema'
import {
  decisionTemplates,
  decisionTemplateVersions,
  type VersionStatus
} from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'
import { hashJson } from '#shared/core/hash'
import { db } from '#shared/db/config'
import { classifySupport } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import { createApiKey, createOrg, type TestOrg } from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())
afterEach(() => setSystemTime())

const HOUR_MS = 60 * 60 * 1000

const confidentBug: Record<string, CanonicalAnswer> = {
  category: {
    type: 'choice',
    choice: 'bug',
    probabilities: { bug: 0.97, billing: 0.02, other: 0.01 }
  }
}

const input = { ticket: { message: 'The export button crashes the app' } }
/**
 * Decided by a precondition, so the evaluator (and its quota gate) is never
 * reached. The gate's token buckets run on `Date.now`: moving the clock with
 * `setSystemTime` and back would leave the process-wide platform bucket
 * drained for every later test.
 */
const shortInput = { ticket: { message: 'hi' } }

interface Setup {
  org: TestOrg
  key: string
  slug: string
  templateId: string
  versionId: string
}

async function setup(): Promise<Setup> {
  const org = await createOrg()
  const { key } = await createApiKey(org, 'live')
  const { template, versions } = await insertTemplate(org, {
    definition: classifySupport
  })
  return {
    org,
    key,
    slug: template.slug,
    templateId: template.id,
    versionId: versions[0]?.id ?? ''
  }
}

/** Publishes another version of the setup's template (as the templates API would). */
async function addVersion(
  { org, templateId }: Setup,
  version: { major: number; minor: number; definition: TemplateDefinitionInput }
) {
  const definition = templateDefinitionSchema.parse(version.definition)
  await db.insert(decisionTemplateVersions).values({
    id: Id.generate(),
    organizationId: org.id,
    templateId,
    major: version.major,
    minor: version.minor,
    status: 'published',
    definition,
    inputJsonSchema: inputJsonSchema(definition.input.fields),
    definitionHash: hashJson(definition),
    modelRef: definition.model,
    createdBy: org.owner.id,
    publishedBy: org.owner.id,
    publishedAt: new Date()
  })
}

const setVersionStatus = (versionId: string, status: VersionStatus) =>
  db
    .update(decisionTemplateVersions)
    .set({ status })
    .where(eq(decisionTemplateVersions.id, versionId))

/** `classifySupport` with a new required input field: 1.0's input fails it. */
const stricter: TemplateDefinitionInput = {
  ...classifySupport,
  input: {
    fields: [
      ...classifySupport.input.fields,
      { path: 'ticket.lang', type: 'string', required: true }
    ]
  }
}

function run(
  { key, slug }: Setup,
  idempotencyKey: string | null,
  body: unknown = { input },
  ref = `${slug}@1`
) {
  return api.post(`/v1/decisions/${ref}/run`, {
    apiKey: key,
    body,
    headers:
      idempotencyKey === null ? {} : { 'Idempotency-Key': idempotencyKey }
  })
}

const keyRow = (organizationId: string, key: string) =>
  db.query.idempotencyKeys.findFirst({ where: { organizationId, key } })

const runCount = async (organizationId: string) =>
  (
    await db
      .select({ id: decisionRuns.id })
      .from(decisionRuns)
      .where(eq(decisionRuns.organizationId, organizationId))
  ).length

describe('Idempotency-Key on POST /v1/decisions/:ref/run', () => {
  test('the same key replays the stored run without evaluating again', async () => {
    const context = await setup()
    fake.enqueue(confidentBug)

    const first = await run(context, 'order-1')
    expect(first.status).toBe(200)
    expect(first.headers.get('Idempotent-Replayed')).toBeNull()
    const original = await json(first)

    const second = await run(context, 'order-1')

    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await json(second)).toEqual(original)
    expect(fake.calls).toHaveLength(1)
    expect(await runCount(context.org.id)).toBe(1)

    expect(await keyRow(context.org.id, 'order-1')).toMatchObject({
      status: 'completed',
      runId: original.id
    })
  })

  test('without a key every request runs', async () => {
    const context = await setup()

    await run(context, null)
    await run(context, null)

    expect(fake.calls).toHaveLength(2)
    expect(await runCount(context.org.id)).toBe(2)
  })

  test('the key with a different body is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const context = await setup()
    await run(context, 'order-2')

    const otherInput = await run(context, 'order-2', {
      input: { ticket: { message: 'Something else entirely' } }
    })
    const otherMetadata = await run(context, 'order-2', {
      input,
      metadata: { attempt: 2 }
    })
    const otherRef = await run(
      context,
      'order-2',
      { input },
      `${context.slug}@1.0`
    )

    for (const response of [otherInput, otherMetadata, otherRef]) {
      expect(response.status).toBe(422)
      expect((await json(response)).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    }
    expect(fake.calls).toHaveLength(1)
  })

  test('a live and a test key of the same organization do not share a run', async () => {
    const context = await setup()
    const testKey = await createApiKey(context.org, 'test')
    await run(context, 'shared')

    const response = await run({ ...context, key: testKey.key }, 'shared')

    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  test('keys are scoped per organization', async () => {
    const first = await setup()
    const second = await setup()

    const a = await json(await run(first, 'same-key'))
    const b = await json(await run(second, 'same-key'))

    expect(a.id).not.toBe(b.id)
    expect(fake.calls).toHaveLength(2)
  })

  test('concurrent requests with one key: one runs, the other gets 409', async () => {
    const context = await setup()
    fake.enqueue(confidentBug, { delayMs: 300 })

    const responses = await Promise.all([
      run(context, 'concurrent'),
      run(context, 'concurrent')
    ])

    const statuses = responses.map(response => response.status).sort()
    expect(statuses).toEqual([200, 409])
    const conflict = responses.find(response => response.status === 409)
    expect((await json(conflict as Response)).error.code).toBe(
      'IDEMPOTENCY_IN_PROGRESS'
    )
    expect(fake.calls).toHaveLength(1)

    // Once the first finished, the key replays its run.
    const later = await run(context, 'concurrent')
    expect(later.headers.get('Idempotent-Replayed')).toBe('true')
  })

  test('a failed run releases the key, so a retry runs', async () => {
    const context = await setup()
    fake.fail('TIMEOUT').fail('TIMEOUT')

    const failed = await run(context, 'retry-me')
    expect(failed.status).toBe(504)
    expect(await keyRow(context.org.id, 'retry-me')).toBeUndefined()

    fake.enqueue(confidentBug)
    const retried = await run(context, 'retry-me')

    expect(retried.status).toBe(200)
    expect(retried.headers.get('Idempotent-Replayed')).toBeNull()
    const body = await json(retried)
    expect(body.decision).toBe('bug')
    expect(await keyRow(context.org.id, 'retry-me')).toMatchObject({
      status: 'completed',
      runId: body.id
    })
  })

  test('a quota rejection releases the key too', async () => {
    const context = await setup()
    fake.fail('RATE_LIMITED', { scope: 'organization', retryAfterMs: 1_000 })

    expect((await run(context, 'quota')).status).toBe(429)
    expect((await run(context, 'quota')).status).toBe(200)
  })

  test('an invalid input does not claim the key', async () => {
    const context = await setup()

    const invalid = await run(context, 'fix-and-retry', {
      input: { ticket: {} }
    })
    expect(invalid.status).toBe(422)
    expect(await keyRow(context.org.id, 'fix-and-retry')).toBeUndefined()

    const valid = await run(context, 'fix-and-retry')
    expect(valid.status).toBe(200)
  })

  test('keys expire after 24 hours: the same key then runs again', async () => {
    const context = await setup()
    const body = { input: shortInput }
    const first = await json(await run(context, 'daily', body))
    const row = await keyRow(context.org.id, 'daily')
    expect(row?.expiresAt.getTime()).toBe(
      (row?.createdAt.getTime() ?? 0) + IDEMPOTENCY_TTL_MS
    )

    setSystemTime(new Date(Date.now() + 25 * HOUR_MS))
    const second = await run(context, 'daily', body)

    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotent-Replayed')).toBeNull()
    const secondBody = await json(second)
    expect(secondBody.id).not.toBe(first.id)
    expect(await runCount(context.org.id)).toBe(2)
    expect(await keyRow(context.org.id, 'daily')).toMatchObject({
      status: 'completed',
      runId: secondBody.id
    })

    // The new claim replays for the next 24 hours.
    const third = await run(context, 'daily', body)
    expect(third.headers.get('Idempotent-Replayed')).toBe('true')
    expect((await json(third)).id).toBe(secondBody.id)
  })

  test('within the TTL the key still replays', async () => {
    const context = await setup()
    const body = { input: shortInput }
    await run(context, 'almost', body)

    setSystemTime(new Date(Date.now() + 23 * HOUR_MS))
    const response = await run(context, 'almost', body)

    expect(response.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await runCount(context.org.id)).toBe(1)
  })

  test('an expired key reused with another body runs instead of failing', async () => {
    const context = await setup()
    await run(context, 'recycled', { input: shortInput })

    setSystemTime(new Date(Date.now() + 25 * HOUR_MS))
    const response = await run(context, 'recycled', {
      input: { ticket: { message: 'ok' } }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotent-Replayed')).toBeNull()
  })

  test('a replay reflects the run as it is now', async () => {
    const context = await setup()
    fake.enqueue({
      category: {
        type: 'choice',
        choice: 'bug',
        probabilities: { bug: 0.5, billing: 0.3, other: 0.2 }
      }
    })
    const created = await json(await run(context, 'review-me'))
    expect(created.decision).toBe('needs_review')
    expect(created.review.status).toBe('pending')

    // As a reviewer resolving it would.
    await db
      .update(decisionRuns)
      .set({ finalDecision: 'billing' })
      .where(eq(decisionRuns.id, created.id))

    const replayed = await json(await run(context, 'review-me'))
    expect(replayed).toMatchObject({
      id: created.id,
      finalDecision: 'billing',
      review: { status: 'pending' }
    })
  })

  test.each([
    ['too long', 'k'.repeat(256)],
    ['non-ASCII', 'clé-1'],
    ['empty', ''],
    ['a control character', 'tab\there']
  ])('a %s key is 400 INVALID_IDEMPOTENCY_KEY', async (_, key) => {
    const context = await setup()

    const response = await run(context, key)

    expect(response.status).toBe(400)
    expect((await json(response)).error.code).toBe('INVALID_IDEMPOTENCY_KEY')
    expect(fake.calls).toHaveLength(0)
  })

  test('a 255-character printable key is accepted', async () => {
    const context = await setup()

    const response = await run(context, `${'k'.repeat(250)} ~!@#`)

    expect(response.status).toBe(200)
  })
})

describe('replays do not depend on what the ref resolves to now', () => {
  /** The stored run, completed under `key` with a bare ref (it ran 1.0). */
  async function completedBareRun(context: Setup, key: string) {
    const first = await run(context, key, { input: shortInput }, context.slug)
    expect(first.status).toBe(200)
    const body = await json(first)
    expect(body.version).toBe('1.0')
    return body
  }

  test('a bare ref that moved to a stricter major still replays the stored run', async () => {
    const context = await setup()
    const original = await completedBareRun(context, 'moved')
    await addVersion(context, { major: 2, minor: 0, definition: stricter })

    // Without the key the same body now fails 2.0's contract…
    const fresh = await run(context, null, { input: shortInput }, context.slug)
    expect(fresh.status).toBe(422)
    // …but the retry of the completed request gets its run back.
    const retry = await run(
      context,
      'moved',
      { input: shortInput },
      context.slug
    )

    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await json(retry)).toEqual(original)
    // Headers describe the replayed run's version (1.x), not today's 2.0.
    expect(retry.headers.get('Warning')).toContain(`${context.slug}@1"`)
    expect(retry.headers.get('Deprecation')).toBeNull()
    expect(await runCount(context.org.id)).toBe(1)
  })

  test('an archived template still replays', async () => {
    const context = await setup()
    const original = await json(await run(context, 'archived'))
    await db
      .update(decisionTemplates)
      .set({ status: 'archived' })
      .where(eq(decisionTemplates.id, context.templateId))

    const retry = await run(context, 'archived')

    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true')
    expect((await json(retry)).id).toBe(original.id)
    expect(fake.calls).toHaveLength(1)
    // Without the key the template is gone.
    expect((await run(context, null)).status).toBe(410)
  })

  test('a version whose model became unavailable still replays', async () => {
    const context = await setup()
    const original = await json(await run(context, 'model-gone'))
    await setVersionStatus(context.versionId, 'model_unavailable')

    const retry = await run(context, 'model-gone')

    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true')
    expect((await json(retry)).id).toBe(original.id)
  })

  test("Deprecation comes from the replayed run's version", async () => {
    const context = await setup()
    await completedBareRun(context, 'deprecated-since')
    await addVersion(context, {
      major: 2,
      minor: 0,
      definition: classifySupport
    })
    await setVersionStatus(context.versionId, 'deprecated')

    const retry = await run(
      context,
      'deprecated-since',
      { input: shortInput },
      context.slug
    )

    expect(retry.headers.get('Idempotent-Replayed')).toBe('true')
    expect((await json(retry)).version).toBe('1.0')
    expect(retry.headers.get('Deprecation')).toBe('true')
    expect(retry.headers.get('Warning')).toContain(`${context.slug}@1"`)
  })

  test('a completed key with another body is 422 even when the ref no longer resolves', async () => {
    const context = await setup()
    await run(context, 'reused-after-archive')
    await db
      .update(decisionTemplates)
      .set({ status: 'archived' })
      .where(eq(decisionTemplates.id, context.templateId))

    const response = await run(context, 'reused-after-archive', {
      input: { ticket: { message: 'Another request' } }
    })

    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })
})

describe('abandoned claims', () => {
  /** What a crash between claiming and completing/releasing leaves behind. */
  async function abandonedClaim(
    context: Setup,
    key: string,
    body: { input: unknown },
    claimedAt = new Date()
  ) {
    await db.insert(idempotencyKeys).values({
      organizationId: context.org.id,
      key,
      requestHash: idempotencyRequestHash({
        ref: `${context.slug}@1`,
        input: body.input,
        mode: 'live'
      }),
      status: 'in_progress',
      createdAt: claimedAt,
      expiresAt: new Date(claimedAt.getTime() + IDEMPOTENCY_TTL_MS)
    })
  }

  test('an in_progress key is 409 while its request could still run, then reclaimable', async () => {
    const context = await setup()
    const body = { input: shortInput }
    const claimedAt = new Date()
    await abandonedClaim(context, 'crashed', body, claimedAt)

    expect((await run(context, 'crashed', body)).status).toBe(409)
    setSystemTime(
      new Date(claimedAt.getTime() + IDEMPOTENCY_ABANDONED_MS - 1_000)
    )
    expect((await run(context, 'crashed', body)).status).toBe(409)

    setSystemTime(
      new Date(claimedAt.getTime() + IDEMPOTENCY_ABANDONED_MS + 1_000)
    )
    const retried = await run(context, 'crashed', body)

    expect(retried.status).toBe(200)
    expect(retried.headers.get('Idempotent-Replayed')).toBeNull()
    expect(await keyRow(context.org.id, 'crashed')).toMatchObject({
      status: 'completed',
      runId: (await json(retried)).id
    })
  })

  test('an abandoned claim can be taken over by another body, like a released one', async () => {
    const context = await setup()
    await abandonedClaim(
      context,
      'crashed-other',
      { input: { ticket: { message: 'first attempt' } } },
      new Date(Date.now() - 10 * 60_000)
    )

    const response = await run(context, 'crashed-other', { input: shortInput })

    expect(response.status).toBe(200)
  })

  test('the abandoned request finishing late never touches the new claim', async () => {
    const context = await setup()
    const organizationId = context.org.id
    const options = { organizationId, key: 'late', requestHash: 'h' }
    const first = await claimIdempotencyKey(db, {
      ...options,
      now: new Date(Date.now() - IDEMPOTENCY_ABANDONED_MS - 1_000)
    })
    const second = await claimIdempotencyKey(db, {
      ...options,
      now: new Date()
    })
    if (first.kind !== 'claimed' || second.kind !== 'claimed') {
      throw new Error('both requests should have claimed the key')
    }

    // The first request's release/completion target its own claim only.
    await releaseIdempotencyKey(db, {
      organizationId,
      key: 'late',
      claimedAt: first.claimedAt
    })
    expect(await keyRow(organizationId, 'late')).toMatchObject({
      status: 'in_progress',
      createdAt: second.claimedAt
    })
    const { id: runId } = await json(await run(context, null))
    await completeIdempotencyKey(db, {
      organizationId,
      key: 'late',
      runId,
      claimedAt: first.claimedAt
    })
    expect((await keyRow(organizationId, 'late'))?.status).toBe('in_progress')

    await completeIdempotencyKey(db, {
      organizationId,
      key: 'late',
      runId,
      claimedAt: second.claimedAt
    })
    expect(await keyRow(organizationId, 'late')).toMatchObject({
      status: 'completed',
      runId
    })
  })
})

describe('purgeExpiredIdempotencyKeys()', () => {
  test('deletes expired keys and keeps live ones', async () => {
    const context = await setup()
    await run(context, 'old')
    await run(context, 'recent')
    // Age "old" by a day.
    await db
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - HOUR_MS) })
      .where(
        and(
          eq(idempotencyKeys.organizationId, context.org.id),
          eq(idempotencyKeys.key, 'old')
        )
      )

    const purged = await purgeExpiredIdempotencyKeys(new Date())

    expect(purged).toBeGreaterThanOrEqual(1)
    expect(await keyRow(context.org.id, 'old')).toBeUndefined()
    expect(await keyRow(context.org.id, 'recent')).toBeDefined()
  })
})
