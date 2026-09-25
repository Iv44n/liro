import { defineRelationsPart, sql } from 'drizzle-orm'
import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp
} from 'drizzle-orm/pg-core'
import { organizations, users } from '#modules/auth/auth.schemas'
import type { ProviderId } from '#modules/engine/evaluator/port'
import type {
  JsonObject,
  ResolvedAnswers,
  ReviewReason
} from '#modules/engine/types'
import type { TemplateDefinition } from '#modules/templates/definition'
import {
  decisionTemplates,
  decisionTemplateVersions
} from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'

export const RUN_MODES = ['live', 'test'] as const
export const RUN_SOURCES = [
  'api',
  'playground',
  'review',
  'evaluation'
] as const
export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed'
] as const

export type RunMode = (typeof RUN_MODES)[number]
export type RunSource = (typeof RUN_SOURCES)[number]
export type RunStatus = (typeof RUN_STATUSES)[number]

/** One execution of a template version (UUIDv7 ids: sortable by creation). */
export const decisionRuns = pgTable(
  'decision_runs',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => decisionTemplates.id, { onDelete: 'cascade' }),
    /** The published version — or the draft, for playground runs. */
    versionId: text('version_id')
      .notNull()
      .references(() => decisionTemplateVersions.id, { onDelete: 'cascade' }),
    definitionHash: text('definition_hash').notNull(),
    engineVersion: text('engine_version').notNull(),
    mode: text('mode', { enum: RUN_MODES }).notNull(),
    source: text('source', { enum: RUN_SOURCES }).notNull(),
    apiKeyId: text('api_key_id'),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    metadata: jsonb('metadata').$type<JsonObject>(),
    status: text('status', { enum: RUN_STATUSES }).notNull(),

    /** Per the template's `storeInput` (never `pii` fields); `null` when not stored or purged. */
    input: jsonb('input').$type<JsonObject>(),
    /** Only the input paths the policy reads — always kept, so the run can be replayed. */
    policyInput: jsonb('policy_input').$type<JsonObject>().notNull(),
    answers: jsonb('answers').$type<ResolvedAnswers>(),
    signals: jsonb('signals').$type<Record<string, number | null>>(),
    /** Snapshot of the draft definition (playground runs only). */
    definition: jsonb('definition').$type<TemplateDefinition>(),

    decision: text('decision'),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence'),
    rule: text('rule'),
    reviewReason: text('review_reason').$type<ReviewReason>(),
    flags: text('flags').array().default(sql`'{}'::text[]`).notNull(),
    /** The decision after review: equals `decision` when no review was needed; `null` while pending. */
    finalDecision: text('final_decision'),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),

    /** `null` when a precondition decided without calling the evaluator. */
    provider: text('provider').$type<ProviderId>(),
    modelRequested: text('model_requested'),
    modelResolved: text('model_resolved'),
    providerRequestId: text('provider_request_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Whole run, as seen by the caller. */
    latencyMs: integer('latency_ms'),
    evaluatorLatencyMs: integer('evaluator_latency_ms'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true })
  },
  table => [
    index('decision_runs_org_template_created_idx').on(
      table.organizationId,
      table.templateId,
      table.createdAt.desc()
    ),
    index('decision_runs_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc()
    ),
    index('decision_runs_org_decision_idx').on(
      table.organizationId,
      table.decision
    )
  ]
)

export const IDEMPOTENCY_STATUSES = ['in_progress', 'completed'] as const

/**
 * `Idempotency-Key`s of `/v1` runs. Claimed (`ON CONFLICT DO NOTHING`) before
 * calling the evaluator, completed in the run's transaction, released on
 * transient failures, and kept for 24 h.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: IDEMPOTENCY_STATUSES }).notNull(),
    runId: text('run_id').references(() => decisionRuns.id, {
      onDelete: 'cascade'
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
  },
  table => [
    primaryKey({ columns: [table.organizationId, table.key] }),
    index('idempotency_keys_expires_idx').on(table.expiresAt)
  ]
)

/**
 * Daily usage rollup, incremented in each run's transaction (a failed run's
 * too, when the evaluator had answered). Survives run purges, so it is the
 * source for usage and billing. `provider` is `'none'` when a precondition
 * decided without calling the evaluator.
 */
export const usageDaily = pgTable(
  'usage_daily',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    templateId: text('template_id').notNull(),
    source: text('source', { enum: RUN_SOURCES }).notNull(),
    mode: text('mode', { enum: RUN_MODES }).notNull(),
    provider: text('provider').notNull(),
    /** Succeeded runs — what billing counts; failed runs never add to it. */
    runs: integer('runs').default(0).notNull(),
    /**
     * Evaluator calls that answered, including those of runs that then failed
     * (e.g. `BAD_RESPONSE`), so provider spend is never lost: per provider,
     * `evaluations - runs` is the failed ones. Tokens count all of them.
     */
    evaluations: integer('evaluations').default(0).notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' })
      .default(0)
      .notNull(),
    outputTokens: bigint('output_tokens', { mode: 'number' })
      .default(0)
      .notNull()
  },
  table => [
    primaryKey({
      columns: [
        table.organizationId,
        table.day,
        table.templateId,
        table.source,
        table.mode,
        table.provider
      ]
    })
  ]
)

export const runsRelations = defineRelationsPart(
  {
    decisionRuns,
    decisionTemplates,
    decisionTemplateVersions,
    idempotencyKeys,
    usageDaily
  },
  r => ({
    decisionRuns: {
      template: r.one.decisionTemplates({
        from: r.decisionRuns.templateId,
        to: r.decisionTemplates.id
      }),
      version: r.one.decisionTemplateVersions({
        from: r.decisionRuns.versionId,
        to: r.decisionTemplateVersions.id
      })
    },
    idempotencyKeys: {},
    usageDaily: {}
  })
)
