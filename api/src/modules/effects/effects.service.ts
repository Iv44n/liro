import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lt,
  ne,
  type SQL
} from 'drizzle-orm'
import z from 'zod'
import { members, users } from '#modules/auth/auth.schemas'
import { decisionRuns } from '#modules/runs/runs.schemas'
import {
  decisionLabels,
  labelSchema,
  NEEDS_REVIEW
} from '#modules/templates/definition'
import {
  decisionTemplates,
  decisionTemplateVersions
} from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'
import { decryptSecret, encryptSecret } from '#shared/core/crypto'
import { db } from '#shared/db/config'
import { ApiError, parseOrThrow } from '#shared/http/errors'
import {
  type EffectBindingConfig,
  type EffectType,
  EXECUTION_STATUSES,
  effectBindings,
  effectExecutions,
  webhookEndpoints
} from './effects.schemas'
import {
  type EffectBindingRow,
  type EffectBindingView,
  type EffectExecutionView,
  type EffectWarning,
  effectBindingView,
  effectExecutionView,
  type WebhookEndpointView,
  webhookEndpointView
} from './effects.views'
import {
  assertSafeUrl,
  assertSlackWebhookUrl,
  OutboundError,
  safeFetch
} from './outbound'
import { generateWebhookSecret, webhookHeaders } from './signing'

/**
 * Webhook endpoints, effect bindings and effect executions for the
 * dashboard (`/api/webhooks`, `/api/templates/:id/effects`,
 * `/api/runs/:id/effects`, `/api/effect-executions`). Every query is scoped
 * to one organization.
 */

export interface Caller {
  organizationId: string
  userId: string
}

const NUL_MESSAGE = 'Must not contain NUL characters'
const noNul = (value: string) => !value.includes('\u0000')
/** Postgres `text` can't hold NUL: such an id simply names no row. */
const isQueryableId = (id: string) => !id.includes('\u0000')

const PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000

// ── Errors ───────────────────────────────────────────────────────────────

const endpointNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Webhook endpoint not found')
const templateNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Template not found')
const bindingNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Effect binding not found')
const runNotFound = () => new ApiError(404, 'NOT_FOUND', 'Run not found')
const executionNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Effect execution not found')

/** `assertSafeUrl`'s `OutboundError` in the public error format. */
async function assertSafeWebhookUrl(url: string): Promise<void> {
  try {
    await assertSafeUrl(url)
  } catch (error) {
    if (error instanceof OutboundError) {
      throw new ApiError(422, 'UNSAFE_URL', error.message)
    }
    throw error
  }
}

/** `assertSlackWebhookUrl`'s `OutboundError` in the public error format. */
function assertValidSlackUrl(url: string): void {
  try {
    assertSlackWebhookUrl(url)
  } catch (error) {
    if (error instanceof OutboundError) {
      throw new ApiError(422, 'INVALID_SLACK_URL', error.message)
    }
    throw error
  }
}

// ── Webhook endpoints ────────────────────────────────────────────────────

export const createWebhookEndpointSchema = z.object({
  name: z.string().trim().min(1).max(200).refine(noNul, NUL_MESSAGE),
  url: z.url().refine(noNul, NUL_MESSAGE),
  description: z
    .string()
    .trim()
    .max(2000)
    .refine(noNul, NUL_MESSAGE)
    .nullish()
    .transform(value => value || null)
})
export type CreateWebhookEndpointInput = z.output<
  typeof createWebhookEndpointSchema
>

export const updateWebhookEndpointSchema = z.object({
  name: z.string().trim().min(1).max(200).refine(noNul, NUL_MESSAGE).optional(),
  url: z.url().refine(noNul, NUL_MESSAGE).optional(),
  description: z
    .string()
    .trim()
    .max(2000)
    .refine(noNul, NUL_MESSAGE)
    .nullable()
    .optional(),
  enabled: z.boolean().optional()
})
export type UpdateWebhookEndpointInput = z.output<
  typeof updateWebhookEndpointSchema
>

export const listDeliveriesQuerySchema = z.object({
  status: z.enum(EXECUTION_STATUSES).optional(),
  cursor: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})
export type ListDeliveriesQuery = z.output<typeof listDeliveriesQuerySchema>

async function requireWebhookEndpoint(
  organizationId: string,
  id: string
): Promise<typeof webhookEndpoints.$inferSelect> {
  if (!isQueryableId(id)) throw endpointNotFound()
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw endpointNotFound()
  return row
}

/** Every webhook endpoint of the organization, alphabetically. */
export async function listWebhookEndpoints(
  organizationId: string
): Promise<WebhookEndpointView[]> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, organizationId))
    .orderBy(asc(webhookEndpoints.name))
  return rows.map(webhookEndpointView)
}

