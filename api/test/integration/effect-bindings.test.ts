import { beforeEach, describe, expect, test } from 'bun:test'
import { getFakeEvaluator } from '#modules/engine/evaluator'
import {
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import { classifySupport } from '../fixtures/definitions'
import { json, type RequestOptions, testApi } from '../helpers/app'
import { insertWebhookEndpoint } from '../helpers/effects'
import { addMember, createOrg, type TestOrg } from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

/**
 * `/api/templates/:id/effects`: effect binding CRUD (webhook/email/slack
 * config validation), its `UNBOUND_LABEL`/`ORPHAN_BINDING` warnings, and
 * `effectWarnings` on publishing a new major (`BINDING_OLD_MAJOR` plus the
 * same two, checked against the new version).
 */

const api = testApi()
const fake = getFakeEvaluator()
beforeEach(() => fake.reset())

const patch = (path: string, options?: RequestOptions) =>
  api.request('PATCH', path, options)
const put = (path: string, options?: RequestOptions) =>
  api.request('PUT', path, options)

const parse = (definition: TemplateDefinitionInput) =>
  templateDefinitionSchema.parse(definition)

// ── Binding request helpers ─────────────────────────────────────────────

const listBindings = (
  org: TestOrg,
  templateId: string,
  cookie = org.owner.cookie
) => api.get(`/api/templates/${templateId}/effects`, { cookie })

const createBinding = (
  org: TestOrg,
  templateId: string,
  body: Record<string, unknown>,
  cookie = org.owner.cookie
) => api.post(`/api/templates/${templateId}/effects`, { cookie, body })

const updateBinding = (
  org: TestOrg,
  templateId: string,
  bindingId: string,
  body: Record<string, unknown>,
  cookie = org.owner.cookie
) =>
  patch(`/api/templates/${templateId}/effects/${bindingId}`, { cookie, body })

const deleteBinding = (
  org: TestOrg,
  templateId: string,
  bindingId: string,
  cookie = org.owner.cookie
) => api.delete(`/api/templates/${templateId}/effects/${bindingId}`, { cookie })

// ── Real create/draft/publish flow (only the "publish" describe block needs it) ──

async function createFrom(org: TestOrg, definition: TemplateDefinitionInput) {
  const response = await api.post('/api/templates', {
    cookie: org.owner.cookie,
    body: { name: 'Support triage', source: { type: 'definition', definition } }
  })
  expect(response.status).toBe(201)
  return json(response)
}

const draftOf = async (org: TestOrg, id: string) => {
  const response = await api.get(`/api/templates/${id}/draft`, {
    cookie: org.owner.cookie
  })
  expect(response.status).toBe(200)
  return json(response)
}

const saveDraft = (
  org: TestOrg,
  id: string,
  definition: unknown,
  ifMatch: string
) =>
  put(`/api/templates/${id}/draft`, {
    cookie: org.owner.cookie,
    body: { definition },
    headers: { 'if-match': ifMatch }
  })

async function publishDraft(
  org: TestOrg,
  id: string,
  options: { major?: boolean } = {}
) {
  const draft = await draftOf(org, id)
  const response = await api.post(`/api/templates/${id}/publish`, {
    cookie: org.owner.cookie,
    body: { expectedDraftHash: draft.definitionHash, ...options }
  })
  expect(response.status).toBe(201)
  return json(response)
}

/** `classifySupport` with `billing` replaced by `refund` (both breaking). */
const withRefundInsteadOfBilling = (
  definition: TemplateDefinitionInput
): TemplateDefinitionInput => {
  const parsed = parse(definition)
  const category = parsed.questions.category
  if (category?.type !== 'choice') throw new Error('classifySupport changed')
  const { billing: _billing, ...restCriteria } = category.criteria
  return {
    ...parsed,
    decisions: [
      ...parsed.decisions.filter(decision => decision.label !== 'billing'),
      { label: 'refund', minConfidence: 0.8 }
    ],
    questions: {
      category: { ...category, criteria: { ...restCriteria, refund: null } }
    }
  }
}

// ── GET /api/templates/:id/effects ──────────────────────────────────────

describe('GET /api/templates/:id/effects', () => {
  test('empty, with no warnings, before any version is published', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport,
      versions: []
    })
    const response = await listBindings(org, template.id)
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ data: [], warnings: [] })
  })

  test('UNBOUND_LABEL for every label of the latest version with no binding', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const { warnings } = await json(await listBindings(org, template.id))
    expect(warnings).toEqual(
      expect.arrayContaining([
        { code: 'UNBOUND_LABEL', label: 'bug' },
        { code: 'UNBOUND_LABEL', label: 'billing' },
        { code: 'UNBOUND_LABEL', label: 'other' }
      ])
    )
  })

  test('a "*" binding covers every label; a disabled one covers none', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    await createBinding(org, template.id, {
      on: '*',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    const { warnings } = await json(await listBindings(org, template.id))
    expect(
      warnings.filter((w: { code: string }) => w.code === 'UNBOUND_LABEL')
    ).toEqual([])

    // Disabling it un-covers every label again.
    const created = await json(await listBindings(org, template.id))
    await updateBinding(org, template.id, created.data[0].id, {
      enabled: false
    })
    const after = await json(await listBindings(org, template.id))
    expect(
      after.warnings.filter((w: { code: string }) => w.code === 'UNBOUND_LABEL')
    ).toHaveLength(3)
  })

  test('ORPHAN_BINDING for a binding whose on label does not exist', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const created = await createBinding(org, template.id, {
      on: 'refund',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    const { binding } = await json(created)

    const { warnings } = await json(await listBindings(org, template.id))
    expect(warnings).toContainEqual({
      code: 'ORPHAN_BINDING',
      bindingId: binding.id,
      label: 'refund'
    })
  })

  test('needs_review is never an orphan or unbound label', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    await createBinding(org, template.id, {
      on: 'needs_review',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    const { warnings } = await json(await listBindings(org, template.id))
    expect(
      warnings.some((w: { code: string }) => w.code === 'ORPHAN_BINDING')
    ).toBe(false)
  })

  test('a binding pinned to another major does not cover the latest one', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [
        { major: 2, minor: 0 },
        { major: 1, minor: 0 }
      ]
    })
    await createBinding(org, template.id, {
      on: 'bug',
      major: 1,
      type: 'email',
      config: { to: [org.owner.email] }
    })
    const { warnings } = await json(await listBindings(org, template.id))
    expect(warnings).toContainEqual({ code: 'UNBOUND_LABEL', label: 'bug' })
  })

  test('404 for an unknown template, and for another organization’s', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { template } = await insertTemplate(orgA, {
      definition: classifySupport
    })

    expect((await listBindings(orgA, 'does-not-exist')).status).toBe(404)
    expect((await listBindings(orgB, template.id)).status).toBe(404)
  })

  test('401 without a session', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const response = await api.get(`/api/templates/${template.id}/effects`)
    expect(response.status).toBe(401)
  })
})

