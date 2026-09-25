import { type PublicAnswer, publicAnswers } from '#modules/engine/answers'
import {
  publicEvaluatorError,
  type ReviewRow,
  type RunRow
} from '#modules/engine/executor'
import type { ReviewReason } from '#modules/engine/types'
import type { ReviewStatus } from '#modules/reviews/reviews.schemas'
import type { TemplateKind } from '#modules/templates/definition'
import { decisionLabels } from '#modules/templates/definition'
import { inputJsonSchema } from '#modules/templates/input-schema'
import type { JsonObject } from '#modules/templates/paths'
import { formatVersion } from '#modules/templates/versioning'
import type { TemplateRow, VersionRow } from './resolve'
import type { RunMode, RunSource, RunStatus } from './runs.schemas'

/**
 * Response shapes of runs. `PublicRunView` is the `/v1` contract (no
 * provider, no stored input, no provider error text); the dashboard's
 * `RunDetailView` adds the operational fields; `RunSummaryView` is a
 * runs-explorer row. `answers` and `signals` are diagnostic, outside the
 * versioned contract.
 */

const round = (value: number) => Math.round(value * 10_000) / 10_000

const roundOrNull = (value: number | null) =>
  value === null ? null : round(value)

function roundSignals(
  signals: Record<string, number | null> | null
): Record<string, number | null> | null {
  if (!signals) return null
  return Object.fromEntries(
    Object.entries(signals).map(([name, value]) => [name, roundOrNull(value)])
  )
}

/**
 * The version a run reports: `M.m`, or `null` for a playground run (it ran
 * the draft, whatever that draft later became) and for draft rows.
 */
export function runVersionLabel(
  source: RunSource,
  major: number | null,
  minor: number | null
): string | null {
  if (source === 'playground' || major === null || minor === null) return null
  return formatVersion({ major, minor })
}

/** What a view needs besides the run row. */
export interface RunContext {
  templateSlug: string
  templateName: string
  major: number | null
  minor: number | null
}

export type RunReview = Pick<
  ReviewRow,
  'id' | 'status' | 'reason' | 'resolvedDecision' | 'resolvedAt'
>

export interface PublicReviewView {
  id: string
  status: ReviewStatus
  reason: ReviewReason
  resolvedDecision: string | null
  resolvedAt: Date | null
}

export interface PublicRunView {
  id: string
  /** The template's slug. */
  template: string
  version: string | null
  mode: RunMode
  source: RunSource
  status: RunStatus
  decision: string | null
  finalDecision: string | null
  confidence: number | null
  suggestion: string | null
  flags: string[]
  rule: string | null
  reviewReason: ReviewReason | null
  review: PublicReviewView | null
  answers: Record<string, PublicAnswer | null> | null
  signals: Record<string, number | null> | null
  metadata: JsonObject | null
  model: string | null
  latencyMs: number | null
  createdAt: Date
  completedAt: Date | null
  /**
   * A failed run's error as the run request answered it (`JEV_TIMEOUT`,
   * `EVALUATOR_ERROR`, …, with a fixed message): the evaluator's own code
   * and message can carry provider/infrastructure details.
   */
  error: { code: string; message: string } | null
}

function publicRunError(run: RunRow): { code: string; message: string } | null {
  if (!run.errorCode) return null
  const { code, message } = publicEvaluatorError(run.errorCode)
  return { code, message }
}

export function publicRunView(
  run: RunRow,
  context: RunContext,
  review: RunReview | null
): PublicRunView {
  return {
    id: run.id,
    template: context.templateSlug,
    version: runVersionLabel(run.source, context.major, context.minor),
    mode: run.mode,
    source: run.source,
    status: run.status,
    decision: run.decision,
    finalDecision: run.finalDecision,
    confidence: roundOrNull(run.confidence),
    suggestion: run.suggestion,
    flags: run.flags,
    rule: run.rule,
    reviewReason: run.reviewReason,
    review: review
      ? {
          id: review.id,
          status: review.status,
          reason: review.reason,
          resolvedDecision: review.resolvedDecision,
          resolvedAt: review.resolvedAt
        }
      : null,
    answers: run.answers ? publicAnswers(run.answers) : null,
    signals: roundSignals(run.signals),
    metadata: run.metadata,
    model: run.modelResolved ?? run.modelRequested ?? null,
    latencyMs: run.latencyMs,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    error: publicRunError(run)
  }
}

