import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { RunMode } from '#modules/runs/runs.schemas'
import { NEEDS_REVIEW } from '#modules/templates/definition'
import { Id } from '#shared/core/base'
import type { db } from '#shared/db/config'
import {
  type EffectEvent,
  effectBindings,
  effectExecutions,
  webhookEndpoints
} from './effects.schemas'
import type { EffectPayload } from './payload'

/**
 * Turns a run event into queued deliveries: one `effect_executions` row per
 * enabled binding of the template that matches the event, inserted in the
 * caller's own transaction — so a run and the effects it triggers are one
 * atomic write (the transactional outbox: if the run rolls back, so do its
 * effects; if it commits, its effects are queued, never lost).
 */

type Database = typeof db
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

type BindingRow = typeof effectBindings.$inferSelect
type EndpointRow = typeof webhookEndpoints.$inferSelect

/** An execution's default retry budget (see `shared/jobs/queue.ts`'s backoff schedule). */
const DEFAULT_MAX_ATTEMPTS = 8

export interface EnqueueEffectsOptions {
  organizationId: string
  runId: string
  templateId: string
  /** `null` for a draft/playground version: only bindings with `major: null` can match. */
  major: number | null
  /** `'test'` (test keys, and every playground run) enqueues nothing. */
  mode: RunMode
  event: EffectEvent
  /** The decision label `on` must equal for `decision.made`/`decision.reviewed`; unused for `decision.review_requested`. */
  label: string | null
  /** The event's own time — the run's `now`, not `Date.now()` (same convention as `payload.ts`'s `BuildEffectPayloadOptions.now`): stamps the inserted rows' `runAt` so they're deterministic and consistent with the payload's own `timestamp` within the same atomic write. */
  now: Date
  /** Builds the event envelope for one matched binding (its `includeInput` decides whether it carries the run's input). */
  payloadFor: (binding: BindingRow) => EffectPayload
}

/** Whether `binding.on` matches this event (`'*'` always does). */
function bindingMatches(
  binding: BindingRow,
  event: EffectEvent,
  label: string | null
): boolean {
  if (binding.on === '*') return true
  if (event === 'decision.review_requested') return binding.on === NEEDS_REVIEW
  return label !== null && binding.on === label
}

const endpointIdOf = (binding: BindingRow): string =>
  (binding.config as { endpointId: string }).endpointId

/** Display string for `effect_executions.target`, from the binding's own config. */
function targetOf(
  binding: BindingRow,
  endpointById: Map<string, EndpointRow>
): string {
  switch (binding.type) {
    case 'webhook': {
      const endpoint = endpointById.get(endpointIdOf(binding))
      if (!endpoint) return 'webhook'
      try {
        return new URL(endpoint.url).host
      } catch {
        return endpoint.url
      }
    }
    case 'email':
      return (binding.config as { to: string[] }).to.join(', ')
    case 'slack':
      return 'slack'
  }
}

export async function enqueueEffects(
  tx: Transaction,
  options: EnqueueEffectsOptions
): Promise<void> {
  // Test-mode runs (any test API key, and every playground run — the
  // playground always runs in test mode) never produce effects.
  if (options.mode === 'test') return

  const majorCondition =
    options.major === null
      ? isNull(effectBindings.major)
      : or(
          isNull(effectBindings.major),
          eq(effectBindings.major, options.major)
        )

  const bindings = await tx
    .select()
    .from(effectBindings)
    .where(
      and(
        eq(effectBindings.organizationId, options.organizationId),
        eq(effectBindings.templateId, options.templateId),
        eq(effectBindings.enabled, true),
        majorCondition
      )
    )
  if (bindings.length === 0) return

  const matching = bindings.filter(binding =>
    bindingMatches(binding, options.event, options.label)
  )
  if (matching.length === 0) return

  // Webhook bindings whose endpoint is disabled (or gone) are skipped
  // entirely — no execution row for them.
  const endpointIds = [
    ...new Set(
      matching.filter(binding => binding.type === 'webhook').map(endpointIdOf)
    )
  ]
  const endpointById = new Map<string, EndpointRow>()
  if (endpointIds.length > 0) {
    const endpoints = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, options.organizationId),
          inArray(webhookEndpoints.id, endpointIds)
        )
      )
    for (const endpoint of endpoints) endpointById.set(endpoint.id, endpoint)
  }

  const eligible = matching.filter(binding => {
    if (binding.type !== 'webhook') return true
    const endpoint = endpointById.get(endpointIdOf(binding))
    return endpoint?.enabled === true
  })
  if (eligible.length === 0) return

  await tx.insert(effectExecutions).values(
    eligible.map(binding => ({
      id: Id.generate(),
      organizationId: options.organizationId,
      runId: options.runId,
      bindingId: binding.id,
      endpointId: binding.type === 'webhook' ? endpointIdOf(binding) : null,
      templateId: options.templateId,
      type: binding.type,
      event: options.event,
      target: targetOf(binding, endpointById),
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      runAt: options.now,
      payload: options.payloadFor(binding)
    }))
  )
}