export async function getWebhookEndpointView(
  organizationId: string,
  id: string
): Promise<WebhookEndpointView> {
  return webhookEndpointView(await requireWebhookEndpoint(organizationId, id))
}

/** Creates an endpoint with a fresh signing secret, shown only in this response. */
export async function createWebhookEndpoint(
  caller: Caller,
  body: CreateWebhookEndpointInput
): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
  await assertSafeWebhookUrl(body.url)

  const secret = generateWebhookSecret()
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      id: Id.generate(),
      organizationId: caller.organizationId,
      name: body.name,
      description: body.description,
      url: body.url,
      secretEncrypted: encryptSecret(secret),
      createdBy: caller.userId
    })
    .returning()
  if (!row) throw new Error('createWebhookEndpoint: no row returned')
  return { endpoint: webhookEndpointView(row), secret }
}

/** Re-validates a changed `url`; setting `enabled: true` resets `failureCount` and clears `disabledReason`. */
export async function updateWebhookEndpoint(
  organizationId: string,
  id: string,
  body: UpdateWebhookEndpointInput
): Promise<WebhookEndpointView> {
  await requireWebhookEndpoint(organizationId, id)
  if (body.url !== undefined) await assertSafeWebhookUrl(body.url)

  const resettingFailures = body.enabled === true
  const [row] = await db
    .update(webhookEndpoints)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(resettingFailures ? { failureCount: 0, disabledReason: null } : {}),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.organizationId, organizationId)
      )
    )
    .returning()
  if (!row) throw endpointNotFound()
  return webhookEndpointView(row)
}

/** 409 `ENDPOINT_IN_USE` (with the referencing templates) if any effect binding still points at it. */
export async function deleteWebhookEndpoint(
  organizationId: string,
  id: string
): Promise<void> {
  await requireWebhookEndpoint(organizationId, id)

  const webhookBindings = await db
    .select({
      templateId: effectBindings.templateId,
      config: effectBindings.config
    })
    .from(effectBindings)
    .where(
      and(
        eq(effectBindings.organizationId, organizationId),
        eq(effectBindings.type, 'webhook')
      )
    )
  const referencingTemplateIds = [
    ...new Set(
      webhookBindings
        .filter(
          binding =>
            (binding.config as { endpointId: string }).endpointId === id
        )
        .map(binding => binding.templateId)
    )
  ]

  if (referencingTemplateIds.length > 0) {
    const templates = await db
      .select({ id: decisionTemplates.id, name: decisionTemplates.name })
      .from(decisionTemplates)
      .where(
        and(
          eq(decisionTemplates.organizationId, organizationId),
          inArray(decisionTemplates.id, referencingTemplateIds)
        )
      )
    throw new ApiError(
      409,
      'ENDPOINT_IN_USE',
      'This endpoint is used by one or more effect bindings; remove them first',
      { details: { templates } }
    )
  }

  await db
    .delete(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.organizationId, organizationId)
      )
    )
}

export async function getWebhookSecret(
  organizationId: string,
  id: string
): Promise<{ secret: string }> {
  const endpoint = await requireWebhookEndpoint(organizationId, id)
  return { secret: decryptSecret(endpoint.secretEncrypted) }
}

/** Moves the current secret to `previous` (valid 24h more) and issues a fresh current one. */
export async function rotateWebhookSecret(
  organizationId: string,
  id: string
): Promise<{ secret: string }> {
  const endpoint = await requireWebhookEndpoint(organizationId, id)
  const secret = generateWebhookSecret()
  const now = new Date()

  await db
    .update(webhookEndpoints)
    .set({
      previousSecretEncrypted: endpoint.secretEncrypted,
      previousSecretExpiresAt: new Date(now.getTime() + PREVIOUS_SECRET_TTL_MS),
      secretEncrypted: encryptSecret(secret),
      updatedAt: now
    })
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.organizationId, organizationId)
      )
    )
  return { secret }
}

export interface WebhookTestResult {
  ok: boolean
  status?: number
  durationMs?: number
  error?: string
}

