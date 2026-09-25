import { beforeEach, describe, expect, test } from 'bun:test'
import { getEvaluator, getFakeEvaluator } from '#modules/engine/evaluator'
import {
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import { galleryTemplate } from '#modules/templates/gallery'
import { inputJsonSchema } from '#modules/templates/input-schema'
import { getTemplate, loadDraft } from '#modules/templates/templates.service'
import {
  classifyDefinition,
  decideDefinition,
  scoreDefinition
} from '#modules/templates/wizards'
import { env } from '#shared/config/env'
import { hashJson } from '#shared/core/hash'
import {
  classifySupport,
  customTriage,
  decideRefund
} from '../fixtures/definitions'
import { json, type RequestOptions, testApi } from '../helpers/app'
import { addMember, createOrg, type TestOrg } from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())

// ── Helpers ──────────────────────────────────────────────────────────────

const put = (path: string, options?: RequestOptions) =>
  api.request('PUT', path, options)
const patch = (path: string, options?: RequestOptions) =>
  api.request('PATCH', path, options)

const parse = (definition: TemplateDefinitionInput) =>
  templateDefinitionSchema.parse(definition)

/** `POST /api/templates` from a raw definition, asserting the 201. */
async function createFrom(
  org: TestOrg,
  definition: TemplateDefinitionInput,
  extra: Record<string, unknown> = {}
) {
  const response = await api.post('/api/templates', {
    cookie: org.owner.cookie,
    body: {
      name: 'Support triage',
      ...extra,
      source: { type: 'definition', definition }
    }
  })
  expect(response.status).toBe(201)
  return json(response)
}

const draftOf = async (org: TestOrg, id: string, cookie = org.owner.cookie) => {
  const response = await api.get(`/api/templates/${id}/draft`, { cookie })
  expect(response.status).toBe(200)
  return json(response)
}

const saveDraft = (
  org: TestOrg,
  id: string,
  definition: unknown,
  ifMatch: string | undefined,
  cookie = org.owner.cookie
) =>
  put(`/api/templates/${id}/draft`, {
    cookie,
    body: { definition },
    headers: ifMatch === undefined ? {} : { 'if-match': ifMatch }
  })

const publish = (
  org: TestOrg,
  id: string,
  body: Record<string, unknown>,
  cookie = org.owner.cookie
) => api.post(`/api/templates/${id}/publish`, { cookie, body })

/** Loads the draft and publishes it as is, asserting the 201. */
async function publishDraft(
  org: TestOrg,
  id: string,
  options: { major?: boolean; changelog?: string } = {}
) {
  const draft = await draftOf(org, id)
  const response = await publish(org, id, {
    expectedDraftHash: draft.definitionHash,
    ...options
  })
  expect(response.status).toBe(201)
  return json(response)
}

/** Saves `definition` over the current draft, asserting the 200. */
async function edit(
  org: TestOrg,
  id: string,
  definition: TemplateDefinitionInput
) {
  const draft = await draftOf(org, id)
  const response = await saveDraft(org, id, definition, draft.definitionHash)
  expect(response.status).toBe(200)
  return json(response)
}

/** `classifySupport` plus a label (a breaking change). */
const withLabel = (label: string): TemplateDefinitionInput => {
  const definition = parse(classifySupport)
  const category = definition.questions.category
  if (category?.type !== 'choice') throw new Error('classifySupport changed')
  return {
    ...definition,
    decisions: [...definition.decisions, { label, minConfidence: 0.8 }],
    questions: {
      category: {
        ...category,
        criteria: { ...category.criteria, [label]: null }
      }
    }
  }
}

/** `definition` with another description on its first label (a compatible change). */
const withDescription = (
  definition: TemplateDefinitionInput,
  description: string
): TemplateDefinitionInput => {
  const parsed = parse(definition)
  return {
    ...parsed,
    decisions: parsed.decisions.map((decision, index) =>
      index === 0 ? { ...decision, description } : decision
    )
  }
}

/** Temporarily changes the evaluator's capabilities (the object is shared by every decorator). */
async function withCapabilities(
  overrides: Partial<ReturnType<typeof getEvaluator>['capabilities']>,
  run: () => Promise<void>
) {
  const capabilities = getEvaluator().capabilities
  const original = { ...capabilities }
  Object.assign(capabilities, overrides)
  try {
    await run()
  } finally {
    Object.assign(capabilities, original)
  }
}

const isIsoDate = (value: unknown) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

// ── Create ───────────────────────────────────────────────────────────────

