import type { ModelRef } from '#modules/engine/evaluator/port'
import type { TemplateDefinition, TemplateKind } from './definition'
import type { GalleryTemplate } from './gallery'
import type { LintIssue } from './lint'
import type { JsonObject } from './paths'
import type {
  decisionTemplates,
  decisionTemplateVersions,
  StoreInputMode,
  VersionStatus
} from './templates.schemas'
import {
  compareVersions,
  type DefinitionChange,
  formatVersion,
  nextVersion,
  type VersionNumber
} from './versioning'

/**
 * Response shapes of the templates API (`/api/templates`, `/api/gallery`).
 * Pure functions of rows: the service loads what they need.
 */

export type TemplateRow = typeof decisionTemplates.$inferSelect
export type VersionRow = typeof decisionTemplateVersions.$inferSelect

/** A released (non-draft) version: its number is always set. */
export type ReleasedVersionRow = VersionRow & { major: number; minor: number }

export const isReleased = (row: VersionRow): row is ReleasedVersionRow =>
  row.status !== 'draft' && row.major !== null && row.minor !== null

/**
 * Codes that may appear in a draft's (or a publish's) `warnings`, with the
 * text the dashboard shows for each.
 */
export const TEMPLATE_WARNINGS = {
  MODEL_UNPINNED:
    'The model can change without notice; thresholds are not validated against a fixed version'
} as const

export type TemplateWarning = keyof typeof TEMPLATE_WARNINGS

// ── Templates ────────────────────────────────────────────────────────────

export interface LatestVersionView {
  id: string
  version: string
  major: number
  minor: number
  status: VersionStatus
  publishedAt: Date | null
}

export interface TemplateView {
  id: string
  slug: string
  name: string
  description: string | null
  kind: TemplateKind
  status: TemplateRow['status']
  storeInput: StoreInputMode
  retentionDays: number | null
  createdAt: Date
  updatedAt: Date
  /** A version was ever published: the slug can no longer change. */
  slugLocked: boolean
  hasDraft: boolean
  /** The highest-numbered non-draft version, whatever its status. */
  latestVersion: LatestVersionView | null
}

/** What `templateView` needs to know about a template's versions. */
export interface VersionSummary {
  id: string
  status: VersionStatus
  major: number | null
  minor: number | null
  publishedAt: Date | null
}

/** The highest-numbered released version among `versions`, or `null`. */
export function latestReleased<T extends VersionSummary>(
  versions: readonly T[]
): (T & VersionNumber) | null {
  let latest: (T & VersionNumber) | null = null
  for (const version of versions) {
    const { major, minor } = version
    if (version.status === 'draft' || major === null || minor === null) {
      continue
    }
    const candidate = { ...version, major, minor }
    if (latest === null || compareVersions(candidate, latest) > 0) {
      latest = candidate
    }
  }
  return latest
}

export function templateView(
  template: TemplateRow,
  versions: readonly VersionSummary[]
): TemplateView {
  const latest = latestReleased(versions)
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    description: template.description,
    kind: template.kind,
    status: template.status,
    storeInput: template.storeInput,
    retentionDays: template.retentionDays,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    slugLocked: latest !== null,
    hasDraft: versions.some(version => version.status === 'draft'),
    latestVersion: latest && {
      id: latest.id,
      version: formatVersion(latest),
      major: latest.major,
      minor: latest.minor,
      status: latest.status,
      publishedAt: latest.publishedAt
    }
  }
}

// ── Versions ─────────────────────────────────────────────────────────────

export interface VersionView {
  id: string
  version: string
  major: number
  minor: number
  status: VersionStatus
  definitionHash: string
  modelRef: ModelRef
  changelog: string | null
  publishedAt: Date | null
  publishedBy: string | null
  deprecatedAt: Date | null
  createdAt: Date
}

export interface VersionDetailView extends VersionView {
  definition: TemplateDefinition
  inputJsonSchema: Record<string, unknown> | null
}

export function versionView(row: ReleasedVersionRow): VersionView {
  return {
    id: row.id,
    version: formatVersion(row),
    major: row.major,
    minor: row.minor,
    status: row.status,
    definitionHash: row.definitionHash,
    modelRef: row.modelRef,
    changelog: row.changelog,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    deprecatedAt: row.deprecatedAt,
    createdAt: row.createdAt
  }
}

export function versionDetailView(row: ReleasedVersionRow): VersionDetailView {
  return {
    ...versionView(row),
    definition: row.definition,
    inputJsonSchema: row.inputJsonSchema
  }
}

// ── Draft ────────────────────────────────────────────────────────────────

export interface DraftView {
  id: string
  definition: TemplateDefinition
  /** Also the draft's `ETag`: send it back as `If-Match` / `expectedDraftHash`. */
  definitionHash: string
  updatedAt: Date
  lint: LintIssue[]
  /** Versus the latest non-draft version; `[]` before the first publish. */
  changes: DefinitionChange[]
  /** Some change requires publishing a new major. */
  breaking: boolean
  /** The number each kind of publish would get (both `1.0` before the first one). */
  nextVersion: { minor: string; major: string }
  /** The version `changes` are computed against. */
  basedOn: { id: string; version: string } | null
  warnings: TemplateWarning[]
}

export interface DraftViewInput {
  draft: VersionRow
  latest: ReleasedVersionRow | null
  lint: LintIssue[]
  changes: DefinitionChange[]
  warnings: TemplateWarning[]
}

export function draftView({
  draft,
  latest,
  lint,
  changes,
  warnings
}: DraftViewInput): DraftView {
  return {
    id: draft.id,
    definition: draft.definition,
    definitionHash: draft.definitionHash,
    updatedAt: draft.updatedAt,
    lint,
    changes,
    breaking: changes.some(change => change.severity === 'breaking'),
    nextVersion: {
      minor: formatVersion(nextVersion(latest, { major: false })),
      major: formatVersion(nextVersion(latest, { major: true }))
    },
    basedOn: latest && { id: latest.id, version: formatVersion(latest) },
    warnings
  }
}

// ── Gallery ──────────────────────────────────────────────────────────────

export interface GalleryItemView {
  id: string
  slug: string
  name: string
  description: string
  kind: TemplateKind
  definition: TemplateDefinition
  sampleInputs: JsonObject[]
}

export const galleryItemView = (
  template: GalleryTemplate
): GalleryItemView => ({
  id: template.id,
  slug: template.slug,
  name: template.name,
  description: template.description,
  kind: template.kind,
  definition: template.definition,
  sampleInputs: template.sampleInputs
})
