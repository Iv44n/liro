import { asc, eq } from 'drizzle-orm'
import {
  type EffectBindingConfig,
  type EffectEvent,
  type EffectType,
  type ExecutionStatus,
  effectBindings,
  effectExecutions,
  webhookEndpoints
} from '#modules/effects/effects.schemas'
import type { EffectPayload } from '#modules/effects/payload'
import { generateWebhookSecret } from '#modules/effects/signing'
import { Id } from '#shared/core/base'
import { encryptSecret } from '#shared/core/crypto'
import { db } from '#shared/db/config'
import type { TestOrg } from './factories'

/**
 * Inserts webhook endpoints, effect bindings and (for lower-level queue
 * tests) effect executions straight into the database — the routes that
 * will normally create these (`webhooks.routes.ts`, `effects.routes.ts`)
 * belong to a different agent's scope and aren't wired up yet.
 */

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect
export type EffectBindingRow = typeof effectBindings.$inferSelect
export type EffectExecutionRow = typeof effectExecutions.$inferSelect

export interface InsertWebhookEndpointOptions {
  url: string
  name?: string
  enabled?: boolean
  failureCount?: number
  /** Defaults to a fresh `generateWebhookSecret()`. */
  secret?: string
  previousSecret?: string
  previousSecretExpiresAt?: Date
}

export async function insertWebhookEndpoint(
  org: TestOrg,
  options: InsertWebhookEndpointOptions
): Promise<{ endpoint: WebhookEndpointRow; secret: string }> {
  const secret = options.secret ?? generateWebhookSecret()
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({
      id: Id.generate(),
      organizationId: org.id,
      name: options.name ?? 'Test endpoint',
      url: options.url,
      secretEncrypted: encryptSecret(secret),
      previousSecretEncrypted: options.previousSecret
        ? encryptSecret(options.previousSecret)
        : null,
      previousSecretExpiresAt: options.previousSecretExpiresAt ?? null,
      enabled: options.enabled ?? true,
      failureCount: options.failureCount ?? 0,
      createdBy: org.owner.id
    })
    .returning()
  if (!endpoint) throw new Error('insertWebhookEndpoint: no row returned')
  return { endpoint, secret }
}

export async function getWebhookEndpoint(
  id: string
): Promise<WebhookEndpointRow | null> {
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id))
    .limit(1)
  return row ?? null
}

/** Disables an endpoint directly — for tests of the handler's own belt-and-braces check (the dispatcher already skips already-disabled endpoints at queue time; this simulates one disabled *after* an execution was queued). */
export async function disableWebhookEndpoint(id: string): Promise<void> {
  await db
    .update(webhookEndpoints)
    .set({ enabled: false })
    .where(eq(webhookEndpoints.id, id))
}

export interface InsertEffectBindingOptions {
  templateId: string
  /** `'*'`, `'needs_review'`, or a decision label. */
  on: string
  type: EffectType
  config: EffectBindingConfig
  major?: number | null
  includeInput?: boolean
  enabled?: boolean
  position?: number
}

export async function insertEffectBinding(
  org: TestOrg,
  options: InsertEffectBindingOptions
): Promise<EffectBindingRow> {
  const [binding] = await db
    .insert(effectBindings)
    .values({
      id: Id.generate(),
      organizationId: org.id,
      templateId: options.templateId,
      on: options.on,
      major: options.major ?? null,
      type: options.type,
      config: options.config,
      includeInput: options.includeInput ?? false,
      enabled: options.enabled ?? true,
      position: options.position ?? 0,
      createdBy: org.owner.id
    })
    .returning()
  if (!binding) throw new Error('insertEffectBinding: no row returned')
  return binding
}

/** A webhook binding pointed at `endpoint`. */
export function webhookBinding(
  org: TestOrg,
  templateId: string,
  endpoint: WebhookEndpointRow,
  overrides: Partial<InsertEffectBindingOptions> = {}
): Promise<EffectBindingRow> {
  return insertEffectBinding(org, {
    templateId,
    on: '*',
    type: 'webhook',
    config: { endpointId: endpoint.id },
    ...overrides
  })
}