describe('POST /api/templates', () => {
  test('blank: an empty definition of the kind, with the slug from the name', async () => {
    const org = await createOrg()

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Reseñas de clientes',
        source: { type: 'blank', kind: 'score' }
      }
    })

    expect(response.status).toBe(201)
    const { template, draft } = await json(response)
    const definition = parse({
      kind: 'score',
      input: { fields: [] },
      decisions: []
    })
    expect(template).toEqual({
      id: expect.any(String),
      slug: 'resenas-de-clientes',
      name: 'Reseñas de clientes',
      description: null,
      kind: 'score',
      status: 'active',
      storeInput: 'full',
      retentionDays: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      slugLocked: false,
      hasDraft: true,
      latestVersion: null
    })
    expect(isIsoDate(template.createdAt)).toBe(true)
    expect(draft).toEqual({
      id: expect.any(String),
      definition,
      definitionHash: hashJson(definition),
      updatedAt: expect.any(String),
      lint: expect.any(Array),
      changes: [],
      breaking: false,
      nextVersion: { minor: '1.0', major: '1.0' },
      basedOn: null,
      warnings: []
    })
    // A blank draft can't be published yet.
    expect(draft.lint).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'NO_DECISIONS' })
    )
  })

  test('gallery: copies the definition and suggests the gallery slug', async () => {
    const org = await createOrg()
    const gallery = galleryTemplate('support-ticket-classifier')

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Our support queue',
        source: { type: 'gallery', id: 'support-ticket-classifier' }
      }
    })

    expect(response.status).toBe(201)
    const { template, draft } = await json(response)
    expect(template.slug).toBe('support-ticket-classifier')
    expect(template.name).toBe('Our support queue')
    expect(template.kind).toBe('classify')
    expect(draft.definition).toEqual(
      JSON.parse(JSON.stringify(gallery?.definition))
    )
    expect(
      draft.lint.filter((i: { severity: string }) => i.severity === 'error')
    ).toEqual([])
  })

  test('classify wizard: builds the definition server side', async () => {
    const org = await createOrg()
    const wizard = {
      instructions: 'What is `text` about?',
      labels: [
        { label: 'bug', description: 'Something is broken' },
        { label: 'billing', criteria: 'Charges and invoices' }
      ],
      minConfidence: 0.7
    }

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: { name: 'Tickets', source: { type: 'classify', ...wizard } }
    })

    expect(response.status).toBe(201)
    const { template, draft } = await json(response)
    expect(template.kind).toBe('classify')
    expect(draft.definition).toEqual(classifyDefinition(wizard))
    expect(draft.definitionHash).toBe(hashJson(classifyDefinition(wizard)))
  })

  test('decide wizard: builds the definition server side', async () => {
    const org = await createOrg()
    const wizard = {
      instructions: 'Does `text` qualify for a refund?',
      yes: { label: 'approve', description: 'Refund it' },
      no: { label: 'reject' },
      yesThreshold: 0.95,
      noThreshold: 0.05,
      questionId: 'qualifies'
    }

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: { name: 'Refunds', source: { type: 'decide', ...wizard } }
    })

    expect(response.status).toBe(201)
    const { template, draft } = await json(response)
    expect(template.kind).toBe('decide')
    expect(draft.definition).toEqual(decideDefinition(wizard))
  })

  test('score wizard: builds the definition server side', async () => {
    const org = await createOrg()
    const wizard = {
      instructions: 'How urgent is `text`?',
      levels: [
        { label: 'low', description: 'Can wait' },
        { label: 'medium', criteria: 'Should be handled today' },
        { label: 'high', description: 'Drop everything' }
      ],
      minConfidence: 0.7,
      questionId: 'urgency'
    }

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: { name: 'Triage', source: { type: 'score', ...wizard } }
    })

    expect(response.status).toBe(201)
    const { template, draft } = await json(response)
    expect(template.kind).toBe('score')
    expect(draft.definition).toEqual(scoreDefinition(wizard))
    expect(draft.definitionHash).toBe(hashJson(scoreDefinition(wizard)))
    expect(
      draft.lint.filter((i: { severity: string }) => i.severity === 'error')
    ).toEqual([])
  })

  test('definition: stores it with the schema defaults applied', async () => {
    const org = await createOrg()

    const { template, draft } = await createFrom(org, customTriage, {
      slug: 'triage',
      description: 'Routes tickets',
      storeInput: 'policy',
      retentionDays: 30
    })

    expect(template).toMatchObject({
      slug: 'triage',
      name: 'Support triage',
      description: 'Routes tickets',
      kind: 'custom',
      storeInput: 'policy',
      retentionDays: 30
    })
    expect(draft.definition).toEqual(parse(customTriage))
    expect(draft.definitionHash).toBe(hashJson(parse(customTriage)))
  })

  test('wizard range errors are a 422 on the offending source field', async () => {
    const org = await createOrg()

    const classify = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Tickets',
        source: {
          type: 'classify',
          instructions: 'What is it about?',
          labels: [{ label: 'a' }, { label: 'b' }],
          minConfidence: 1.5
        }
      }
    })
    expect(classify.status).toBe(422)
    const classifyBody = await json(classify)
    expect(classifyBody.error.code).toBe('VALIDATION_FAILED')
    expect(classifyBody.error.details.issues).toEqual([
      {
        path: 'source.minConfidence',
        message: expect.stringContaining('minConfidence'),
        code: 'out_of_range'
      }
    ])

    const decide = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Refunds',
        source: {
          type: 'decide',
          instructions: 'Refund?',
          yes: { label: 'yes' },
          no: { label: 'no' },
          noThreshold: 0.6
        }
      }
    })
    expect(decide.status).toBe(422)
    expect((await json(decide)).error.details.issues[0].path).toBe(
      'source.noThreshold'
    )

    const yes = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Refunds',
        source: {
          type: 'decide',
          instructions: 'Refund?',
          yes: { label: 'yes' },
          no: { label: 'no' },
          yesThreshold: 0.4
        }
      }
    })
    expect((await json(yes)).error.details.issues[0].path).toBe(
      'source.yesThreshold'
    )

    const score = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Triage',
        source: {
          type: 'score',
          instructions: 'How urgent?',
          levels: [{ label: 'low' }, { label: 'high' }],
          minConfidence: -1
        }
      }
    })
    expect(score.status).toBe(422)
    expect((await json(score)).error.details.issues).toEqual([
      {
        path: 'source.minConfidence',
        message: expect.stringContaining('minConfidence'),
        code: 'out_of_range'
      }
    ])
  })

  test('invalid wizard names are reported at their body path', async () => {
    const org = await createOrg()

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Tickets',
        source: {
          type: 'classify',
          instructions: 'What is it about?',
          labels: [{ label: 'Bad Label' }],
          questionId: 'Not-A-Key'
        }
      }
    })

    expect(response.status).toBe(422)
    const paths = (await json(response)).error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(paths).toEqual(
      expect.arrayContaining(['source.labels.0.label', 'source.questionId'])
    )

    const scoreResponse = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Triage',
        source: {
          type: 'score',
          instructions: 'How urgent?',
          levels: [{ label: 'Bad Level' }],
          questionId: 'Not-A-Key'
        }
      }
    })
    expect(scoreResponse.status).toBe(422)
    const scorePaths = (await json(scoreResponse)).error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(scorePaths).toEqual(
      expect.arrayContaining(['source.levels.0.label', 'source.questionId'])
    )
  })

  test('validation errors use the public format with body paths', async () => {
    const org = await createOrg()

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: '',
        slug: 'Not A Slug',
        retentionDays: 0,
        source: {
          type: 'definition',
          definition: { kind: 'nope', input: { fields: [] }, decisions: [] }
        }
      }
    })

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed'
    })
    const issues: { path: string; message: string; code: string }[] =
      body.error.details.issues
    for (const issue of issues) {
      expect(issue).toEqual({
        path: expect.any(String),
        message: expect.any(String),
        code: expect.any(String)
      })
    }
    expect(issues.map(issue => issue.path)).toEqual(
      expect.arrayContaining([
        'name',
        'slug',
        'retentionDays',
        'source.definition.kind'
      ])
    )
  })

  test('unknown source types and gallery ids are 422', async () => {
    const org = await createOrg()

    const unknownType = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: { name: 'X', source: { type: 'magic' } }
    })
    expect(unknownType.status).toBe(422)
    expect((await json(unknownType)).error.details.issues[0].path).toBe(
      'source.type'
    )

    const unknownGallery = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: { name: 'X', source: { type: 'gallery', id: 'nope' } }
    })
    expect(unknownGallery.status).toBe(422)
    expect((await json(unknownGallery)).error.details.issues).toEqual([
      expect.objectContaining({
        path: 'source.id',
        message: 'Unknown gallery template'
      })
    ])
  })

  test('a definition over the size limit is rejected', async () => {
    const org = await createOrg()
    const fields = Array.from({ length: 150 }, (_, index) => ({
      path: `field_${index}`,
      type: 'string',
      description: 'x'.repeat(2_000)
    }))

    const response = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Huge',
        source: {
          type: 'definition',
          definition: { kind: 'custom', input: { fields }, decisions: [] }
        }
      }
    })

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.issues).toEqual([
      expect.objectContaining({ path: 'source.definition', code: 'too_big' })
    ])
  })

  test('a slug already used in the organization is 409 SLUG_TAKEN', async () => {
    const org = await createOrg()
    await createFrom(org, classifySupport, { name: 'Support' })

    const bySlug = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Something else',
        slug: 'support',
        source: { type: 'blank', kind: 'custom' }
      }
    })
    expect(bySlug.status).toBe(409)
    expect(await json(bySlug)).toEqual({
      error: {
        code: 'SLUG_TAKEN',
        message: expect.any(String),
        details: { slug: 'support' }
      }
    })

    // The default slug collides the same way.
    const byName = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: { name: 'Support', source: { type: 'blank', kind: 'custom' } }
    })
    expect(byName.status).toBe(409)

    // Another organization may use it.
    const other = await createOrg()
    await createFrom(other, classifySupport, { name: 'Support' })
  })

  test('concurrent creations with the same slug: one 201 and one 409', async () => {
    const org = await createOrg()
    const body = { name: 'Race', source: { type: 'blank', kind: 'custom' } }

    const statuses = await Promise.all(
      [1, 2].map(() =>
        api
          .post('/api/templates', { cookie: org.owner.cookie, body })
          .then(response => response.status)
      )
    )

    expect(statuses.sort()).toEqual([201, 409])
  })

  test('members can create templates', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')

    const response = await api.post('/api/templates', {
      cookie: member.cookie,
      body: { name: 'Mine', source: { type: 'blank', kind: 'custom' } }
    })

    expect(response.status).toBe(201)
  })

  test('requires a session and a JSON body', async () => {
    const org = await createOrg()

    expect(
      (
        await api.post('/api/templates', {
          body: { name: 'X', source: { type: 'blank', kind: 'custom' } }
        })
      ).status
    ).toBe(401)

    const notJson = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: '{"name": ',
      headers: { 'content-type': 'application/json' }
    })
    expect(notJson.status).toBe(400)
    expect((await json(notJson)).error.code).toBe('INVALID_JSON')

    const wrongType = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: 'name=x',
      headers: { 'content-type': 'text/plain' }
    })
    expect(wrongType.status).toBe(415)
  })
})

