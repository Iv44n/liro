import type {
  DefinitionChange,
  EntryType,
  InputField,
  JsonObject,
  LintIssue,
  ModelRef,
  TemplateDefinition,
  TemplateKind
} from '#/features/templates/types/definition'
import type { RunDetailView } from '#/sdk/modules/runs/types'

/**
 * Shapes of `/api/templates` (mirrors `api/src/modules/templates/
 * templates.views.ts` and the request schemas of `templates.service.ts`).
 * Dates are ISO strings.
 */

export const TEMPLATE_STATUSES = ['active', 'archived'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]
/** `GET /api/templates?status=`: `active` is the API default. */
export type TemplateStatusFilter = TemplateStatus | 'all'

/** What a run keeps of its input: all of it (minus `pii` fields), only what the policy reads, or nothing. */
export const STORE_INPUT_MODES = ['full', 'policy', 'none'] as const
export type StoreInputMode = (typeof STORE_INPUT_MODES)[number]

export const VERSION_STATUSES = [
  'draft',
  'published',
  'deprecated',
  /** The provider no longer serves the pinned model; runs are refused. */
  'model_unavailable'
] as const
export type VersionStatus = (typeof VERSION_STATUSES)[number]

/** Codes that may appear in a draft's (or a publish's) `warnings`. */
export const TEMPLATE_WARNINGS = ['MODEL_UNPINNED'] as const
export type TemplateWarning = (typeof TEMPLATE_WARNINGS)[number]

// ── Views ────────────────────────────────────────────────────────────────

export interface LatestVersionView {
  id: string
  /** `M.m`. */
  version: string
  major: number
  minor: number
  status: VersionStatus
  publishedAt: string | null
}

export interface TemplateView {
  id: string
  slug: string
  name: string
  description: string | null
  kind: TemplateKind
  status: TemplateStatus
  storeInput: StoreInputMode
  /** Days runs keep their stored input; `null` = forever. */
  retentionDays: number | null
  createdAt: string
  updatedAt: string
  /** A version was ever published: the slug can no longer change. */
  slugLocked: boolean
  hasDraft: boolean
  /** The highest-numbered non-draft version, whatever its status. */
  latestVersion: LatestVersionView | null
}

export interface VersionView {
  id: string
  /** `M.m`. */
  version: string
  major: number
  minor: number
  status: VersionStatus
  definitionHash: string
  modelRef: ModelRef
  changelog: string | null
  publishedAt: string | null
  /** User id. */
  publishedBy: string | null
  deprecatedAt: string | null
  createdAt: string
}

export interface VersionDetailView extends VersionView {
  definition: TemplateDefinition
  /** JSON Schema of the input contract, computed at publish time. */
  inputJsonSchema: Record<string, unknown> | null
}

