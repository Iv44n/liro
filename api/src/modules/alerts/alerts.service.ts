import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  type SQL,
  sql
} from 'drizzle-orm'
import z from 'zod'
import { members, users } from '#modules/auth/auth.schemas'
import {
  effectBindings,
  webhookEndpoints
} from '#modules/effects/effects.schemas'
import { OutboundError, safeFetch } from '#modules/effects/outbound'
import { webhookHeaders } from '#modules/effects/signing'
import { decisionRuns } from '#modules/runs/runs.schemas'
import { NEEDS_REVIEW } from '#modules/templates/definition'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { log } from '#shared/config/logger'
import { Id } from '#shared/core/base'
import { decryptSecret } from '#shared/core/crypto'
import { db } from '#shared/db/config'
import { ApiError, parseOrThrow } from '#shared/http/errors'
import { email } from '#shared/integrations/email'
import { type JobHandler, registerJobHandler } from '#shared/jobs/queue'
import { registerPeriodicJob } from '#shared/jobs/scheduler'
import {
  ALERT_CHANNELS,
  ALERT_METRICS,
  type AlertChannel,
  type AlertMetric,
  type AlertTarget,
  alertEvents,
  alertRules
} from './alerts.schemas'
import {
  type EvaluateAlertResult,
  evaluateAlert,
  type MetricSample
} from './evaluate'

/**
 * Alert rules and events for the dashboard (`/api/alerts`), plus the
 * `alerts.evaluate` periodic job (every 5 minutes — registered at module
 * load, below) that trips them: for each enabled rule, computes its metric
 * over its window/scope, and — past `threshold`, sample large enough, and
 * out of cooldown — records an `alert_events` row and sends its
 * notification (email or a direct signed webhook POST; never the effects
 * queue).
 */

export type AlertRuleRow = typeof alertRules.$inferSelect
export type AlertEventRow = typeof alertEvents.$inferSelect

const NUL_MESSAGE = 'Must not contain NUL characters'
const noNul = (value: string) => !value.includes('\u0000')
/** Postgres `text` can't hold NUL: such an id simply names no row. */
const isQueryableId = (id: string) => !id.includes('\u0000')

// ── Errors ───────────────────────────────────────────────────────────────

const ruleNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Alert rule not found')
const templateNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Template not found')
const endpointNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Webhook endpoint not found')

// ── Schemas ──────────────────────────────────────────────────────────────

const emailTargetSchema = z.object({ to: z.array(z.email()).min(1).max(20) })
const webhookTargetSchema = z.object({
  endpointId: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE)
})

const THRESHOLD_MAX = 1_000_000
const MINUTES_MAX = 7 * 24 * 60 // one week

/** `[0, 1]` for a rate metric; a positive integer count otherwise. */
function isValidThreshold(metric: AlertMetric, threshold: number): boolean {
  if (metric === 'review_rate' || metric === 'failure_rate') {
    return threshold >= 0 && threshold <= 1
  }
  return Number.isInteger(threshold) && threshold >= 1
}

const THRESHOLD_MESSAGE =
  'threshold must be within [0, 1] for review_rate/failure_rate, or a positive integer for jev_errors/endpoint_failing'

const commonRuleFields = {
  /** Omitted or `null` = every template of the organization. */
  templateId: z
    .string()
    .min(1)
    .max(64)
    .refine(noNul, NUL_MESSAGE)
    .nullish()
    .transform(value => value ?? null),
  metric: z.enum(ALERT_METRICS),
  threshold: z.number().min(0).max(THRESHOLD_MAX),
  windowMinutes: z.number().int().min(1).max(MINUTES_MAX).default(60),
  minRuns: z.number().int().min(0).max(1_000_000).default(20),
  enabled: z.boolean().default(true),
  cooldownMinutes: z.number().int().min(0).max(MINUTES_MAX).default(60)
}

export const createAlertRuleSchema = z
  .discriminatedUnion('channel', [
    z.object({
      channel: z.literal('email'),
      target: emailTargetSchema,
      ...commonRuleFields
    }),
    z.object({
      channel: z.literal('webhook'),
      target: webhookTargetSchema,
      ...commonRuleFields
    })
  ])
  .refine(data => isValidThreshold(data.metric, data.threshold), {
    message: THRESHOLD_MESSAGE,
    path: ['threshold']
  })