// ── List and read ────────────────────────────────────────────────────────

describe('GET /api/templates', () => {
  test('lists active templates, most recently updated first', async () => {
    const org = await createOrg()
    const first = await createFrom(org, classifySupport, { name: 'First' })
    const second = await createFrom(org, decideRefund, { name: 'Second' })
    const archived = await createFrom(org, customTriage, { name: 'Old' })
    await api.post(`/api/templates/${archived.template.id}/archive`, {
      cookie: org.owner.cookie
    })
    // Editing the first one's draft moves it to the top.
    await Bun.sleep(5)
    await edit(org, first.template.id, withDescription(classifySupport, 'x'))

    const response = await api.get('/api/templates', {
      cookie: org.owner.cookie
    })

    expect(response.status).toBe(200)
    const { data } = await json(response)
    expect(data.map((t: { id: string }) => t.id)).toEqual([
      first.template.id,
      second.template.id
    ])
    expect(data[1]).toEqual(second.template)
  })

  test('filters by status', async () => {
    const org = await createOrg()
    const active = await createFrom(org, classifySupport, { name: 'Active' })
    const archived = await createFrom(org, decideRefund, { name: 'Archived' })
    await api.post(`/api/templates/${archived.template.id}/archive`, {
      cookie: org.owner.cookie
    })

    const ids = async (status: string) => {
      const response = await api.get(`/api/templates?status=${status}`, {
        cookie: org.owner.cookie
      })
      expect(response.status).toBe(200)
      return (await json(response)).data.map((t: { id: string }) => t.id)
    }

    expect(await ids('active')).toEqual([active.template.id])
    expect(await ids('archived')).toEqual([archived.template.id])
    expect((await ids('all')).sort()).toEqual(
      [active.template.id, archived.template.id].sort()
    )

    const invalid = await api.get('/api/templates?status=deleted', {
      cookie: org.owner.cookie
    })
    expect(invalid.status).toBe(422)
    expect((await json(invalid)).error.details.issues[0].path).toBe('status')
  })

  test("never lists another organization's templates", async () => {
    const org = await createOrg()
    const other = await createOrg()
    await createFrom(other, classifySupport)

    const response = await api.get('/api/templates?status=all', {
      cookie: org.owner.cookie
    })

    expect((await json(response)).data).toEqual([])
  })

  test('latestVersion is the highest-numbered released version', async () => {
    const org = await createOrg()
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [
        { major: 1, minor: 0 },
        { major: 2, minor: 0, status: 'deprecated' },
        { major: 1, minor: 1 }
      ]
    })

    const response = await api.get('/api/templates', {
      cookie: org.owner.cookie
    })

    const [view] = (await json(response)).data
    expect(view).toMatchObject({
      id: template.id,
      slugLocked: true,
      hasDraft: false,
      latestVersion: {
        id: versions[1]?.id,
        version: '2.0',
        major: 2,
        minor: 0,
        status: 'deprecated',
        publishedAt: expect.any(String)
      }
    })
  })
})

describe('GET /api/templates/:id', () => {
  test('returns the template', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const response = await api.get(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie
    })

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ template })
  })

  test("404 for unknown ids and other organizations' templates", async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { template } = await createFrom(other, classifySupport)

    for (const id of [template.id, 'nope']) {
      const response = await api.get(`/api/templates/${id}`, {
        cookie: org.owner.cookie
      })
      expect(response.status).toBe(404)
      expect((await json(response)).error.code).toBe('NOT_FOUND')
    }
  })
})

// ── Update ───────────────────────────────────────────────────────────────

describe('PATCH /api/templates/:id', () => {
  test('updates the settings', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport, {
      retentionDays: 7
    })

    const response = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: {
        name: '  Renamed  ',
        description: 'Now documented',
        storeInput: 'none',
        retentionDays: null
      }
    })

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.template).toMatchObject({
      id: template.id,
      slug: template.slug,
      name: 'Renamed',
      description: 'Now documented',
      storeInput: 'none',
      retentionDays: null
    })
    expect(Date.parse(body.template.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(template.updatedAt)
    )

    const row = await getTemplate(org.id, template.id)
    expect(row.name).toBe('Renamed')
    expect(row.retentionDays).toBeNull()
  })

  test('an empty patch changes nothing', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const response = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: {}
    })

    expect(response.status).toBe(200)
    expect((await json(response)).template).toEqual(template)
  })

  test('rejects invalid values', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const response = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: { retentionDays: 1.5, storeInput: 'some', name: 'x'.repeat(121) }
    })

    expect(response.status).toBe(422)
    const paths = (await json(response)).error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(paths.sort()).toEqual(['name', 'retentionDays', 'storeInput'])
  })

  test('the slug can change until the first publish, then it is locked', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const renamed = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: { slug: 'support-v2' }
    })
    expect(renamed.status).toBe(200)
    expect((await json(renamed)).template.slug).toBe('support-v2')

    await publishDraft(org, template.id)

    const locked = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: { slug: 'support-v3' }
    })
    expect(locked.status).toBe(409)
    expect((await json(locked)).error.code).toBe('SLUG_LOCKED')

    // Sending the current slug is not a change.
    const same = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: { slug: 'support-v2', name: 'Still editable' }
    })
    expect(same.status).toBe(200)
    expect((await json(same)).template).toMatchObject({
      slug: 'support-v2',
      name: 'Still editable',
      slugLocked: true
    })
  })

  test('a slug taken by another template is 409 SLUG_TAKEN', async () => {
    const org = await createOrg()
    await createFrom(org, classifySupport, { slug: 'taken' })
    const { template } = await createFrom(org, decideRefund, { slug: 'mine' })

    const response = await patch(`/api/templates/${template.id}`, {
      cookie: org.owner.cookie,
      body: { slug: 'taken' }
    })

    expect(response.status).toBe(409)
    expect((await json(response)).error.code).toBe('SLUG_TAKEN')
  })

  test("members can edit; nobody can edit another organization's template", async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const other = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const byMember = await patch(`/api/templates/${template.id}`, {
      cookie: member.cookie,
      body: { name: 'By a member' }
    })
    expect(byMember.status).toBe(200)

    const byOther = await patch(`/api/templates/${template.id}`, {
      cookie: other.owner.cookie,
      body: { name: 'Hijacked' }
    })
    expect(byOther.status).toBe(404)
    expect((await getTemplate(org.id, template.id)).name).toBe('By a member')
  })
})