export interface RunDetailView extends PublicRunView {
  templateId: string
  templateName: string
  versionId: string
  input: JsonObject | null
  policyInput: JsonObject
  provider: string | null
  modelRequested: string | null
  modelResolved: string | null
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  evaluatorLatencyMs: number | null
  apiKeyId: string | null
  userId: string | null
  definitionHash: string
  engineVersion: string
  /** The evaluator's own error code (`AUTH`, `BAD_RESPONSE`, …) and message, for diagnosis. */
  evaluatorError: { code: string; message: string } | null
}

export function runDetailView(
  run: RunRow,
  context: RunContext,
  review: RunReview | null
): RunDetailView {
  return {
    ...publicRunView(run, context, review),
    templateId: run.templateId,
    templateName: context.templateName,
    versionId: run.versionId,
    input: run.input,
    policyInput: run.policyInput,
    provider: run.provider,
    modelRequested: run.modelRequested,
    modelResolved: run.modelResolved,
    providerRequestId: run.providerRequestId,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    evaluatorLatencyMs: run.evaluatorLatencyMs,
    apiKeyId: run.apiKeyId,
    userId: run.userId,
    definitionHash: run.definitionHash,
    engineVersion: run.engineVersion,
    evaluatorError: run.errorCode
      ? { code: run.errorCode, message: run.errorMessage ?? '' }
      : null
  }
}

export interface RunSummaryView {
  id: string
  templateId: string
  templateSlug: string
  templateName: string
  version: string | null
  mode: RunMode
  source: RunSource
  status: RunStatus
  decision: string | null
  finalDecision: string | null
  confidence: number | null
  flags: string[]
  /** `null` when the run has no review task. */
  reviewStatus: ReviewStatus | null
  latencyMs: number | null
  createdAt: Date
}

/** A runs-explorer row, as selected by `listRuns`. */
export interface RunSummaryRow {
  id: string
  templateId: string
  templateSlug: string
  templateName: string
  major: number | null
  minor: number | null
  mode: RunMode
  source: RunSource
  status: RunStatus
  decision: string | null
  finalDecision: string | null
  confidence: number | null
  flags: string[]
  reviewStatus: ReviewStatus | null
  latencyMs: number | null
  createdAt: Date
}

export function runSummaryView(row: RunSummaryRow): RunSummaryView {
  return {
    id: row.id,
    templateId: row.templateId,
    templateSlug: row.templateSlug,
    templateName: row.templateName,
    version: runVersionLabel(row.source, row.major, row.minor),
    mode: row.mode,
    source: row.source,
    status: row.status,
    decision: row.decision,
    finalDecision: row.finalDecision,
    confidence: roundOrNull(row.confidence),
    flags: row.flags,
    reviewStatus: row.reviewStatus,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt
  }
}

// ── Published decisions (`/v1/decisions`) ────────────────────────────────

interface DecisionView {
  slug: string
  name: string
  description: string | null
  kind: TemplateKind
  version: string
  labels: string[]
  /** JSON Schema of the input contract. */
  inputSchema: Record<string, unknown>
  deprecated: boolean
}

export interface DecisionSummaryView extends DecisionView {
  /**
   * The pinned ref (`slug@M`) that runs the listed version. A bare slug only
   * runs published versions, so it can't call a template whose versions are
   * all deprecated; `slug@M` falls back to the highest deprecated `M.x`.
   */
  ref: string
}

export interface DecisionContractView extends DecisionView {
  decisions: { label: string; description: string | null }[]
}

const versionOf = (version: VersionRow): string =>
  formatVersion({ major: version.major ?? 0, minor: version.minor ?? 0 })

function decisionView(
  template: TemplateRow,
  version: VersionRow,
  deprecated: boolean
): DecisionView {
  const { definition } = version
  return {
    slug: template.slug,
    name: template.name,
    description: template.description,
    kind: definition.kind,
    version: versionOf(version),
    labels: decisionLabels(definition),
    inputSchema:
      version.inputJsonSchema ?? inputJsonSchema(definition.input.fields),
    deprecated
  }
}

export function decisionSummaryView(
  template: TemplateRow,
  version: VersionRow,
  deprecated: boolean
): DecisionSummaryView {
  return {
    ...decisionView(template, version, deprecated),
    ref: `${template.slug}@${version.major ?? 0}`
  }
}

export function decisionContractView(
  template: TemplateRow,
  version: VersionRow,
  deprecated: boolean
): DecisionContractView {
  return {
    ...decisionView(template, version, deprecated),
    decisions: version.definition.decisions.map(decision => ({
      label: decision.label,
      description: decision.description ?? null
    }))
  }
}
