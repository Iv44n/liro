import { defineRelationsPart, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core'
import { organizations, users } from '#modules/auth/auth.schemas'
import { decisionRuns } from '#modules/runs/runs.schemas'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'
import type { EffectPayload } from './payload'

/**
 * The effects queue: webhook endpoints (reusable, org-owned delivery
 * targets), effect bindings (a template's rule for which event fires which
 * effect) and effect executions (the actual delivery queue — one row per
 * binding matched by a run, retried with backoff until it succeeds or dies).
 */

export const EFFECT_TYPES = ['webhook', 'email', 'slack'] as const
export type EffectType = (typeof EFFECT_TYPES)[number]

/** The events a binding's `on` can match (`'*'` and `'needs_review'` are matched separately — see `dispatcher.ts`). */
export const EFFECT_EVENTS = [
  'decision.made',
  'decision.review_requested',
  'decision.reviewed'
] as const
export type EffectEvent = (typeof EFFECT_EVENTS)[number]

export const EXECUTION_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'dead',
  'canceled'
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

/** `effect_bindings.config`, shaped by `type`. */
export type EffectBindingConfig =
  | { endpointId: string }
  | { to: string[] }
  | { webhookUrlEncrypted: string; channel?: string }

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
}

/** A reusable webhook delivery target of one organization, with its signing secret(s). */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    url: text('url').notNull(),
    /** `crypto.ts`-encrypted `whsec_...` secret, current signing key. */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** Set during `rotate-secret`; both are accepted until it expires. */
    previousSecretEncrypted: text('previous_secret_encrypted'),
    previousSecretExpiresAt: timestamp('previous_secret_expires_at', {
      withTimezone: true
    }),
    enabled: boolean('enabled').default(true).notNull(),
    /** Consecutive delivery failures across every execution of this endpoint; reset on success. */
    failureCount: integer('failure_count').default(0).notNull(),
    /** Set when auto-disabled (`'too_many_failures'`); cleared by re-enabling. */
    disabledReason: text('disabled_reason'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestamps
  },
  table => [
    index('webhook_endpoints_org_idx').on(table.organizationId, table.name)
  ]
)

/** A template's rule for which event fires which effect. */
export const effectBindings = pgTable(
  'effect_bindings',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => decisionTemplates.id, { onDelete: 'cascade' }),
    /** `'*'` (every event), `'needs_review'` (only `decision.review_requested`), or a decision label. */
    on: text('on').notNull(),
    /** `null` matches every major version of the template. */
    major: integer('major'),
    type: text('type', { enum: EFFECT_TYPES }).notNull(),
    config: jsonb('config').$type<EffectBindingConfig>().notNull(),
    /** Include the run's stored input in the event payload (off by default: it may hold sensitive data). */
    includeInput: boolean('include_input').default(false).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    /** Display order in the template's effects list. */
    position: integer('position').notNull(),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestamps
  },
  table => [
    index('effect_bindings_org_template_idx').on(
      table.organizationId,
      table.templateId
    )
  ]
)

/**
 * THE delivery queue. One row per binding matched by a run: `id` is the
 * Standard Webhooks `webhook-id`, generated once by the dispatcher and
 * stable across every retry of that delivery.
 */
export const effectExecutions = pgTable(
  'effect_executions',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => decisionRuns.id, { onDelete: 'cascade' }),
    /** `null` once the binding that created this row is deleted; the row itself is kept. */
    bindingId: text('binding_id').references(() => effectBindings.id, {
      onDelete: 'set null'
    }),
    /** Webhook deliveries only; `null` once the endpoint is deleted (or for non-webhook types). */
    endpointId: text('endpoint_id').references(() => webhookEndpoints.id, {
      onDelete: 'set null'
    }),
    templateId: text('template_id')
      .notNull()
      .references(() => decisionTemplates.id, { onDelete: 'cascade' }),
    type: text('type', { enum: EFFECT_TYPES }).notNull(),
    event: text('event', { enum: EFFECT_EVENTS }).notNull(),
    /** Display string: the endpoint's host, the recipient emails, or `'slack'`. */
    target: text('target').notNull(),
    status: text('status', { enum: EXECUTION_STATUSES })
      .default('queued')
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(8).notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    /** Set while `running`; a worker that dies leaves this in the past for the reaper to reclaim. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** The claiming worker instance's id, set at claim time; scopes graceful shutdown's release to its own rows (see `worker.ts`). */
    lockedBy: text('locked_by'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastResponseStatus: integer('last_response_status'),
    /** Truncated to ≤ 2 KB. */
    lastResponseBody: text('last_response_body'),
    lastDurationMs: integer('last_duration_ms'),
    /** The event envelope sent (or to be sent) to the effect. */
    payload: jsonb('payload').$type<EffectPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true })
  },
  table => [
    index('effect_executions_queued_run_at_idx')
      .on(table.runAt)
      .where(sql`status = 'queued'`),
    index('effect_executions_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc()
    ),
    index('effect_executions_run_idx').on(table.runId),
    index('effect_executions_endpoint_created_idx').on(
      table.endpointId,
      table.createdAt.desc()
    )
  ]
)

export const effectsRelations = defineRelationsPart(
  {
    webhookEndpoints,
    effectBindings,
    effectExecutions,
    organizations,
    decisionTemplates,
    decisionRuns
  },
  r => ({
    webhookEndpoints: {
      organization: r.one.organizations({
        from: r.webhookEndpoints.organizationId,
        to: r.organizations.id
      })
    },
    effectBindings: {
      organization: r.one.organizations({
        from: r.effectBindings.organizationId,
        to: r.organizations.id
      }),
      template: r.one.decisionTemplates({
        from: r.effectBindings.templateId,
        to: r.decisionTemplates.id
      })
    },
    effectExecutions: {
      organization: r.one.organizations({
        from: r.effectExecutions.organizationId,
        to: r.organizations.id
      }),
      run: r.one.decisionRuns({
        from: r.effectExecutions.runId,
        to: r.decisionRuns.id
      }),
      binding: r.one.effectBindings({
        from: r.effectExecutions.bindingId,
        to: r.effectBindings.id
      }),
      endpoint: r.one.webhookEndpoints({
        from: r.effectExecutions.endpointId,
        to: r.webhookEndpoints.id
      })
    }
  })
)