describe('archive / restore', () => {
  test('archives and restores a template', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const archived = await api.post(`/api/templates/${template.id}/archive`, {
      cookie: org.owner.cookie
    })
    expect(archived.status).toBe(200)
    expect((await json(archived)).template).toMatchObject({
      id: template.id,
      status: 'archived'
    })

    const restored = await api.post(`/api/templates/${template.id}/restore`, {
      cookie: org.owner.cookie
    })
    expect(restored.status).toBe(200)
    expect((await json(restored)).template.status).toBe('active')
  })

  test('an archived template cannot be published (410)', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    await api.post(`/api/templates/${template.id}/archive`, {
      cookie: org.owner.cookie
    })

    const response = await publish(org, template.id, {
      expectedDraftHash: draft.definitionHash
    })

    expect(response.status).toBe(410)
    expect((await json(response)).error.code).toBe('TEMPLATE_ARCHIVED')

    await api.post(`/api/templates/${template.id}/restore`, {
      cookie: org.owner.cookie
    })
    expect(
      (
        await publish(org, template.id, {
          expectedDraftHash: draft.definitionHash
        })
      ).status
    ).toBe(201)
  })

  test('members cannot archive or restore; other organizations get 404', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const other = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    for (const action of ['archive', 'restore']) {
      const response = await api.post(
        `/api/templates/${template.id}/${action}`,
        { cookie: member.cookie }
      )
      expect(response.status).toBe(403)
      expect((await json(response)).error.code).toBe('FORBIDDEN')
    }
    expect(
      (
        await api.post(`/api/templates/${template.id}/archive`, {
          cookie: other.owner.cookie
        })
      ).status
    ).toBe(404)
    expect((await getTemplate(org.id, template.id)).status).toBe('active')
  })
})

// ── Draft ────────────────────────────────────────────────────────────────