/** Sends a signed `webhook.test` event right now (never queued, never retried). */
export async function testWebhookEndpoint(
  organizationId: string,
  id: string,
  now: Date = new Date()
): Promise<WebhookTestResult> {
  const endpoint = await requireWebhookEndpoint(organizationId, id)

  const secrets = [decryptSecret(endpoint.secretEncrypted)]
  if (
    endpoint.previousSecretEncrypted &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt.getTime() > now.getTime()
  ) {
    secrets.push(decryptSecret(endpoint.previousSecretEncrypted))
  }

  const body = JSON.stringify({
    type: 'webhook.test',
    timestamp: now.toISOString(),
    data: { message: 'This is a test event from Liro.' }
  })
  const timestamp = Math.floor(now.getTime() / 1000)
  const headers = {
    ...webhookHeaders({ id: Id.generate(), timestamp, body, secrets }),
    'content-type': 'application/json',
    'user-agent': 'Liro-Webhooks/1'
  }

  try {
    const result = await safeFetch(endpoint.url, {
      method: 'POST',
      headers,
      body
    })
    const ok = result.status >= 200 && result.status < 300
    return { ok, status: result.status, durationMs: result.durationMs }
  } catch (error) {
    if (error instanceof OutboundError)
      return { ok: false, error: error.message }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Deliveries (`effect_executions`) of one endpoint, newest first. */
export async function listWebhookDeliveries(
  organizationId: string,
  endpointId: string,
  query: ListDeliveriesQuery
): Promise<{ data: EffectExecutionView[]; nextCursor: string | null }> {
  await requireWebhookEndpoint(organizationId, endpointId)

  const conditions: SQL[] = [
    eq(effectExecutions.organizationId, organizationId),
    eq(effectExecutions.endpointId, endpointId)
  ]
  if (query.status) conditions.push(eq(effectExecutions.status, query.status))
  if (query.cursor) conditions.push(lt(effectExecutions.id, query.cursor))

  const rows = await db
    .select()
    .from(effectExecutions)
    .where(and(...conditions))
    .orderBy(desc(effectExecutions.id))
    .limit(query.limit + 1)

  const page = rows.slice(0, query.limit)
  return {
    data: page.map(effectExecutionView),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null
  }
}

// ── Effect bindings ──────────────────────────────────────────────────────

const onSchema = z.union([z.literal('*'), z.literal(NEEDS_REVIEW), labelSchema])
const majorSchema = z.number().int().min(1).nullable().optional()

const webhookConfigInput = z.object({
  endpointId: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE)
})
const emailConfigInput = z.object({ to: z.array(z.email()).min(1).max(20) })
const slackConfigInput = z.object({
  webhookUrl: z.url().refine(noNul, NUL_MESSAGE),
  channel: z.string().trim().min(1).max(100).optional()
})

const bindingCommon = {
  on: onSchema,
  major: majorSchema,
  includeInput: z.boolean().optional(),
  enabled: z.boolean().optional()
}

export const createEffectBindingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('webhook'),
    config: webhookConfigInput,
    ...bindingCommon
  }),
  z.object({
    type: z.literal('email'),
    config: emailConfigInput,
    ...bindingCommon
  }),
  z.object({
    type: z.literal('slack'),
    config: slackConfigInput,
    ...bindingCommon
  })
])
export type CreateEffectBindingInput = z.output<
  typeof createEffectBindingSchema
>

export const updateEffectBindingSchema = z.object({
  on: onSchema.optional(),
  major: majorSchema,
  config: z.record(z.string(), z.unknown()).optional(),
  includeInput: z.boolean().optional(),
  enabled: z.boolean().optional()
})
export type UpdateEffectBindingInput = z.output<
  typeof updateEffectBindingSchema
>