export interface DraftView {
  id: string
  definition: TemplateDefinition
  /** Also the draft's `ETag`: send it back as `If-Match` / `expectedDraftHash`. */
  definitionHash: string
  updatedAt: string
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

/**
 * A draft and its entity tag. `etag` is the bare `definitionHash` (no
 * quotes): pass it to `saveDraft` as `ifMatch` and to `publish` as
 * `expectedDraftHash`.
 */
export interface DraftWithEtag {
  draft: DraftView
  etag: string
}

// ── Requests ─────────────────────────────────────────────────────────────

export interface WizardLabel {
  /** A label (`LABEL_PATTERN`). */
  label: string
  description?: string
  criteria?: EntryType | null
}

/** Where a new template's first draft comes from. */
export type TemplateSource =
  | { type: 'blank'; kind: TemplateKind }
  | { type: 'gallery'; id: string }
  | {
      type: 'classify'
      fields?: InputField[]
      instructions: EntryType
      /** ≥ 2 labels. */
      labels: WizardLabel[]
      /** In [0, 1]; the API default is 0.8. */
      minConfidence?: number
      questionId?: string
    }
  | {
      type: 'decide'
      fields?: InputField[]
      instructions: EntryType
      yes: WizardLabel
      no: WizardLabel
      /** P(sí) ≥ this → yes. In (0.5, 1]; the API default is 0.9. */
      yesThreshold?: number
      /** P(sí) ≤ this → no. In [0, 0.5); the API default is 0.1. */
      noThreshold?: number
      questionId?: string
    }
  | {
      type: 'score'
      fields?: InputField[]
      instructions: EntryType
      /** Ordered levels, worst to best (2..10). */
      levels: WizardLabel[]
      /** In [0, 1]; the API default is 0.8. */
      minConfidence?: number
      questionId?: string
    }
  | { type: 'definition'; definition: TemplateDefinition }

export type TemplateSourceType = TemplateSource['type']

export interface CreateTemplateRequest {
  /** 1..120 chars (trimmed). */
  name: string
  /** Default: the gallery template's slug, else `slugify(name)`. */
  slug?: string
  /** ≤ 2000 chars. */
  description?: string | null
  storeInput?: StoreInputMode
  retentionDays?: number | null
  source: TemplateSource
}

export interface CreateTemplateResponse {
  template: TemplateView
  draft: DraftView
}

/** The slug can no longer change once a version is published (409 `SLUG_LOCKED`). */
export interface UpdateTemplateRequest {
  name?: string
  description?: string | null
  slug?: string
  storeInput?: StoreInputMode
  retentionDays?: number | null
}

export interface ListTemplatesParams {
  status?: TemplateStatusFilter
}

export interface PublishRequest {
  /** The draft's current `definitionHash` (its ETag, unquoted). */
  expectedDraftHash: string
  /** Required when the draft has breaking changes. */
  major?: boolean
  /** ≤ 2000 chars. */
  changelog?: string
}

export interface PublishResponse {
  version: VersionView
  changes: DefinitionChange[]
  warnings: TemplateWarning[]
}

// ── Lint (`POST /api/templates/lint`) ─────────────────────────────────────

export interface LintRequest {
  definition: TemplateDefinition
  /**
   * Also diff `definition` against this template's latest published
   * version (the same diff a draft shows), without writing anything.
   */
  templateId?: string
}

export interface LintResponse {
  lint: LintIssue[]
  /** Present only when the request named a `templateId`. */
  changes?: DefinitionChange[]
}

// ── Playground (`POST /api/templates/:id/draft/test`) ────────────────────

export type TokenBudgetStatus = 'ok' | 'warn' | 'reject'

export interface RunTrace {
  /** What was sent to Jev; `null` when it wasn't called. */
  state: JsonObject | null
  /** Question ids asked (empty when a precondition decided). */
  questions: string[]
  /** `null` when no evaluation was needed. */
  tokens: {
    estimate: number
    limit: number
    status: TokenBudgetStatus
  } | null
}

export interface PlaygroundTestRequest {
  input: Record<string, unknown>
  /** The editor's unsaved state; default: the saved draft. */
  definition?: TemplateDefinition
}

export interface PlaygroundTestResponse {
  /** A test-mode, `playground`-source run (`version` is `null`). */
  run: RunDetailView
  lint: LintIssue[]
  trace: RunTrace
}

// ── Error details (`AppError.details`) ───────────────────────────────────

/** 422 `VALIDATION_FAILED`: `path` is dotted, e.g. `source.labels.0.label` or `input.message`. */
export interface ValidationIssue {
  path: string
  message: string
  code: string
}

export interface ValidationFailedDetails {
  issues: ValidationIssue[]
}

/** 422 `LINT_FAILED` (publish, playground). */
export interface LintFailedDetails {
  issues: LintIssue[]
}

/** 409 `DRAFT_CONFLICT`: the draft's hash now (`null` if it has none). */
export interface DraftConflictDetails {
  currentHash: string | null
}

/** 409 `SLUG_TAKEN`. */
export interface SlugTakenDetails {
  slug: string
}

/** 422 `BREAKING_CHANGES`: publish again with `major: true`. */
export interface BreakingChangesDetails {
  changes: DefinitionChange[]
}

/** 409 `NO_CHANGES`: the draft equals this version. */
export interface NoChangesDetails {
  version: string
}

/** 409 `VERSION_NOT_PUBLISHED` / `VERSION_NOT_DEPRECATED`. */
export interface VersionStatusDetails {
  status: VersionStatus
}

/** 422 `INPUT_TOO_LARGE` (runs). */
export interface InputTooLargeDetails {
  estimatedTokens: number
  maxContextTokens: number
}