/** An email binding to `to`. */
export function emailBinding(
  org: TestOrg,
  templateId: string,
  to: string[],
  overrides: Partial<InsertEffectBindingOptions> = {}
): Promise<EffectBindingRow> {
  return insertEffectBinding(org, {
    templateId,
    on: '*',
    type: 'email',
    config: { to },
    ...overrides
  })
}

/** A Slack binding to a (plaintext, pre-encryption) webhook `url`. */
export function slackBinding(
  org: TestOrg,
  templateId: string,
  url: string,
  overrides: Partial<InsertEffectBindingOptions> & { channel?: string } = {}
): Promise<EffectBindingRow> {
  const { channel, ...rest } = overrides
  return insertEffectBinding(org, {
    templateId,
    on: '*',
    type: 'slack',
    config: {
      webhookUrlEncrypted: encryptSecret(url),
      ...(channel ? { channel } : {})
    },
    ...rest
  })
}

/** Every `effect_executions` row of a run, oldest first. */
export async function executionsOf(
  runId: string
): Promise<EffectExecutionRow[]> {
  return db
    .select()
    .from(effectExecutions)
    .where(eq(effectExecutions.runId, runId))
    .orderBy(asc(effectExecutions.createdAt))
}

export async function getExecution(
  id: string
): Promise<EffectExecutionRow | null> {
  const [row] = await db
    .select()
    .from(effectExecutions)
    .where(eq(effectExecutions.id, id))
    .limit(1)
  return row ?? null
}

export interface InsertEffectExecutionOptions {
  runId: string
  templateId: string
  type: EffectType
  event: EffectEvent
  target: string
  payload: EffectPayload
  bindingId?: string | null
  endpointId?: string | null
  status?: ExecutionStatus
  attempts?: number
  maxAttempts?: number
  runAt?: Date
  lockedUntil?: Date
}

/**
 * A minimally-valid `EffectPayload` fixture for queue-mechanics tests (claim
 * fairness, reaping, shutdown) that don't care about its content — only
 * `test/integration/effects.test.ts`'s dispatcher tests exercise real payloads.
 */
export function testEffectPayload(runId = Id.generate()): EffectPayload {
  return {
    type: 'decision.made',
    timestamp: new Date().toISOString(),
    data: {
      run: {
        id: runId,
        template: 'test-template',
        version: '1.0',
        mode: 'live',
        source: 'api',
        status: 'succeeded',
        decision: 'approve',
        finalDecision: 'approve',
        confidence: 1,
        suggestion: null,
        flags: [],
        rule: null,
        reviewReason: null,
        review: null,
        answers: null,
        signals: null,
        metadata: null,
        model: null,
        latencyMs: 1,
        createdAt: new Date(),
        completedAt: new Date(),
        error: null
      }
    }
  }
}

/** Inserts an execution row directly — for exercising `delivery.ts`'s queue mechanics without a real run/dispatch. */
export async function insertEffectExecution(
  org: TestOrg,
  options: InsertEffectExecutionOptions
): Promise<EffectExecutionRow> {
  const [execution] = await db
    .insert(effectExecutions)
    .values({
      id: Id.generate(),
      organizationId: org.id,
      runId: options.runId,
      bindingId: options.bindingId ?? null,
      endpointId: options.endpointId ?? null,
      templateId: options.templateId,
      type: options.type,
      event: options.event,
      target: options.target,
      status: options.status ?? 'queued',
      attempts: options.attempts ?? 0,
      maxAttempts: options.maxAttempts ?? 8,
      runAt: options.runAt ?? new Date(),
      lockedUntil: options.lockedUntil ?? null,
      payload: options.payload
    })
    .returning()
  if (!execution) throw new Error('insertEffectExecution: no row returned')
  return execution
}