async function requireTemplate(
  organizationId: string,
  templateId: string
): Promise<void> {
  if (!isQueryableId(templateId)) throw templateNotFound()
  const [row] = await db
    .select({ id: decisionTemplates.id })
    .from(decisionTemplates)
    .where(
      and(
        eq(decisionTemplates.id, templateId),
        eq(decisionTemplates.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw templateNotFound()
}

async function requireEffectBinding(
  organizationId: string,
  templateId: string,
  bindingId: string
): Promise<EffectBindingRow> {
  if (!isQueryableId(bindingId)) throw bindingNotFound()
  const [row] = await db
    .select()
    .from(effectBindings)
    .where(
      and(
        eq(effectBindings.id, bindingId),
        eq(effectBindings.organizationId, organizationId),
        eq(effectBindings.templateId, templateId)
      )
    )
    .limit(1)
  if (!row) throw bindingNotFound()
  return row
}

/** The addresses of `candidates` that are verified emails of a current member of `organizationId`. */
async function currentVerifiedMemberEmails(
  organizationId: string,
  candidates: string[]
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set()
  const rows = await db
    .select({ email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(users.emailVerified, true),
        inArray(users.email, candidates)
      )
    )
  return new Set(rows.map(row => row.email))
}

/** Validates and shapes a binding's `config` for storage, by `type`. */
async function resolveConfig(
  organizationId: string,
  type: EffectType,
  rawConfig: unknown
): Promise<EffectBindingConfig> {
  switch (type) {
    case 'webhook': {
      const { endpointId } = parseOrThrow(webhookConfigInput, rawConfig)
      await requireWebhookEndpoint(organizationId, endpointId)
      return { endpointId }
    }
    case 'email': {
      const { to } = parseOrThrow(emailConfigInput, rawConfig)
      const verified = await currentVerifiedMemberEmails(organizationId, to)
      const invalid = to.filter(email => !verified.has(email))
      if (invalid.length > 0) {
        throw new ApiError(
          422,
          'INVALID_RECIPIENTS',
          'Every recipient must be a verified email of a current member of the organization',
          { details: { invalid } }
        )
      }
      return { to }
    }
    case 'slack': {
      const { webhookUrl, channel } = parseOrThrow(slackConfigInput, rawConfig)
      assertValidSlackUrl(webhookUrl)
      return {
        webhookUrlEncrypted: encryptSecret(webhookUrl),
        ...(channel ? { channel } : {})
      }
    }
  }
}

async function nextPosition(
  organizationId: string,
  templateId: string
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(effectBindings)
    .where(
      and(
        eq(effectBindings.organizationId, organizationId),
        eq(effectBindings.templateId, templateId)
      )
    )
  return row?.count ?? 0
}

/** The version (whatever its status) an org's template's effects are checked against: the highest-numbered non-draft one. */
async function latestReleasedVersion(
  organizationId: string,
  templateId: string
): Promise<{ major: number; labels: string[] } | null> {
  const [row] = await db
    .select({
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor,
      definition: decisionTemplateVersions.definition
    })
    .from(decisionTemplateVersions)
    .where(
      and(
        eq(decisionTemplateVersions.organizationId, organizationId),
        eq(decisionTemplateVersions.templateId, templateId),
        ne(decisionTemplateVersions.status, 'draft')
      )
    )
    .orderBy(
      desc(decisionTemplateVersions.major),
      desc(decisionTemplateVersions.minor)
    )
    .limit(1)
  if (!row || row.major === null || row.minor === null) return null
  return { major: row.major, labels: decisionLabels(row.definition) }
}

export interface EffectWarningsOptions {
  bindings: EffectBindingRow[]
  labels: string[]
  /** The major these warnings are checked against. */
  major: number
  /** Set only right after publishing a new major: the one it superseded. */
  previousMajor?: number
}

/**
 * `UNBOUND_LABEL`/`ORPHAN_BINDING` against the bindings that would actually
 * apply to `major` (enabled, and `major` is `null` or equals it); with
 * `previousMajor`, also `BINDING_OLD_MAJOR` for bindings pinned to it.
 */
export function effectWarningsFor(
  options: EffectWarningsOptions
): EffectWarning[] {
  const { bindings, labels, major, previousMajor } = options
  const labelSet = new Set(labels)
  const warnings: EffectWarning[] = []

  const applicable = bindings.filter(
    binding =>
      binding.enabled && (binding.major === null || binding.major === major)
  )

  for (const label of labels) {
    const bound = applicable.some(
      binding => binding.on === '*' || binding.on === label
    )
    if (!bound) warnings.push({ code: 'UNBOUND_LABEL', label })
  }

  for (const binding of applicable) {
    if (
      binding.on !== '*' &&
      binding.on !== NEEDS_REVIEW &&
      !labelSet.has(binding.on)
    ) {
      warnings.push({
        code: 'ORPHAN_BINDING',
        bindingId: binding.id,
        label: binding.on
      })
    }
  }

  if (previousMajor !== undefined) {
    for (const binding of bindings) {
      if (binding.major === previousMajor) {
        warnings.push({ code: 'BINDING_OLD_MAJOR', bindingId: binding.id })
      }
    }
  }

  return warnings
}

export interface EffectBindingsPage {
  data: EffectBindingView[]
  warnings: EffectWarning[]
}

/** Every binding of the template, in position order, with warnings against its latest version. */
export async function listEffectBindings(
  organizationId: string,
  templateId: string
): Promise<EffectBindingsPage> {
  await requireTemplate(organizationId, templateId)

  const bindings = await db
    .select()
    .from(effectBindings)
    .where(
      and(
        eq(effectBindings.organizationId, organizationId),
        eq(effectBindings.templateId, templateId)
      )
    )
    .orderBy(asc(effectBindings.position))

  const latest = await latestReleasedVersion(organizationId, templateId)
  const warnings = latest
    ? effectWarningsFor({
        bindings,
        labels: latest.labels,
        major: latest.major
      })
    : []

  return { data: bindings.map(effectBindingView), warnings }
}

export async function createEffectBinding(
  caller: Caller,
  templateId: string,
  body: CreateEffectBindingInput
): Promise<EffectBindingView> {
  await requireTemplate(caller.organizationId, templateId)
  const config = await resolveConfig(
    caller.organizationId,
    body.type,
    body.config
  )
  const position = await nextPosition(caller.organizationId, templateId)

  const [row] = await db
    .insert(effectBindings)
    .values({
      id: Id.generate(),
      organizationId: caller.organizationId,
      templateId,
      on: body.on,
      major: body.major ?? null,
      type: body.type,
      config,
      includeInput: body.includeInput ?? false,
      enabled: body.enabled ?? true,
      position,
      createdBy: caller.userId
    })
    .returning()
  if (!row) throw new Error('createEffectBinding: no row returned')
  return effectBindingView(row)
}

export async function updateEffectBinding(
  caller: Caller,
  templateId: string,
  bindingId: string,
  body: UpdateEffectBindingInput
): Promise<EffectBindingView> {
  await requireTemplate(caller.organizationId, templateId)
  const existing = await requireEffectBinding(
    caller.organizationId,
    templateId,
    bindingId
  )

  const config =
    body.config !== undefined
      ? await resolveConfig(caller.organizationId, existing.type, body.config)
      : undefined

  const [row] = await db
    .update(effectBindings)
    .set({
      ...(body.on !== undefined ? { on: body.on } : {}),
      ...(body.major !== undefined ? { major: body.major } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(body.includeInput !== undefined
        ? { includeInput: body.includeInput }
        : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(effectBindings.id, bindingId),
        eq(effectBindings.organizationId, caller.organizationId),
        eq(effectBindings.templateId, templateId)
      )
    )
    .returning()
  if (!row) throw bindingNotFound()
  return effectBindingView(row)
}

export async function deleteEffectBinding(
  organizationId: string,
  templateId: string,
  bindingId: string
): Promise<void> {
  await requireTemplate(organizationId, templateId)
  const deleted = await db
    .delete(effectBindings)
    .where(
      and(
        eq(effectBindings.id, bindingId),
        eq(effectBindings.organizationId, organizationId),
        eq(effectBindings.templateId, templateId)
      )
    )
    .returning({ id: effectBindings.id })
  if (deleted.length === 0) throw bindingNotFound()
}

// ── Effect executions ────────────────────────────────────────────────────

async function requireRun(
  organizationId: string,
  runId: string
): Promise<void> {
  if (!isQueryableId(runId)) throw runNotFound()
  const [row] = await db
    .select({ id: decisionRuns.id })
    .from(decisionRuns)
    .where(
      and(
        eq(decisionRuns.id, runId),
        eq(decisionRuns.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw runNotFound()
}

/** Every effect execution of one run, oldest first. */
export async function listRunEffects(
  organizationId: string,
  runId: string
): Promise<{ data: EffectExecutionView[] }> {
  await requireRun(organizationId, runId)
  const rows = await db
    .select()
    .from(effectExecutions)
    .where(
      and(
        eq(effectExecutions.organizationId, organizationId),
        eq(effectExecutions.runId, runId)
      )
    )
    .orderBy(asc(effectExecutions.id))
  return { data: rows.map(effectExecutionView) }
}

/** `dead`/`canceled` → `queued` (attempts reset to 0, due now); 409 otherwise. */
export async function retryEffectExecution(
  organizationId: string,
  id: string
): Promise<EffectExecutionView> {
  if (!isQueryableId(id)) throw executionNotFound()
  const now = new Date()

  const [row] = await db
    .update(effectExecutions)
    .set({
      status: 'queued',
      attempts: 0,
      runAt: now,
      lockedUntil: null,
      completedAt: null,
      updatedAt: now
    })
    .where(
      and(
        eq(effectExecutions.id, id),
        eq(effectExecutions.organizationId, organizationId),
        inArray(effectExecutions.status, ['dead', 'canceled'])
      )
    )
    .returning()
  if (row) return effectExecutionView(row)

  const [existing] = await db
    .select({ status: effectExecutions.status })
    .from(effectExecutions)
    .where(
      and(
        eq(effectExecutions.id, id),
        eq(effectExecutions.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!existing) throw executionNotFound()
  throw new ApiError(
    409,
    'EXECUTION_NOT_RETRYABLE',
    `Only a dead or canceled execution can be retried (this one is ${existing.status})`,
    { details: { status: existing.status } }
  )
}