describe('GET /api/templates/:id/draft', () => {
  test('returns the draft with its hash as ETag', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)

    const response = await api.get(`/api/templates/${template.id}/draft`, {
      cookie: org.owner.cookie
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"${draft.definitionHash}"`)
    expect(await json(response)).toEqual(draft)
  })

  test('exposes the ETag to cross-origin callers (the dashboard)', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const headers = { origin: env.APP_URL }
    const exposed = (response: Response) =>
      (response.headers.get('access-control-expose-headers') ?? '')
        .split(',')
        .map(name => name.trim().toLowerCase())

    const loaded = await api.get(`/api/templates/${template.id}/draft`, {
      cookie: org.owner.cookie,
      headers
    })
    expect(loaded.status).toBe(200)
    expect(loaded.headers.get('access-control-allow-origin')).toBe(env.APP_URL)
    expect(exposed(loaded)).toContain('etag')

    const saved = await put(`/api/templates/${template.id}/draft`, {
      cookie: org.owner.cookie,
      body: { definition: withDescription(classifySupport, 'CORS') },
      headers: { ...headers, 'if-match': draft.definitionHash }
    })
    expect(saved.status).toBe(200)
    expect(exposed(saved)).toContain('etag')
  })

  test('after a publish, a new draft copies the published definition', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const { version } = await publishDraft(org, template.id)

    const draft = await draftOf(org, template.id)

    expect(draft.id).not.toBe(version.id)
    expect(draft.definition).toEqual(parse(classifySupport))
    expect(draft.definitionHash).toBe(version.definitionHash)
    expect(draft).toMatchObject({
      changes: [],
      breaking: false,
      nextVersion: { minor: '1.1', major: '2.0' },
      basedOn: { id: version.id, version: '1.0' }
    })
  })

  test('copies the highest version when a template has no draft', async () => {
    const org = await createOrg()
    const v11 = withDescription(classifySupport, 'Version 1.1')
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [
        { major: 1, minor: 1, definition: v11 },
        { major: 1, minor: 0 }
      ]
    })

    const draft = await draftOf(org, template.id)

    expect(draft.definition).toEqual(parse(v11))
    expect(draft.basedOn).toEqual({ id: versions[0]?.id, version: '1.1' })
    expect(draft.nextVersion).toEqual({ minor: '1.2', major: '2.0' })
  })

  test('a template without versions or draft gets a blank draft', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: decideRefund,
      versions: []
    })

    const draft = await draftOf(org, template.id)

    expect(draft.definition).toEqual(
      parse({ kind: 'decide', input: { fields: [] }, decisions: [] })
    )
    expect(draft.basedOn).toBeNull()
  })

  test('concurrent loads create a single draft', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => draftOf(org, template.id))
    )

    expect(new Set(drafts.map(draft => draft.id)).size).toBe(1)
    expect(await loadDraft(org.id, template.id)).toMatchObject({
      id: drafts[0].id,
      status: 'draft'
    })
  })

  test('warns when the provider cannot pin the model', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    await withCapabilities({ versionedModels: false }, async () => {
      const draft = await draftOf(org, template.id)
      expect(draft.warnings).toEqual(['MODEL_UNPINNED'])

      const response = await publish(org, template.id, {
        expectedDraftHash: draft.definitionHash
      })
      expect(response.status).toBe(201)
      expect((await json(response)).warnings).toEqual(['MODEL_UNPINNED'])
    })

    expect((await draftOf(org, template.id)).warnings).toEqual([])
  })

  test("lints against the evaluator's context limit", async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const hasBudgetWarning = (lint: { code: string }[]) =>
      lint.some(issue => issue.code === 'TOKEN_BUDGET')
    expect(hasBudgetWarning(draft.lint)).toBe(false)

    await withCapabilities({ maxContextTokens: 1 }, async () => {
      expect(hasBudgetWarning((await draftOf(org, template.id)).lint)).toBe(
        true
      )
    })
  })

  test("404 for another organization's template", async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { template } = await createFrom(other, classifySupport)

    const response = await api.get(`/api/templates/${template.id}/draft`, {
      cookie: org.owner.cookie
    })

    expect(response.status).toBe(404)
  })
})

describe('PUT /api/templates/:id/draft', () => {
  test('saves with a matching If-Match, quoted or bare', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const next = withDescription(classifySupport, 'Edited')

    const quoted = await saveDraft(
      org,
      template.id,
      next,
      `"${draft.definitionHash}"`
    )
    expect(quoted.status).toBe(200)
    const saved = await json(quoted)
    expect(saved).toMatchObject({
      id: draft.id,
      definition: parse(next),
      definitionHash: hashJson(parse(next)),
      changes: [],
      nextVersion: { minor: '1.0', major: '1.0' }
    })
    expect(quoted.headers.get('etag')).toBe(`"${saved.definitionHash}"`)

    const bare = await saveDraft(
      org,
      template.id,
      classifySupport,
      saved.definitionHash
    )
    expect(bare.status).toBe(200)
    expect((await json(bare)).definitionHash).toBe(
      hashJson(parse(classifySupport))
    )
  })

  test('428 without If-Match', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const response = await saveDraft(
      org,
      template.id,
      classifySupport,
      undefined
    )

    expect(response.status).toBe(428)
    expect((await json(response)).error.code).toBe('PRECONDITION_REQUIRED')
  })

  test('409 DRAFT_CONFLICT with the current hash when If-Match is stale', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const edited = await edit(
      org,
      template.id,
      withDescription(classifySupport, 'Someone else')
    )

    const response = await saveDraft(
      org,
      template.id,
      decideRefund,
      draft.definitionHash
    )

    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({
      error: {
        code: 'DRAFT_CONFLICT',
        message: expect.any(String),
        details: { currentHash: edited.definitionHash }
      }
    })
    expect((await draftOf(org, template.id)).definitionHash).toBe(
      edited.definitionHash
    )
  })

  test('concurrent saves from the same hash: one wins, the other conflicts', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)

    const responses = await Promise.all(
      ['A', 'B'].map(description =>
        saveDraft(
          org,
          template.id,
          withDescription(classifySupport, description),
          draft.definitionHash
        )
      )
    )

    expect(responses.map(response => response.status).sort()).toEqual([
      200, 409
    ])
  })

  test('updates the template kind and updatedAt', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    await Bun.sleep(5) // so updatedAt visibly moves

    const response = await saveDraft(
      org,
      template.id,
      decideRefund,
      draft.definitionHash
    )
    expect(response.status).toBe(200)

    const current = await json(
      await api.get(`/api/templates/${template.id}`, {
        cookie: org.owner.cookie
      })
    )
    expect(current.template.kind).toBe('decide')
    expect(Date.parse(current.template.updatedAt)).toBeGreaterThan(
      Date.parse(template.updatedAt)
    )
  })

  test('validates the definition, with paths under definition.', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)

    const response = await saveDraft(
      org,
      template.id,
      {
        ...parse(classifySupport),
        decisions: [{ label: 'Not Valid' }],
        extra: true
      },
      draft.definitionHash
    )

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    const paths = body.error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(paths).toEqual(
      expect.arrayContaining(['definition.decisions.0.label', 'definition'])
    )
  })

  test('rejects a definition over the size limit', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const fields = Array.from({ length: 150 }, (_, index) => ({
      path: `field_${index}`,
      type: 'string',
      description: 'x'.repeat(2_000)
    }))

    const response = await saveDraft(
      org,
      template.id,
      { kind: 'custom', input: { fields }, decisions: [] },
      draft.definitionHash
    )

    expect(response.status).toBe(422)
    expect((await json(response)).error.details.issues).toEqual([
      expect.objectContaining({ path: 'definition', code: 'too_big' })
    ])
  })

  test('saves drafts with lint errors, but they block publishing', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const broken = {
      ...parse(classifySupport),
      rules: [{ id: 'always', when: { all: [] }, decision: 'nonexistent' }]
    }

    const saved = await saveDraft(
      org,
      template.id,
      broken,
      draft.definitionHash
    )
    expect(saved.status).toBe(200)
    const savedDraft = await json(saved)
    expect(savedDraft.lint).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'UNKNOWN_LABEL' })
    )

    const response = await publish(org, template.id, {
      expectedDraftHash: savedDraft.definitionHash
    })
    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('LINT_FAILED')
    expect(body.error.details.issues).toEqual(savedDraft.lint)
    expect(
      (
        await json(
          await api.get(`/api/templates/${template.id}/versions`, {
            cookie: org.owner.cookie
          })
        )
      ).data
    ).toEqual([])
  })

  test('creates the draft lazily after a publish (If-Match = the version hash)', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const { version } = await publishDraft(org, template.id)

    const response = await saveDraft(
      org,
      template.id,
      withDescription(classifySupport, 'Next'),
      version.definitionHash
    )

    expect(response.status).toBe(200)
    const draft = await json(response)
    expect(draft.id).not.toBe(version.id)
    expect(draft.changes).toEqual([
      expect.objectContaining({
        code: 'DESCRIPTION_CHANGED',
        severity: 'compatible'
      })
    ])
  })

  test('members can edit the draft', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { template, draft } = await createFrom(org, classifySupport)

    const response = await saveDraft(
      org,
      template.id,
      withDescription(classifySupport, 'By a member'),
      draft.definitionHash,
      member.cookie
    )

    expect(response.status).toBe(200)
  })

  test("404 for another organization's template", async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { template, draft } = await createFrom(other, classifySupport)

    const response = await saveDraft(
      org,
      template.id,
      decideRefund,
      draft.definitionHash
    )

    expect(response.status).toBe(404)
    expect((await draftOf(other, template.id)).definitionHash).toBe(
      draft.definitionHash
    )
  })
})

// ── Lint ─────────────────────────────────────────────────────────────────

describe('POST /api/templates/lint', () => {
  const lint = (
    org: TestOrg,
    body: Record<string, unknown>,
    cookie = org.owner.cookie
  ) => api.post('/api/templates/lint', { cookie, body })

  test('lints a definition without saving it: nothing is created', async () => {
    const org = await createOrg()
    const broken = {
      ...parse(classifySupport),
      rules: [{ id: 'always', when: { all: [] }, decision: 'nonexistent' }]
    }

    const response = await lint(org, { definition: broken })

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.lint).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'UNKNOWN_LABEL' })
    )
    expect('changes' in body).toBe(false)

    const listed = await json(
      await api.get('/api/templates', { cookie: org.owner.cookie })
    )
    expect(listed.data).toEqual([])
  })

  test('matches the lint a draft with the same definition would show', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const draft = await draftOf(org, template.id)

    const response = await lint(org, { definition: classifySupport })

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.lint).toEqual(draft.lint)
    expect('changes' in body).toBe(false)
  })

  test('an oversized definition is a lint error, not a 422: nothing is saved anyway', async () => {
    const org = await createOrg()
    const fields = Array.from({ length: 150 }, (_, index) => ({
      path: `field_${index}`,
      type: 'string',
      description: 'x'.repeat(2_000)
    }))

    const response = await lint(org, {
      definition: { kind: 'custom', input: { fields }, decisions: [] }
    })

    expect(response.status).toBe(200)
    expect((await json(response)).lint).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'DEFINITION_TOO_LARGE'
      })
    )
  })

  test('with templateId: the same diff and lint a draft save against the latest version would show', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    await publishDraft(org, template.id)
    const edited = withLabel('vip')

    const savedDraft = await edit(org, template.id, edited)

    const response = await lint(org, {
      definition: edited,
      templateId: template.id
    })

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.lint).toEqual(savedDraft.lint)
    expect(body.changes).toEqual(savedDraft.changes)
    expect(body.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LABEL_ADDED', severity: 'breaking' })
      ])
    )
  })

  test('with templateId but no published version yet, changes is []', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const response = await lint(org, {
      definition: classifySupport,
      templateId: template.id
    })

    expect(response.status).toBe(200)
    expect((await json(response)).changes).toEqual([])
  })

  test("404 for another organization's templateId", async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { template } = await createFrom(other, classifySupport)

    const response = await lint(org, {
      definition: classifySupport,
      templateId: template.id
    })

    expect(response.status).toBe(404)
  })

  test('404 for an unknown templateId', async () => {
    const org = await createOrg()

    const response = await lint(org, {
      definition: classifySupport,
      templateId: '00000000-0000-0000-0000-000000000000'
    })

    expect(response.status).toBe(404)
  })

  test('validates the definition, with paths under definition.', async () => {
    const org = await createOrg()

    const response = await lint(org, {
      definition: {
        ...parse(classifySupport),
        decisions: [{ label: 'Not Valid' }],
        extra: true
      }
    })

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    const paths = body.error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(paths).toEqual(
      expect.arrayContaining(['definition.decisions.0.label', 'definition'])
    )
  })

  test('NUL characters in the definition are a 422 at their path', async () => {
    const org = await createOrg()
    const withNul = '\u0000'

    const response = await lint(org, {
      definition: withDescription(classifySupport, `bad ${withNul} name`)
    })

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.issues).toEqual([
      {
        path: 'definition.decisions.0.description',
        message: 'Must not contain NUL characters',
        code: 'custom'
      }
    ])
  })

  test('members can lint', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')

    const response = await lint(
      org,
      { definition: classifySupport },
      member.cookie
    )

    expect(response.status).toBe(200)
  })

  test('requires a session and a JSON body', async () => {
    const org = await createOrg()

    expect(
      (
        await api.post('/api/templates/lint', {
          body: { definition: classifySupport }
        })
      ).status
    ).toBe(401)

    const notJson = await api.post('/api/templates/lint', {
      cookie: org.owner.cookie,
      body: '{"definition": ',
      headers: { 'content-type': 'application/json' }
    })
    expect(notJson.status).toBe(400)
    expect((await json(notJson)).error.code).toBe('INVALID_JSON')

    const wrongType = await api.post('/api/templates/lint', {
      cookie: org.owner.cookie,
      body: 'definition=x',
      headers: { 'content-type': 'text/plain' }
    })
    expect(wrongType.status).toBe(415)
  })
})

// ── Publish ──────────────────────────────────────────────────────────────

describe('POST /api/templates/:id/publish', () => {
  test('create → conflict → save → 1.0 → unchanged → breaking → 2.0 → 2.1', async () => {
    const org = await createOrg()
    const created = await api.post('/api/templates', {
      cookie: org.owner.cookie,
      body: {
        name: 'Tickets',
        source: {
          type: 'classify',
          instructions: 'What is `text` about?',
          labels: [{ label: 'bug' }, { label: 'billing' }]
        }
      }
    })
    expect(created.status).toBe(201)
    const { template } = await json(created)
    const draft = await draftOf(org, template.id)

    // A stale hash is refused.
    const conflict = await saveDraft(org, template.id, classifySupport, 'stale')
    expect(conflict.status).toBe(409)
    expect((await json(conflict)).error.details.currentHash).toBe(
      draft.definitionHash
    )

    const saved = await saveDraft(
      org,
      template.id,
      classifySupport,
      draft.definitionHash
    )
    expect(saved.status).toBe(200)
    const savedDraft = await json(saved)

    // 1.0
    const first = await publish(org, template.id, {
      expectedDraftHash: savedDraft.definitionHash,
      changelog: 'First release'
    })
    expect(first.status).toBe(201)
    const v1 = await json(first)
    expect(v1).toEqual({
      version: {
        id: savedDraft.id,
        version: '1.0',
        major: 1,
        minor: 0,
        status: 'published',
        definitionHash: savedDraft.definitionHash,
        modelRef: { family: 'jev' },
        changelog: 'First release',
        publishedAt: expect.any(String),
        publishedBy: org.owner.id,
        deprecatedAt: null,
        createdAt: expect.any(String)
      },
      changes: [],
      warnings: []
    })
    expect(
      (
        await json(
          await api.get(`/api/templates/${template.id}`, {
            cookie: org.owner.cookie
          })
        )
      ).template
    ).toMatchObject({
      kind: 'classify',
      slugLocked: true,
      hasDraft: false,
      latestVersion: { id: v1.version.id, version: '1.0', status: 'published' }
    })

    // Right after a publish there is no draft to publish.
    const noDraft = await publish(org, template.id, {
      expectedDraftHash: savedDraft.definitionHash
    })
    expect(noDraft.status).toBe(409)
    expect((await json(noDraft)).error.code).toBe('NO_DRAFT')

    // The recreated draft equals 1.0.
    const unchanged = await publish(org, template.id, {
      expectedDraftHash: (await draftOf(org, template.id)).definitionHash
    })
    expect(unchanged.status).toBe(409)
    expect((await json(unchanged)).error).toMatchObject({
      code: 'NO_CHANGES',
      details: { version: '1.0' }
    })

    // A new label is breaking.
    const breakingDraft = await edit(org, template.id, withLabel('refund'))
    expect(breakingDraft.breaking).toBe(true)
    expect(breakingDraft.changes).toContainEqual(
      expect.objectContaining({ code: 'LABEL_ADDED', severity: 'breaking' })
    )
    const refused = await publish(org, template.id, {
      expectedDraftHash: breakingDraft.definitionHash
    })
    expect(refused.status).toBe(422)
    const refusedBody = await json(refused)
    expect(refusedBody.error.code).toBe('BREAKING_CHANGES')
    expect(refusedBody.error.details.changes).toEqual(
      breakingDraft.changes.filter(
        (change: { severity: string }) => change.severity === 'breaking'
      )
    )

    const second = await publish(org, template.id, {
      expectedDraftHash: breakingDraft.definitionHash,
      major: true
    })
    expect(second.status).toBe(201)
    const v2 = await json(second)
    expect(v2.version).toMatchObject({ version: '2.0', major: 2, minor: 0 })
    expect(v2.changes).toEqual(breakingDraft.changes)

    // A compatible change is the next minor.
    await edit(
      org,
      template.id,
      withDescription(withLabel('refund'), 'Documented')
    )
    const third = await publishDraft(org, template.id)
    expect(third.version).toMatchObject({
      version: '2.1',
      major: 2,
      minor: 1,
      changelog: null
    })

    const versions = await json(
      await api.get(`/api/templates/${template.id}/versions`, {
        cookie: org.owner.cookie
      })
    )
    expect(versions.data.map((v: { version: string }) => v.version)).toEqual([
      '2.1',
      '2.0',
      '1.0'
    ])
  })

  test('a minor change after 1.0 publishes 1.1', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    await publishDraft(org, template.id)
    await edit(org, template.id, withDescription(classifySupport, 'Better'))

    const { version, changes } = await publishDraft(org, template.id)

    expect(version).toMatchObject({ version: '1.1', major: 1, minor: 1 })
    expect(changes).toEqual([
      expect.objectContaining({ code: 'DESCRIPTION_CHANGED' })
    ])
  })

  test('behavior changes are allowed in a minor', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    await publishDraft(org, template.id)
    const definition = parse(classifySupport)
    await edit(org, template.id, {
      ...definition,
      model: { family: 'jev', version: '1.2.3' }
    })

    const { version, changes } = await publishDraft(org, template.id)

    expect(version).toMatchObject({
      version: '1.1',
      modelRef: { family: 'jev', version: '1.2.3' }
    })
    expect(changes).toEqual([
      expect.objectContaining({ code: 'MODEL_CHANGED', severity: 'behavior' })
    ])
  })

  test('major on the first publish is still 1.0', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const { version } = await publishDraft(org, template.id, { major: true })

    expect(version.version).toBe('1.0')
  })

  test('numbers after the highest version, not the most recent one', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [
        { major: 2, minor: 0 },
        { major: 1, minor: 3 }
      ]
    })
    await edit(org, template.id, withDescription(classifySupport, 'Next'))

    const { version } = await publishDraft(org, template.id)

    expect(version.version).toBe('2.1')
  })

  test('409 DRAFT_CONFLICT when the draft changed since the diff was shown', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)
    const edited = await edit(
      org,
      template.id,
      withDescription(classifySupport, 'Changed meanwhile')
    )

    const response = await publish(org, template.id, {
      expectedDraftHash: draft.definitionHash
    })

    expect(response.status).toBe(409)
    expect((await json(response)).error).toMatchObject({
      code: 'DRAFT_CONFLICT',
      details: { currentHash: edited.definitionHash }
    })
  })

  test('concurrent publishes of the same draft: one 201 and one 409', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)

    const responses = await Promise.all(
      [1, 2].map(() =>
        publish(org, template.id, { expectedDraftHash: draft.definitionHash })
      )
    )

    expect(responses.map(response => response.status).sort()).toEqual([
      201, 409
    ])
    const versions = await json(
      await api.get(`/api/templates/${template.id}/versions`, {
        cookie: org.owner.cookie
      })
    )
    expect(versions.data).toHaveLength(1)
  })

  test('a save and a publish of the same draft at once: one wins, the other conflicts (no deadlock)', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    let published = 0

    for (let round = 0; round < 8; round++) {
      // A draft that differs from the latest version, so it can be published.
      const draft = await edit(
        org,
        template.id,
        withDescription(classifySupport, `Round ${round}`)
      )

      const [saved, publishedNow] = await Promise.all([
        saveDraft(
          org,
          template.id,
          withDescription(classifySupport, `Round ${round}, edited`),
          draft.definitionHash
        ),
        publish(org, template.id, { expectedDraftHash: draft.definitionHash })
      ])

      const statuses = [saved.status, publishedNow.status]
      expect([
        [200, 409],
        [409, 201]
      ]).toContainEqual(statuses)
      const loser = saved.status === 409 ? saved : publishedNow
      expect((await json(loser)).error.code).toBe('DRAFT_CONFLICT')
      if (publishedNow.status === 201) published++
    }

    const versions = await json(
      await api.get(`/api/templates/${template.id}/versions`, {
        cookie: org.owner.cookie
      })
    )
    expect(versions.data).toHaveLength(published)
  })

  test('members cannot publish (403) but admins can', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const admin = await addMember(org, 'admin')
    const { template, draft } = await createFrom(org, classifySupport)

    const byMember = await publish(
      org,
      template.id,
      { expectedDraftHash: draft.definitionHash },
      member.cookie
    )
    expect(byMember.status).toBe(403)
    expect(await json(byMember)).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
        details: { required: { template: ['publish'] } }
      }
    })

    const byAdmin = await publish(
      org,
      template.id,
      { expectedDraftHash: draft.definitionHash },
      admin.cookie
    )
    expect(byAdmin.status).toBe(201)
    expect((await json(byAdmin)).version.publishedBy).toBe(admin.id)
  })

  test('validates the body', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)

    const response = await publish(org, template.id, {
      major: 'yes',
      changelog: 'x'.repeat(2_001)
    })

    expect(response.status).toBe(422)
    const paths = (await json(response)).error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(paths.sort()).toEqual(['changelog', 'expectedDraftHash', 'major'])
  })

  test("404 for another organization's template", async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { template, draft } = await createFrom(other, classifySupport)

    const response = await publish(org, template.id, {
      expectedDraftHash: draft.definitionHash
    })

    expect(response.status).toBe(404)
  })
})

// ── Versions ─────────────────────────────────────────────────────────────

describe('versions', () => {
  test('GET /versions/:versionId returns the definition and input schema', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const { version } = await publishDraft(org, template.id)

    const response = await api.get(
      `/api/templates/${template.id}/versions/${version.id}`,
      { cookie: org.owner.cookie }
    )

    expect(response.status).toBe(200)
    const definition = parse(classifySupport)
    expect(await json(response)).toEqual({
      version: {
        ...version,
        definition,
        inputJsonSchema: inputJsonSchema(definition.input.fields)
      }
    })
  })

  test('the list excludes the draft', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const { version } = await publishDraft(org, template.id)
    const draft = await edit(
      org,
      template.id,
      withDescription(classifySupport, 'Unreleased')
    )

    const list = await json(
      await api.get(`/api/templates/${template.id}/versions`, {
        cookie: org.owner.cookie
      })
    )
    expect(list.data).toEqual([version])

    const byDraftId = await api.get(
      `/api/templates/${template.id}/versions/${draft.id}`,
      { cookie: org.owner.cookie }
    )
    expect(byDraftId.status).toBe(404)
  })

  test('versions are scoped to their template and organization', async () => {
    const org = await createOrg()
    const other = await createOrg()
    const mine = await insertTemplate(org, { definition: classifySupport })
    const sibling = await insertTemplate(org, { definition: decideRefund })
    const theirs = await insertTemplate(other, { definition: classifySupport })

    const get = (templateId: string, versionId: string) =>
      api.get(`/api/templates/${templateId}/versions/${versionId}`, {
        cookie: org.owner.cookie
      })

    expect(
      (await get(mine.template.id, mine.versions[0]?.id ?? '')).status
    ).toBe(200)
    // Another template's version, even in the same organization.
    expect(
      (await get(mine.template.id, sibling.versions[0]?.id ?? '')).status
    ).toBe(404)
    // Another organization's.
    expect(
      (await get(theirs.template.id, theirs.versions[0]?.id ?? '')).status
    ).toBe(404)
    const list = await api.get(
      `/api/templates/${theirs.template.id}/versions`,
      {
        cookie: org.owner.cookie
      }
    )
    expect(list.status).toBe(404)
    expect(
      (
        await api.post(
          `/api/templates/${theirs.template.id}/versions/${theirs.versions[0]?.id}/deprecate`,
          { cookie: org.owner.cookie }
        )
      ).status
    ).toBe(404)
  })

  test('deprecate and undeprecate', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const { version } = await publishDraft(org, template.id)
    const path = `/api/templates/${template.id}/versions/${version.id}`

    const deprecated = await api.post(`${path}/deprecate`, {
      cookie: org.owner.cookie
    })
    expect(deprecated.status).toBe(200)
    const deprecatedView = (await json(deprecated)).version
    expect(deprecatedView).toMatchObject({
      id: version.id,
      status: 'deprecated'
    })
    expect(isIsoDate(deprecatedView.deprecatedAt)).toBe(true)
    expect(
      (
        await json(
          await api.get(`/api/templates/${template.id}`, {
            cookie: org.owner.cookie
          })
        )
      ).template.latestVersion.status
    ).toBe('deprecated')

    const again = await api.post(`${path}/deprecate`, {
      cookie: org.owner.cookie
    })
    expect(again.status).toBe(409)
    expect((await json(again)).error).toMatchObject({
      code: 'VERSION_NOT_PUBLISHED',
      details: { status: 'deprecated' }
    })

    const restored = await api.post(`${path}/undeprecate`, {
      cookie: org.owner.cookie
    })
    expect(restored.status).toBe(200)
    expect((await json(restored)).version).toMatchObject({
      status: 'published',
      deprecatedAt: null
    })

    const notDeprecated = await api.post(`${path}/undeprecate`, {
      cookie: org.owner.cookie
    })
    expect(notDeprecated.status).toBe(409)
    expect((await json(notDeprecated)).error.code).toBe(
      'VERSION_NOT_DEPRECATED'
    )
  })

  test('only published versions can be deprecated', async () => {
    const org = await createOrg()
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [{ major: 1, minor: 0, status: 'model_unavailable' }]
    })

    const response = await api.post(
      `/api/templates/${template.id}/versions/${versions[0]?.id}/deprecate`,
      { cookie: org.owner.cookie }
    )

    expect(response.status).toBe(409)
    expect((await json(response)).error.code).toBe('VERSION_NOT_PUBLISHED')
  })

  test('members cannot deprecate; unknown versions are 404', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport
    })

    const byMember = await api.post(
      `/api/templates/${template.id}/versions/${versions[0]?.id}/deprecate`,
      { cookie: member.cookie }
    )
    expect(byMember.status).toBe(403)

    const unknown = await api.post(
      `/api/templates/${template.id}/versions/nope/undeprecate`,
      { cookie: org.owner.cookie }
    )
    expect(unknown.status).toBe(404)
    expect((await json(unknown)).error.code).toBe('NOT_FOUND')
  })

  test('members can read templates, drafts and versions', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport
    })

    for (const path of [
      '/api/templates',
      `/api/templates/${template.id}`,
      `/api/templates/${template.id}/draft`,
      `/api/templates/${template.id}/versions`,
      `/api/templates/${template.id}/versions/${versions[0]?.id}`
    ]) {
      expect((await api.get(path, { cookie: member.cookie })).status).toBe(200)
    }
  })
})

// ── NUL characters ───────────────────────────────────────────────────────

describe('NUL characters (Postgres text and jsonb cannot store them)', () => {
  const NUL = '\u0000'

  /** The issues of a 422 `VALIDATION_FAILED`. */
  async function issuesOf(response: Response) {
    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('VALIDATION_FAILED')
    return error.details.issues as { path: string; message: string }[]
  }

  const nulIssue = (path: string) => ({
    path,
    message: 'Must not contain NUL characters',
    code: 'custom'
  })

  test('are a 422 at their path when creating a template', async () => {
    const org = await createOrg()
    const create = (body: Record<string, unknown>) =>
      api.post('/api/templates', {
        cookie: org.owner.cookie,
        body: { name: 'Tickets', ...body }
      })
    const blank = { type: 'blank', kind: 'classify' }

    expect(
      await issuesOf(await create({ name: `a${NUL}b`, source: blank }))
    ).toEqual([nulIssue('name')])
    expect(
      await issuesOf(await create({ description: `x${NUL}`, source: blank }))
    ).toEqual([nulIssue('description')])
    expect(
      await issuesOf(
        await create({
          source: {
            type: 'classify',
            instructions: 'What is `text` about?',
            labels: [
              { label: 'bug', description: `Broken${NUL}` },
              { label: 'billing' }
            ]
          }
        })
      )
    ).toEqual([nulIssue('source.labels.0.description')])
    expect(
      await issuesOf(
        await create({
          source: {
            type: 'score',
            instructions: 'How urgent?',
            levels: [
              { label: 'low', description: `Fine${NUL}` },
              { label: 'high' }
            ]
          }
        })
      )
    ).toEqual([nulIssue('source.levels.0.description')])
    expect(
      await issuesOf(
        await create({
          source: {
            type: 'definition',
            definition: withDescription(classifySupport, `x${NUL}`)
          }
        })
      )
    ).toEqual([nulIssue('source.definition.decisions.0.description')])

    const listed = await json(
      await api.get('/api/templates', { cookie: org.owner.cookie })
    )
    expect(listed.data).toEqual([])
  })

  test('are a 422 when editing a template, its draft or publishing', async () => {
    const org = await createOrg()
    const { template, draft } = await createFrom(org, classifySupport)

    expect(
      await issuesOf(
        await patch(`/api/templates/${template.id}`, {
          cookie: org.owner.cookie,
          body: { name: `a${NUL}` }
        })
      )
    ).toEqual([nulIssue('name')])

    expect(
      await issuesOf(
        await saveDraft(
          org,
          template.id,
          withDescription(classifySupport, `bad ${NUL} description`),
          draft.definitionHash
        )
      )
    ).toEqual([nulIssue('definition.decisions.0.description')])

    // In an object key too (jsonb rejects those as well).
    const [keyIssue] = await issuesOf(
      await saveDraft(
        org,
        template.id,
        { ...parse(classifySupport), state: { context: { [`k${NUL}`]: 1 } } },
        draft.definitionHash
      )
    )
    expect(keyIssue).toEqual(nulIssue(`definition.state.context.k${NUL}`))

    expect(
      await issuesOf(
        await publish(org, template.id, {
          expectedDraftHash: draft.definitionHash,
          changelog: `a${NUL}`
        })
      )
    ).toEqual([nulIssue('changelog')])

    // Nothing was saved or published.
    expect(await draftOf(org, template.id)).toEqual(draft)
  })

  test('ids holding one are a 404', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    const cookie = org.owner.cookie
    const bad = 'a%00b'

    const responses = await Promise.all([
      api.get(`/api/templates/${bad}`, { cookie }),
      patch(`/api/templates/${bad}`, { cookie, body: { name: 'X' } }),
      api.post(`/api/templates/${bad}/archive`, { cookie }),
      api.get(`/api/templates/${bad}/draft`, { cookie }),
      saveDraft(org, bad, classifySupport, 'hash'),
      publish(org, bad, { expectedDraftHash: 'hash' }),
      api.get(`/api/templates/${bad}/versions`, { cookie }),
      api.get(`/api/templates/${template.id}/versions/${bad}`, { cookie }),
      api.post(`/api/templates/${template.id}/versions/${bad}/deprecate`, {
        cookie
      })
    ])

    for (const response of responses) {
      expect(response.status).toBe(404)
      expect((await json(response)).error.code).toBe('NOT_FOUND')
    }
  })
})