export type CreateAlertRuleInput = z.output<typeof createAlertRuleSchema>

/** `channel`/`target` are validated together in `updateAlertRule` (either may be omitted to keep the other side of the existing pair). */
export const updateAlertRuleSchema = z.object({
  templateId: z
    .string()
    .min(1)
    .max(64)
    .refine(noNul, NUL_MESSAGE)
    .nullable()
    .optional(),
  metric: z.enum(ALERT_METRICS).optional(),
  threshold: z.number().min(0).max(THRESHOLD_MAX).optional(),
  windowMinutes: z.number().int().min(1).max(MINUTES_MAX).optional(),
  minRuns: z.number().int().min(0).max(1_000_000).optional(),
  channel: z.enum(ALERT_CHANNELS).optional(),
  target: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(0).max(MINUTES_MAX).optional()
})
export type UpdateAlertRuleInput = z.output<typeof updateAlertRuleSchema>

export const listAlertEventsQuerySchema = z.object({
  ruleId: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE).optional(),
  cursor: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})
export type ListAlertEventsQuery = z.output<typeof listAlertEventsQuerySchema>

// ── Shared lookups ───────────────────────────────────────────────────────

async function requireAlertRule(
  organizationId: string,
  id: string
): Promise<AlertRuleRow> {
  if (!isQueryableId(id)) throw ruleNotFound()
  const [row] = await db
    .select()
    .from(alertRules)
    .where(
      and(eq(alertRules.id, id), eq(alertRules.organizationId, organizationId))
    )
    .limit(1)
  if (!row) throw ruleNotFound()
  return row
}