// ── POST /api/templates/:id/effects ─────────────────────────────────────

describe('POST /api/templates/:id/effects', () => {
  test('a webhook binding', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const { endpoint } = await insertWebhookEndpoint(org, {
      url: 'https://example.test/hook'
    })

    const response = await createBinding(org, template.id, {
      on: 'bug',
      type: 'webhook',
      config: { endpointId: endpoint.id }
    })
    expect(response.status).toBe(201)
    const { binding } = await json(response)
    expect(binding).toMatchObject({
      templateId: template.id,
      on: 'bug',
      major: null,
      type: 'webhook',
      config: { endpointId: endpoint.id },
      includeInput: false,
      enabled: true,
      position: 0
    })
  })

  test('404 when endpointId is not in this organization', async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const { endpoint } = await insertWebhookEndpoint(other, {
      url: 'https://example.test/hook'
    })

    const response = await createBinding(org, template.id, {
      on: 'bug',
      type: 'webhook',
      config: { endpointId: endpoint.id }
    })
    expect(response.status).toBe(404)
  })

  test('an email binding to a verified member email', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const response = await createBinding(org, template.id, {
      on: 'billing',
      type: 'email',
      config: { to: [org.owner.email] },
      includeInput: true
    })
    expect(response.status).toBe(201)
    const { binding } = await json(response)
    expect(binding.config).toEqual({ to: [org.owner.email] })
    expect(binding.includeInput).toBe(true)
  })

  test('422 INVALID_RECIPIENTS for a non-member email', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const response = await createBinding(org, template.id, {
      on: 'billing',
      type: 'email',
      config: { to: ['not-a-member@example.com'] }
    })
    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error).toMatchObject({
      code: 'INVALID_RECIPIENTS',
      details: { invalid: ['not-a-member@example.com'] }
    })
  })

  test('a slack binding: the URL is never echoed back, only a hint', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const webhookUrl =
      'https://hooks.slack.com/services/T000/B000/abcd1234abcd1234'

    const response = await createBinding(org, template.id, {
      on: '*',
      type: 'slack',
      config: { webhookUrl, channel: '#alerts' }
    })
    expect(response.status).toBe(201)
    const { binding } = await json(response)
    expect(binding.config).toEqual({
      webhookUrlHint: 'https://hooks.slack.com/…/1234',
      channel: '#alerts'
    })
    expect(JSON.stringify(binding)).not.toContain('abcd1234abcd1234')
  })

  test('422 INVALID_SLACK_URL without the hooks.slack.com prefix', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const response = await createBinding(org, template.id, {
      on: '*',
      type: 'slack',
      config: { webhookUrl: 'https://evil.example.com/webhook' }
    })
    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('INVALID_SLACK_URL')
  })

  test('position auto-increments across bindings of the same template', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const first = await json(
      await createBinding(org, template.id, {
        on: 'bug',
        type: 'email',
        config: { to: [org.owner.email] }
      })
    )
    const second = await json(
      await createBinding(org, template.id, {
        on: 'billing',
        type: 'email',
        config: { to: [org.owner.email] }
      })
    )
    expect(first.binding.position).toBe(0)
    expect(second.binding.position).toBe(1)
  })

  test('rejects an invalid on value', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const response = await createBinding(org, template.id, {
      on: 'Not Valid!',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    expect(response.status).toBe(422)
  })

  test('rejects a non-positive major', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const response = await createBinding(org, template.id, {
      on: 'bug',
      major: 0,
      type: 'email',
      config: { to: [org.owner.email] }
    })
    expect(response.status).toBe(422)
  })

  test('404 for an unknown template', async () => {
    const org = await createOrg()
    const response = await createBinding(org, 'does-not-exist', {
      on: 'bug',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    expect(response.status).toBe(404)
  })

  test('401 without a session', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const response = await api.post(`/api/templates/${template.id}/effects`, {
      body: { on: 'bug', type: 'email', config: { to: [org.owner.email] } }
    })
    expect(response.status).toBe(401)
  })
})

