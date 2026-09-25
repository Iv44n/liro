import { Arcton } from '@arcton/core'
import z from 'zod'
import {
  compileVersion,
  refineStorableJson,
  storableJsonIssues
} from '#modules/engine/compiled-cache'
import { executeRun } from '#modules/engine/executor'
import type { JsonObject } from '#modules/templates/paths'
import { parseRef } from '#modules/templates/versioning'
import { db } from '#shared/db/config'
import { withActor } from '#shared/http/actor'
import { readJson } from '#shared/http/body'
import {
  findIdempotentReplay,
  idempotencyKeyOf,
  idempotencyRequestHash
} from './idempotency'
import { type ResolvedDecision, resolveDecisionRef } from './resolve'
import {
  getPublicRun,
  getReplayedRun,
  listPublishedDecisions
} from './runs.service'
import {
  decisionContractView,
  type PublicRunView,
  publicRunView
} from './runs.views'

/** Limits on a run's caller-supplied `metadata` (stored as is, echoed back). */
export const METADATA_LIMITS = { keys: 50, bytes: 8 * 1024 } as const

/**
 * `metadata`'s values are whatever `JSON.parse` produced, i.e. JSON; they
 * are walked iteratively (NULs, nesting) instead of by a recursive JSON
 * schema, which a deeply nested value would overflow. The byte size is only
 * measured once the depth is known to be safe for `JSON.stringify`.
 */
const metadataSchema = z
  .record(z.string(), z.unknown())
  .superRefine((metadata, ctx) => {
    if (Object.keys(metadata).length > METADATA_LIMITS.keys) {
      ctx.addIssue({
        code: 'custom',
        message: `metadata may have at most ${METADATA_LIMITS.keys} keys`
      })
    }
    const issues = storableJsonIssues(metadata)
    for (const issue of issues) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
    }
    if (issues.length > 0) return
    const bytes = new TextEncoder().encode(JSON.stringify(metadata)).length
    if (bytes > METADATA_LIMITS.bytes) {
      ctx.addIssue({
        code: 'custom',
        message: `metadata may be at most ${METADATA_LIMITS.bytes} bytes of JSON`
      })
    }
  })
  .transform(metadata => metadata as JsonObject)

/**
 * `input` is checked against the version's contract by the executor; here
 * only for what must never reach the idempotency hash or the database (NULs,
 * nesting past `MAX_JSON_DEPTH`) — unknown keys the contract strips included.
 */
const runBodySchema = z.object({
  input: z.record(z.string(), z.unknown()).superRefine(refineStorableJson),
  metadata: metadataSchema.nullish()
})

interface RefHeaders {
  slug: string
  major: number | null
  deprecated: boolean
  floating: boolean
}

/** `Deprecation` for a deprecated version, `Warning` for a bare (floating) ref. */
function setRefHeaders(headers: Headers, ref: RefHeaders) {
  if (ref.deprecated) headers.set('Deprecation', 'true')
  if (ref.floating && ref.major !== null) {
    headers.set(
      'Warning',
      `299 - "Unpinned decision reference; pin a major version, e.g. ${ref.slug}@${ref.major}"`
    )
  }
}

/**
 * The stored run of a completed `Idempotency-Key`. Its headers describe the
 * run's own version (deprecated now or not), never what the ref resolves to
 * today; `Warning` still flags a bare ref, as the request wrote it.
 */
async function replayed(
  organizationId: string,
  runId: string,
  ref: string,
  headers: Headers
): Promise<PublicRunView> {
  const replay = await getReplayedRun(organizationId, runId)
  const parsed = parseRef(ref)
  setRefHeaders(headers, {
    slug: replay.slug,
    major: replay.major,
    deprecated: replay.deprecated,
    floating: parsed !== null && parsed.major === undefined
  })
  headers.set('Idempotent-Replayed', 'true')
  return replay.view
}

