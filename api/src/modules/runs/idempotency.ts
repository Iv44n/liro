import { and, eq, lte } from 'drizzle-orm'
import { EVALUATION_DEADLINE_MS } from '#modules/engine/evaluator'
import { hashJson } from '#shared/core/hash'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'
import { idempotencyKeys, type RunMode } from './runs.schemas'

/**
 * `Idempotency-Key` handling for `/v1` runs. A key is claimed (an
 * `in_progress` row) BEFORE the evaluator is called, completed with the run
 * id inside the run's own transaction, and released (deleted) when the run
 * fails, so the caller can retry. Keys live 24 h, measured with the JS clock
 * so tests can move it with `setSystemTime`.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * An `in_progress` claim this old belongs to a request that died between
 * claiming and completing/releasing it (a crash, a redeploy): no run outlives
 * the evaluation deadline, so after it plus a margin the key is reclaimable
 * instead of answering `409 IDEMPOTENCY_IN_PROGRESS` until it expires.
 */
export const IDEMPOTENCY_ABANDONED_MS = EVALUATION_DEADLINE_MS + 60_000

/** 1..255 printable ASCII characters (space included). */
const KEY_PATTERN = /^[\x20-\x7e]{1,255}$/

export type Database = typeof db
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
/** Either the database or an open transaction. */
export type Queryable = Database | Transaction

/**
 * The request's `Idempotency-Key`, `null` when the header is absent. Throws
 * `400 INVALID_IDEMPOTENCY_KEY` for a present but malformed one (empty
 * included).
 */
export function idempotencyKeyOf(headers: Headers): string | null {
  const key = headers.get('idempotency-key')
  if (key === null) return null
  if (!KEY_PATTERN.test(key)) {
    throw new ApiError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 1 to 255 printable ASCII characters'
    )
  }
  return key
}

/**
 * What makes two requests "the same" for a key: the ref as written, the
 * input and metadata as sent, and the caller's mode (a live and a test key
 * of one organization never share a run).
 */
export function idempotencyRequestHash(request: {
  ref: string
  input: unknown
  metadata?: unknown
  mode: RunMode
}): string {
  return hashJson({
    ref: request.ref,
    input: request.input,
    metadata: request.metadata ?? null,
    mode: request.mode
  })
}

export type IdempotencyClaim =
  /** `claimedAt` identifies this claim to `complete`/`release`. */
  { kind: 'claimed'; claimedAt: Date } | { kind: 'replay'; runId: string }

export interface ClaimOptions {
  organizationId: string
  key: string
  requestHash: string
  now: Date
}

/** Claim attempts before giving up on a key that keeps changing under us. */
const MAX_CLAIM_ATTEMPTS = 3

/**
 * The run a completed, unexpired `key` stored for this very request, looked
 * up BEFORE the ref is resolved and the input validated: a replay must not
 * depend on what the ref points to now (a stricter new major, an archived
 * template, a version whose model went away). `null` when there is nothing
 * to replay yet — the request then runs and claims the key as usual. A
 * completed key used with another request hash is `422
 * IDEMPOTENCY_KEY_REUSED`, as `claimIdempotencyKey` would answer.
 */
export async function findIdempotentReplay(
  executor: Queryable,
  options: ClaimOptions
): Promise<string | null> {
  const [existing] = await executor
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, options.organizationId),
        eq(idempotencyKeys.key, options.key),
        eq(idempotencyKeys.status, 'completed')
      )
    )
    .limit(1)
  if (!existing?.runId) return null
  if (existing.expiresAt.getTime() <= options.now.getTime()) return null
  if (existing.requestHash !== options.requestHash) throw keyReused()
  return existing.runId
}

/**
 * Claims `key` for this request (`INSERT … ON CONFLICT DO NOTHING`). On a
 * conflict the existing row decides: expired, or an abandoned `in_progress`
 * claim (`IDEMPOTENCY_ABANDONED_MS`) → deleted and claimed again; another
 * request hash → `422 IDEMPOTENCY_KEY_REUSED`; still running → `409
 * IDEMPOTENCY_IN_PROGRESS`; completed → `replay` of its run.
 */
