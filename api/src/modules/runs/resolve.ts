import { and, eq, ne } from 'drizzle-orm'
import {
  type decisionTemplates,
  decisionTemplateVersions
} from '#modules/templates/templates.schemas'
import {
  compareVersions,
  parseRef,
  resolveRef,
  type VersionCandidate
} from '#modules/templates/versioning'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'

export type TemplateRow = typeof decisionTemplates.$inferSelect
export type VersionRow = typeof decisionTemplateVersions.$inferSelect

export interface ResolvedDecision {
  template: TemplateRow
  version: VersionRow
  /** A deprecated version: it still runs, with a `Deprecation` header. */
  deprecated: boolean
  /** Picked by a bare slug: the caller gets a `Warning` header. */
  floating: boolean
}

/**
 * `slug@M` of the highest deprecated version, when deprecated versions are
 * all a bare slug found (`GET /v1/decisions` lists such a template with
 * that `ref`); `null` otherwise.
 */
function deprecatedOnlyRef(
  slug: string,
  candidates: readonly VersionCandidate[]
): string | null {
  const highest = candidates
    .filter(candidate => candidate.status === 'deprecated')
    .reduce<VersionCandidate | null>(
      (best, candidate) =>
        !best || compareVersions(candidate, best) > 0 ? candidate : best,
      null
    )
  return highest ? `${slug}@${highest.major}` : null
}

/**
 * The template and version a `/v1/decisions/:ref` reference points to,
 * within the caller's organization (see `resolveRef` for how `slug`,
 * `slug@1` and `slug@1.2` choose a version).
 */
export async function resolveDecisionRef(
  organizationId: string,
  ref: string
): Promise<ResolvedDecision> {
  const parsed = parseRef(ref)
  if (!parsed) {
    throw new ApiError(
      400,
      'INVALID_REF',
      'Invalid decision reference: expected <slug>, <slug>@<major> or <slug>@<major>.<minor>',
      { details: { ref } }
    )
  }

  const template = await db.query.decisionTemplates.findFirst({
    where: { organizationId, slug: parsed.slug }
  })
  if (!template) {
    throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Decision not found', {
      details: { slug: parsed.slug }
    })
  }
  if (template.status === 'archived') {
    throw new ApiError(410, 'TEMPLATE_ARCHIVED', 'This decision was archived', {
      details: { slug: template.slug }
    })
  }

  const rows = await db
    .select({
      id: decisionTemplateVersions.id,
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor,
      status: decisionTemplateVersions.status
    })
    .from(decisionTemplateVersions)
    .where(
      and(
        eq(decisionTemplateVersions.templateId, template.id),
        eq(decisionTemplateVersions.organizationId, organizationId),
        ne(decisionTemplateVersions.status, 'draft')
      )
    )
  const candidates = rows.filter(
    (row): row is VersionCandidate => row.major !== null && row.minor !== null
  )

  const resolved = resolveRef(candidates, parsed)
  if (!resolved) {
    const pinned =
      parsed.major === undefined
        ? deprecatedOnlyRef(template.slug, candidates)
        : null
    throw new ApiError(
      404,
      'VERSION_NOT_FOUND',
      pinned
        ? `Every version of this decision is deprecated, and a bare slug only runs published ones: pin a version, e.g. ${pinned}`
        : 'No version of this decision matches the reference',
      { details: pinned ? { ref, suggestedRef: pinned } : { ref } }
    )
  }
  if (resolved.version.status === 'model_unavailable') {
    throw new ApiError(
      409,
      'VERSION_UNAVAILABLE',
      'This version pins a model the provider no longer serves; publish a new version',
      { details: { ref, reason: 'model_unavailable' } }
    )
  }

  const version = await db.query.decisionTemplateVersions.findFirst({
    where: { id: resolved.version.id, organizationId }
  })
  if (!version) {
    throw new ApiError(
      404,
      'VERSION_NOT_FOUND',
      'No version of this decision matches the reference',
      { details: { ref } }
    )
  }

  return {
    template,
    version,
    deprecated: resolved.deprecated,
    floating: resolved.floating
  }
}