const refHeadersOf = (resolved: ResolvedDecision): RefHeaders => ({
  slug: resolved.template.slug,
  major: resolved.version.major,
  deprecated: resolved.deprecated,
  floating: resolved.floating
})

/** Public runtime: published decisions (`/v1/decisions`). */
export const publicDecisionsModule = Arcton({
  prefix: '/v1/decisions'
}).provide(withActor)

publicDecisionsModule.get('/', {
  detail: {
    summary: 'List the published decisions',
    tags: ['Decisions'],
    description:
      'Active templates with a runnable version: the latest published one (or the latest deprecated one when all are deprecated). Call each with its `ref` (`slug@M`): a bare slug only runs published versions.'
  },
  handler: async ({ actor }) => ({
    data: await listPublishedDecisions(actor.organizationId)
  })
})

publicDecisionsModule.get('/:ref', {
  detail: {
    summary: 'Describe a decision',
    tags: ['Decisions'],
    description:
      '`ref` is `slug`, `slug@major` or `slug@major.minor`. Returns the labels and the input JSON Schema of the version it resolves to.'
  },
  handler: async ({ actor, params, response }) => {
    const resolved = await resolveDecisionRef(actor.organizationId, params.ref)
    setRefHeaders(response.headers, refHeadersOf(resolved))
    return decisionContractView(
      resolved.template,
      resolved.version,
      resolved.deprecated
    )
  }
})

publicDecisionsModule.post('/:ref/run', {
  detail: {
    summary: 'Run a decision',
    tags: ['Decisions'],
    description:
      'Body `{ input, metadata? }`. Send an `Idempotency-Key` header to make retries safe (24 h): a retry of a completed request returns its stored run (`Idempotent-Replayed: true`) even if the ref has since moved, the template was archived or the version withdrawn. A `needs_review` result creates a review task; poll `GET /v1/runs/:id` for the final decision.'
  },
  handler: async ({ actor, params, request, response }) => {
    const { organizationId } = actor
    const key = idempotencyKeyOf(request.headers)
    const body = await readJson(request, runBodySchema)
    const metadata = body.metadata ?? undefined
    const idempotency = key
      ? {
          key,
          requestHash: idempotencyRequestHash({
            ref: params.ref,
            input: body.input,
            metadata,
            mode: actor.mode
          })
        }
      : undefined

    // Before resolving: a replay must not depend on what the ref points to now.
    if (idempotency) {
      const runId = await findIdempotentReplay(db, {
        organizationId,
        ...idempotency,
        now: new Date()
      })
      if (runId) {
        return replayed(organizationId, runId, params.ref, response.headers)
      }
    }

    const resolved = await resolveDecisionRef(organizationId, params.ref)
    const { template, version } = resolved

    const result = await executeRun({
      organizationId,
      template,
      version,
      compiled: compileVersion(version),
      input: body.input,
      metadata,
      mode: actor.mode,
      source: 'api',
      priority: 'live',
      apiKeyId: actor.apiKeyId,
      userId: actor.userId,
      ...(idempotency ? { idempotency } : {}),
      createReview: true,
      snapshotDefinition: false
    })

    if (result.replayed) {
      // Completed by a concurrent request since the lookup above.
      return replayed(
        organizationId,
        result.run.id,
        params.ref,
        response.headers
      )
    }
    setRefHeaders(response.headers, refHeadersOf(resolved))
    return publicRunView(
      result.run,
      {
        templateSlug: template.slug,
        templateName: template.name,
        major: version.major,
        minor: version.minor
      },
      result.review
    )
  }
})

/** Public runtime: run lookup, e.g. to poll a review (`/v1/runs`). */
export const publicRunsModule = Arcton({ prefix: '/v1/runs' }).provide(
  withActor
)

publicRunsModule.get('/:id', {
  detail: {
    summary: 'Get a run',
    tags: ['Decisions'],
    description:
      "One of the caller's organization runs — e.g. to poll a `needs_review` run until `finalDecision` is set."
  },
  handler: ({ actor, params }) => getPublicRun(actor.organizationId, params.id)
})