export async function claimIdempotencyKey(
  executor: Queryable,
  options: ClaimOptions
): Promise<IdempotencyClaim> {
  const { organizationId, key, requestHash, now } = options
  const where = and(
    eq(idempotencyKeys.organizationId, organizationId),
    eq(idempotencyKeys.key, key)
  )

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const inserted = await executor
      .insert(idempotencyKeys)
      .values({
        organizationId,
        key,
        requestHash,
        status: 'in_progress',
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS)
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key })
    if (inserted.length > 0) return { kind: 'claimed', claimedAt: now }

    const [existing] = await executor
      .select()
      .from(idempotencyKeys)
      .where(where)
      .limit(1)
    // Released or purged since the insert: try again.
    if (!existing) continue

    if (existing.expiresAt.getTime() <= now.getTime()) {
      // Conditional, so a concurrent request's fresh claim is never deleted.
      await executor
        .delete(idempotencyKeys)
        .where(and(where, lte(idempotencyKeys.expiresAt, now)))
      continue
    }
    const abandonedBefore = new Date(now.getTime() - IDEMPOTENCY_ABANDONED_MS)
    if (
      existing.status === 'in_progress' &&
      existing.createdAt.getTime() <= abandonedBefore.getTime()
    ) {
      // Like a release: the dead request left no run behind, so any body may claim it.
      await executor
        .delete(idempotencyKeys)
        .where(
          and(
            where,
            eq(idempotencyKeys.status, 'in_progress'),
            lte(idempotencyKeys.createdAt, abandonedBefore)
          )
        )
      continue
    }
    if (existing.requestHash !== requestHash) throw keyReused()
    if (existing.status === 'completed' && existing.runId) {
      return { kind: 'replay', runId: existing.runId }
    }
    throw inProgress()
  }
  throw inProgress()
}

const inProgress = () =>
  new ApiError(
    409,
    'IDEMPOTENCY_IN_PROGRESS',
    'A request with this Idempotency-Key is still in progress; retry later'
  )

const keyReused = () =>
  new ApiError(
    422,
    'IDEMPOTENCY_KEY_REUSED',
    'This Idempotency-Key was already used with a different request'
  )

interface OwnedKey {
  organizationId: string
  key: string
  /**
   * The claim's `claimedAt`: only the `in_progress` row of THIS claim is
   * touched, never one another request made after reclaiming an abandoned key.
   */
  claimedAt?: Date
}

const ownedClaim = (options: OwnedKey) =>
  and(
    eq(idempotencyKeys.organizationId, options.organizationId),
    eq(idempotencyKeys.key, options.key),
    eq(idempotencyKeys.status, 'in_progress'),
    options.claimedAt
      ? eq(idempotencyKeys.createdAt, options.claimedAt)
      : undefined
  )

/** Marks the key as done with `runId` — call it inside the run's transaction. */
export async function completeIdempotencyKey(
  executor: Queryable,
  options: OwnedKey & { runId: string }
): Promise<void> {
  await executor
    .update(idempotencyKeys)
    .set({ status: 'completed', runId: options.runId })
    .where(ownedClaim(options))
}

/** Frees an `in_progress` key after a failed run, so the caller can retry. */
export async function releaseIdempotencyKey(
  executor: Queryable,
  options: OwnedKey
): Promise<void> {
  await executor.delete(idempotencyKeys).where(ownedClaim(options))
}

/** Deletes every key expired at `now`; returns how many (for the purge job). */
export async function purgeExpiredIdempotencyKeys(
  now: Date,
  executor: Queryable = db
): Promise<number> {
  const deleted = await executor
    .delete(idempotencyKeys)
    .where(lte(idempotencyKeys.expiresAt, now))
    .returning({ key: idempotencyKeys.key })
  return deleted.length
}