// ── PATCH / DELETE ───────────────────────────────────────────────────────

describe('PATCH /api/templates/:id/effects/:bindingId', () => {
  async function bound(org: TestOrg, templateId: string) {
    const created = await createBinding(org, templateId, {
      on: 'bug',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    return (await json(created)).binding
  }

  test('updates on/major/enabled/includeInput', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const binding = await bound(org, template.id)

    const response = await updateBinding(org, template.id, binding.id, {
      on: '*',
      major: 3,
      enabled: false,
      includeInput: true
    })
    expect(response.status).toBe(200)
    expect((await json(response)).binding).toMatchObject({
      on: '*',
      major: 3,
      enabled: false,
      includeInput: true
    })
  })

  test('major: null clears a pin', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const created = await createBinding(org, template.id, {
      on: 'bug',
      major: 1,
      type: 'email',
      config: { to: [org.owner.email] }
    })
    const { binding } = await json(created)

    const response = await updateBinding(org, template.id, binding.id, {
      major: null
    })
    expect((await json(response)).binding.major).toBeNull()
  })

  test('config is re-validated the same way as on create', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const binding = await bound(org, template.id)

    const response = await updateBinding(org, template.id, binding.id, {
      config: { to: ['not-a-member@example.com'] }
    })
    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('INVALID_RECIPIENTS')
  })

  test('404 for an unknown binding', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const response = await updateBinding(org, template.id, 'does-not-exist', {
      enabled: false
    })
    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/templates/:id/effects/:bindingId', () => {
  test('deletes it; a second delete 404s', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const created = await createBinding(org, template.id, {
      on: 'bug',
      type: 'email',
      config: { to: [org.owner.email] }
    })
    const { binding } = await json(created)

    const first = await deleteBinding(org, template.id, binding.id)
    expect(first.status).toBe(204)
    const second = await deleteBinding(org, template.id, binding.id)
    expect(second.status).toBe(404)

    const { data } = await json(await listBindings(org, template.id))
    expect(data).toEqual([])
  })
})