async function requireTemplateExists(
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

/**
 * The addresses of `candidates` that are verified emails of a current member
 * of `organizationId`. Duplicated from `effects.service.ts`'s private
 * helper of the same name (and `handlers/email.ts`'s own copy) rather than
 * imported: each module validates recipients against membership at its own
 * send/save time, and none of the three export it.
 */
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

async function requireWebhookEndpointExists(
  organizationId: string,
  endpointId: string
): Promise<void> {
  if (!isQueryableId(endpointId)) throw endpointNotFound()
  const [row] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw endpointNotFound()
}

/** Validates and shapes a rule's `target` for storage, by `channel` — mirrors `effects.service.ts`'s `resolveConfig`. */
async function resolveAlertTarget(
  organizationId: string,
  channel: AlertChannel,
  rawTarget: unknown
): Promise<AlertTarget> {
  switch (channel) {
    case 'email': {
      const { to } = parseOrThrow(emailTargetSchema, rawTarget)
      const verified = await currentVerifiedMemberEmails(organizationId, to)
      const invalid = to.filter(address => !verified.has(address))
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
    case 'webhook': {
      const { endpointId } = parseOrThrow(webhookTargetSchema, rawTarget)
      await requireWebhookEndpointExists(organizationId, endpointId)
      return { endpointId }
    }
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────

/** Every alert rule of the organization, newest first. */
export async function listAlertRules(
  organizationId: string
): Promise<AlertRuleRow[]> {
  return db
    .select()
    .from(alertRules)
    .where(eq(alertRules.organizationId, organizationId))
    .orderBy(desc(alertRules.createdAt))
}

export async function getAlertRule(
  organizationId: string,
  id: string
): Promise<AlertRuleRow> {
  return requireAlertRule(organizationId, id)
}

export interface AlertRuleCaller {
  organizationId: string
  userId: string
}

export async function createAlertRule(
  caller: AlertRuleCaller,
  body: CreateAlertRuleInput
): Promise<AlertRuleRow> {
  if (body.templateId) {
    await requireTemplateExists(caller.organizationId, body.templateId)
  }
  const target = await resolveAlertTarget(
    caller.organizationId,
    body.channel,
    body.target
  )

  const [row] = await db
    .insert(alertRules)
    .values({
      id: Id.generate(),
      organizationId: caller.organizationId,
      templateId: body.templateId,
      metric: body.metric,
      threshold: body.threshold,
      windowMinutes: body.windowMinutes,
      minRuns: body.minRuns,
      channel: body.channel,
      target,
      enabled: body.enabled,
      cooldownMinutes: body.cooldownMinutes,
      createdBy: caller.userId
    })
    .returning()
  if (!row) throw new Error('createAlertRule: no row returned')
  return row
}

export async function updateAlertRule(
  organizationId: string,
  id: string,
  body: UpdateAlertRuleInput
): Promise<AlertRuleRow> {
  const existing = await requireAlertRule(organizationId, id)

  if (body.templateId !== undefined && body.templateId !== null) {
    await requireTemplateExists(organizationId, body.templateId)
  }

  const effectiveMetric = body.metric ?? existing.metric
  const effectiveThreshold = body.threshold ?? existing.threshold
  if (!isValidThreshold(effectiveMetric, effectiveThreshold)) {
    throw new ApiError(422, 'VALIDATION_FAILED', THRESHOLD_MESSAGE, {
      details: { metric: effectiveMetric, threshold: effectiveThreshold }
    })
  }

  let target: AlertTarget | undefined
  if (body.channel !== undefined || body.target !== undefined) {
    const effectiveChannel = body.channel ?? existing.channel
    const rawTarget = body.target ?? existing.target
    target = await resolveAlertTarget(
      organizationId,
      effectiveChannel,
      rawTarget
    )
  }

  const [row] = await db
    .update(alertRules)
    .set({
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      ...(body.metric !== undefined ? { metric: body.metric } : {}),
      ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
      ...(body.windowMinutes !== undefined
        ? { windowMinutes: body.windowMinutes }
        : {}),
      ...(body.minRuns !== undefined ? { minRuns: body.minRuns } : {}),
      ...(body.channel !== undefined ? { channel: body.channel } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.cooldownMinutes !== undefined
        ? { cooldownMinutes: body.cooldownMinutes }
        : {}),
      updatedAt: new Date()
    })
    .where(
      and(eq(alertRules.id, id), eq(alertRules.organizationId, organizationId))
    )
    .returning()
  if (!row) throw ruleNotFound()
  return row
}

/** `alert_events` of this rule cascade-delete with it. */
export async function deleteAlertRule(
  organizationId: string,
  id: string
): Promise<void> {
  const deleted = await db
    .delete(alertRules)
    .where(
      and(eq(alertRules.id, id), eq(alertRules.organizationId, organizationId))
    )
    .returning({ id: alertRules.id })
  if (deleted.length === 0) throw ruleNotFound()
}

/** `GET /api/alerts/events`: newest first, optionally filtered to one rule. */
export async function listAlertEvents(
  organizationId: string,
  query: ListAlertEventsQuery
): Promise<{ data: AlertEventRow[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(alertEvents.organizationId, organizationId)]
  if (query.ruleId) conditions.push(eq(alertEvents.ruleId, query.ruleId))
  if (query.cursor) conditions.push(lt(alertEvents.id, query.cursor))

  const rows = await db
    .select()
    .from(alertEvents)
    .where(and(...conditions))
    .orderBy(desc(alertEvents.id))
    .limit(query.limit + 1)

  const page = rows.slice(0, query.limit)
  return {
    data: page,
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null
  }
}

// ── Notifications ────────────────────────────────────────────────────────

interface NotifyOutcome {
  ok: boolean
  error?: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function alertEmailContent(
  rule: AlertRuleRow,
  value: number,
  threshold: number
): { subject: string; html: string } {
  const metricLabel = rule.metric.replaceAll('_', ' ')
  const scope = rule.templateId
    ? `template ${rule.templateId}`
    : 'every template'
  const subject = `Liro alert: ${metricLabel} (${scope})`
  const html = `
    <p><strong>${escapeHtml(metricLabel)}</strong> tripped an alert for ${escapeHtml(scope)}.</p>
    <ul>
      <li>Value: ${escapeHtml(String(value))}</li>
      <li>Threshold: ${escapeHtml(String(threshold))}</li>
      <li>Window: ${rule.windowMinutes} minute(s)</li>
    </ul>
  `.trim()
  return { subject, html }
}

/** Members-only, like `effects/handlers/email.ts`'s `deliverEmail` — re-checked at send time, not at rule-save time. */
async function notifyEmail(
  organizationId: string,
  target: { to: string[] },
  subject: string,
  html: string
): Promise<NotifyOutcome> {
  const verified = await currentVerifiedMemberEmails(organizationId, target.to)
  const recipients = target.to.filter(address => verified.has(address))
  if (recipients.length === 0) {
    return {
      ok: false,
      error: `No recipient is a verified email of a current member of the organization: ${target.to.join(', ')}`
    }
  }
  try {
    await Promise.all(recipients.map(to => email.send({ to, subject, html })))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** A direct signed POST to the endpoint — never the effects queue, so a failure here never retries and never touches the endpoint's own `failureCount`. */
async function notifyWebhook(
  organizationId: string,
  target: { endpointId: string },
  payload: Record<string, unknown>,
  now: Date
): Promise<NotifyOutcome> {
  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, target.endpointId),
        eq(webhookEndpoints.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!endpoint)
    return { ok: false, error: 'The webhook endpoint no longer exists' }
  if (!endpoint.enabled)
    return { ok: false, error: 'The webhook endpoint is disabled' }

  const secrets = [decryptSecret(endpoint.secretEncrypted)]
  if (
    endpoint.previousSecretEncrypted &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt.getTime() > now.getTime()
  ) {
    secrets.push(decryptSecret(endpoint.previousSecretEncrypted))
  }

  const body = JSON.stringify(payload)
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
    return ok
      ? { ok: true }
      : { ok: false, error: `Webhook endpoint responded ${result.status}` }
  } catch (error) {
    if (error instanceof OutboundError)
      return { ok: false, error: error.message }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function sendAlertNotification(
  rule: AlertRuleRow,
  info: { value: number; threshold: number; test?: boolean },
  now: Date
): Promise<NotifyOutcome> {
  const test = info.test ?? false
  switch (rule.channel) {
    case 'email': {
      const { subject, html } = alertEmailContent(
        rule,
        info.value,
        info.threshold
      )
      return notifyEmail(
        rule.organizationId,
        rule.target as { to: string[] },
        test ? `[Test] ${subject}` : subject,
        html
      )
    }
    case 'webhook': {
      const payload = {
        type: test ? 'alert.test' : 'alert.triggered',
        timestamp: now.toISOString(),
        data: {
          ruleId: rule.id,
          templateId: rule.templateId,
          metric: rule.metric,
          value: info.value,
          threshold: info.threshold
        }
      }
      return notifyWebhook(
        rule.organizationId,
        rule.target as { endpointId: string },
        payload,
        now
      )
    }
  }
}

export interface AlertTestResult {
  ok: boolean
  error?: string
}

/** `POST /api/alerts/:id/test`: sends the rule's notification right now (its own `threshold` as the sample value) — never queued, never recorded as an `alert_events` row. */
export async function testAlertRule(
  organizationId: string,
  id: string,
  now: Date = new Date()
): Promise<AlertTestResult> {
  const rule = await requireAlertRule(organizationId, id)
  return sendAlertNotification(
    rule,
    { value: rule.threshold, threshold: rule.threshold, test: true },
    now
  )
}

// ── Periodic evaluation (`alerts.evaluate`) ─────────────────────────────

/**
 * Every metric that reads `decision_runs` is scoped to `source: 'api'` and
 * `mode: 'live'` — the same default `stats.service.ts` applies to its own
 * queries — so dashboard-triggered playground/review runs and test-key
 * traffic never skew production alerting.
 */
const RUN_SOURCE = 'api' as const
const RUN_MODE = 'live' as const

function runConditions(
  organizationId: string,
  templateId: string | null,
  from: Date,
  to: Date
): SQL[] {
  const conditions: SQL[] = [
    eq(decisionRuns.organizationId, organizationId),
    eq(decisionRuns.source, RUN_SOURCE),
    eq(decisionRuns.mode, RUN_MODE),
    gte(decisionRuns.createdAt, from),
    lte(decisionRuns.createdAt, to)
  ]
  if (templateId) conditions.push(eq(decisionRuns.templateId, templateId))
  return conditions
}

async function reviewRateSample(
  organizationId: string,
  templateId: string | null,
  from: Date,
  to: Date
): Promise<MetricSample> {
  const conditions = runConditions(organizationId, templateId, from, to)
  conditions.push(eq(decisionRuns.status, 'succeeded'))
  const [row] = await db
    .select({
      succeeded: sql<number>`count(*)`.mapWith(Number),
      needsReview:
        sql<number>`count(*) filter (where ${decisionRuns.decision} = ${NEEDS_REVIEW})`.mapWith(
          Number
        )
    })
    .from(decisionRuns)
    .where(and(...conditions))
  return {
    metric: 'review_rate',
    succeededRuns: row?.succeeded ?? 0,
    needsReviewRuns: row?.needsReview ?? 0
  }
}

async function failureRateSample(
  organizationId: string,
  templateId: string | null,
  from: Date,
  to: Date
): Promise<MetricSample> {
  const conditions = runConditions(organizationId, templateId, from, to)
  const [row] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      failed:
        sql<number>`count(*) filter (where ${decisionRuns.status} = 'failed')`.mapWith(
          Number
        )
    })
    .from(decisionRuns)
    .where(and(...conditions))
  return {
    metric: 'failure_rate',
    totalRuns: row?.total ?? 0,
    failedRuns: row?.failed ?? 0
  }
}

async function jevErrorsSample(
  organizationId: string,
  templateId: string | null,
  from: Date,
  to: Date
): Promise<MetricSample> {
  const conditions = runConditions(organizationId, templateId, from, to)
  conditions.push(eq(decisionRuns.status, 'failed'))
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(decisionRuns)
    .where(and(...conditions))
  return { metric: 'jev_errors', errorCount: row?.count ?? 0 }
}

/**
 * Not windowed: `webhook_endpoints.failure_count` is already a running
 * consecutive-failure counter (reset on success — see `effects/delivery.ts`),
 * so the current value *is* the signal. Scoped to the endpoints the
 * template's webhook bindings actually use when `templateId` is set
 * (every org endpoint otherwise); includes disabled endpoints too — an
 * endpoint that was just auto-disabled for failing repeatedly is exactly
 * what this metric exists to catch.
 */
async function endpointFailingSample(
  organizationId: string,
  templateId: string | null
): Promise<MetricSample> {
  let endpointIds: string[] | null = null
  if (templateId) {
    const bindings = await db
      .select({ config: effectBindings.config })
      .from(effectBindings)
      .where(
        and(
          eq(effectBindings.organizationId, organizationId),
          eq(effectBindings.templateId, templateId),
          eq(effectBindings.type, 'webhook')
        )
      )
    endpointIds = [
      ...new Set(
        bindings.map(row => (row.config as { endpointId: string }).endpointId)
      )
    ]
    if (endpointIds.length === 0) {
      return { metric: 'endpoint_failing', maxConsecutiveFailures: 0 }
    }
  }

  const conditions: SQL[] = [
    eq(webhookEndpoints.organizationId, organizationId)
  ]
  if (endpointIds) conditions.push(inArray(webhookEndpoints.id, endpointIds))
  const [row] = await db
    .select({
      max: sql<number | null>`max(${webhookEndpoints.failureCount})`.mapWith(
        Number
      )
    })
    .from(webhookEndpoints)
    .where(and(...conditions))
  return { metric: 'endpoint_failing', maxConsecutiveFailures: row?.max ?? 0 }
}

async function computeSample(
  rule: AlertRuleRow,
  now: Date
): Promise<MetricSample> {
  const from = new Date(now.getTime() - rule.windowMinutes * 60_000)
  switch (rule.metric) {
    case 'review_rate':
      return reviewRateSample(rule.organizationId, rule.templateId, from, now)
    case 'failure_rate':
      return failureRateSample(rule.organizationId, rule.templateId, from, now)
    case 'jev_errors':
      return jevErrorsSample(rule.organizationId, rule.templateId, from, now)
    case 'endpoint_failing':
      return endpointFailingSample(rule.organizationId, rule.templateId)
  }
}

/** `lastTriggeredAt` is set on every trip (notify success or failure), so a rule whose notification keeps failing doesn't fire every 5 minutes either. */
function inCooldown(rule: AlertRuleRow, now: Date): boolean {
  if (!rule.lastTriggeredAt) return false
  return (
    now.getTime() - rule.lastTriggeredAt.getTime() <
    rule.cooldownMinutes * 60_000
  )
}

async function recordAlertTrip(
  rule: AlertRuleRow,
  result: EvaluateAlertResult,
  now: Date
): Promise<void> {
  const [event] = await db
    .insert(alertEvents)
    .values({
      id: Id.generate(),
      organizationId: rule.organizationId,
      ruleId: rule.id,
      value: result.value,
      threshold: rule.threshold,
      details: {
        metric: rule.metric,
        windowMinutes: rule.windowMinutes,
        sampleSize: result.sampleSize
      },
      triggeredAt: now
    })
    .returning()
  if (!event) throw new Error('recordAlertTrip: no event row returned')

  const outcome = await sendAlertNotification(
    rule,
    { value: result.value, threshold: rule.threshold },
    now
  )

  await db
    .update(alertEvents)
    .set(
      outcome.ok
        ? { notifiedAt: now }
        : { notifyError: (outcome.error ?? 'Unknown error').slice(0, 2_000) }
    )
    .where(eq(alertEvents.id, event.id))

  // Cooldown gate uses this regardless of notify outcome — see `inCooldown`.
  await db
    .update(alertRules)
    .set({ lastTriggeredAt: now })
    .where(eq(alertRules.id, rule.id))
}

export interface EvaluateAlertsResult {
  rulesChecked: number
  triggered: number
}

/**
 * The whole `alerts.evaluate` sweep, computed with the JS clock's `now`
 * (tests move it with `setSystemTime`, same convention as `retention.ts`).
 * Every enabled rule across every organization is checked (a periodic job,
 * not an org-scoped request); one rule's failure is logged and skipped, not
 * fatal to the sweep — same defensive shape as `worker.ts`'s own stages.
 */
export async function evaluateAlerts(now: Date): Promise<EvaluateAlertsResult> {
  const rules = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.enabled, true))

  let triggered = 0
  for (const rule of rules) {
    try {
      if (inCooldown(rule, now)) continue

      const sample = await computeSample(rule, now)
      const result = evaluateAlert({
        sample,
        threshold: rule.threshold,
        minRuns: rule.minRuns
      })
      if (!result.triggered) continue

      triggered++
      await recordAlertTrip(rule, result, now)
    } catch (error) {
      log.logger.error('[alerts] rule evaluation failed', {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return { rulesChecked: rules.length, triggered }
}

export const ALERTS_JOB_TYPE = 'alerts.evaluate'
const ALERTS_INTERVAL_MS = 5 * 60_000

/** The `jobs` handler for `ALERTS_JOB_TYPE` — exported for tests to call directly, bypassing the queue. */
export const alertsEvaluateHandler: JobHandler = async () => {
  const now = new Date()
  const result = await evaluateAlerts(now)
  log.logger.info('[alerts] evaluation complete', { ...result })
}

/**
 * Wires this module into the worker: the `alerts.evaluate` handler
 * (`shared/jobs/queue.ts`) and its 5-minute cadence
 * (`shared/jobs/scheduler.ts`'s `registerPeriodicJob`, the same generic API
 * `retention.purge` uses — see its own `registerRetentionJobs`). Called once
 * below, at module load; a test that clears the registries
 * (`clearJobHandlers`, `clearPeriodicJobs`) must call this again afterwards.
 */
export function registerAlertsJobs(): void {
  registerJobHandler(ALERTS_JOB_TYPE, alertsEvaluateHandler)
  registerPeriodicJob({
    dedupeKeyPrefix: 'alerts',
    intervalMs: ALERTS_INTERVAL_MS,
    type: ALERTS_JOB_TYPE,
    payloadFor: () => ({})
  })
}

registerAlertsJobs()