// ── Permissions (template:update; every role has it — 401/404 are the reachable checks) ──

describe('permissions and org scoping', () => {
  test('members can manage effect bindings too (template:update)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const response = await createBinding(
      org,
      template.id,
      { on: 'bug', type: 'email', config: { to: [org.owner.email] } },
      member.cookie
    )
    expect(response.status).toBe(201)
  })
})

// ── Publish: effectWarnings ──────────────────────────────────────────────

describe('POST /api/templates/:id/publish effectWarnings', () => {
  test('absent on a first (non-major) publish', async () => {
    const org = await createOrg()
    const created = await createFrom(org, classifySupport)
    const { template } = created

    const published = await publishDraft(org, template.id)
    expect('effectWarnings' in published).toBe(false)
  })

  test('BINDING_OLD_MAJOR, UNBOUND_LABEL and ORPHAN_BINDING on a new major', async () => {
    const org = await createOrg()
    const { template } = await createFrom(org, classifySupport)
    await publishDraft(org, template.id) // 1.0

    // bug and other: still labels of the new major, so these stay valid and
    // keep covering them — no warning either way.
    const bugBinding = await json(
      await createBinding(org, template.id, {
        on: 'bug',
        type: 'email',
        config: { to: [org.owner.email] }
      })
    )
    const otherBinding = await json(
      await createBinding(org, template.id, {
        on: 'other',
        type: 'email',
        config: { to: [org.owner.email] }
      })
    )
    // Pinned to the major the publish is about to supersede.
    const pinnedToOldMajor = await json(
      await createBinding(org, template.id, {
        on: 'bug',
        major: 1,
        type: 'email',
        config: { to: [org.owner.email] }
      })
    )
    // Matches every major, but the new major drops the `billing` label.
    const orphanedByRemoval = await json(
      await createBinding(org, template.id, {
        on: 'billing',
        type: 'email',
        config: { to: [org.owner.email] }
      })
    )

    // `billing` -> `refund`: both breaking (LABEL_REMOVED + LABEL_ADDED).
    const draft = await draftOf(org, template.id)
    const withRefund = withRefundInsteadOfBilling(parse(classifySupport))
    const saved = await saveDraft(
      org,
      template.id,
      withRefund,
      draft.definitionHash
    )
    expect(saved.status).toBe(200)
    const savedDraft = await json(saved)
    expect(savedDraft.breaking).toBe(true)

    const publishResponse = await api.post(
      `/api/templates/${template.id}/publish`,
      {
        cookie: org.owner.cookie,
        body: { expectedDraftHash: savedDraft.definitionHash, major: true }
      }
    )
    expect(publishResponse.status).toBe(201)
    const published = await json(publishResponse)
    expect(published.version).toMatchObject({ version: '2.0', major: 2 })

    expect(published.effectWarnings).toHaveLength(3)
    expect(published.effectWarnings).toEqual(
      expect.arrayContaining([
        { code: 'UNBOUND_LABEL', label: 'refund' },
        {
          code: 'ORPHAN_BINDING',
          bindingId: orphanedByRemoval.binding.id,
          label: 'billing'
        },
        { code: 'BINDING_OLD_MAJOR', bindingId: pinnedToOldMajor.binding.id }
      ])
    )
    // bug's and other's bindings (still-existing labels) trigger nothing.
    const untouchedIds = [bugBinding.binding.id, otherBinding.binding.id]
    expect(
      published.effectWarnings.some((w: { bindingId?: string }) =>
        untouchedIds.includes(w.bindingId)
      )
    ).toBe(false)
  })
})
