import type { PublicAnswer } from '#modules/engine/answers'
import type { ReviewRow, RunRow } from '#modules/engine/executor'
import type { ReviewReason } from '#modules/engine/types'
import type { RunMode } from '#modules/runs/runs.schemas'
import { publicRunView } from '#modules/runs/runs.views'
import type { TemplateDefinition } from '#modules/templates/definition'
import type { JsonObject } from '#modules/templates/paths'
import type { ReviewStatus } from './reviews.schemas'

/**
 * Response shapes of the review inbox (`/api/reviews`). Pure functions of
 * rows: the service loads what they need. The run's numbers go through
 * `publicRunView`, so a reviewer sees exactly what `/v1` callers see.
 */

/** The run under review, as the inbox shows it. */
export interface ReviewRunView {
  id: string
  mode: RunMode
  /** `M.m` of the version that ran. */
  version: string | null
  /** Always `needs_review` for a run with a review task. */
  decision: string | null
  confidence: number | null
  flags: string[]
  rule: string | null
  /** Diagnostic: every answer with its probabilities (4 decimals). */
  answers: Record<string, PublicAnswer | null> | null
  signals: Record<string, number | null> | null
  /** As stored per the template's `storeInput` (never `pii` fields); `null` when not kept. */
  input: JsonObject | null
  createdAt: Date
}

/** One button of the review: an allowed decision and what it means. */
export interface ReviewDecisionView {
  label: string
  description: string | null
}

export interface ReviewView {
  id: string
  status: ReviewStatus
  reason: ReviewReason
  /** What the engine would have decided; `null` when it had no candidate. */
  suggestedDecision: string | null
  /** What `resolve` accepts: the version's labels (`needs_review` excluded). */
  allowedDecisions: string[]
  /** `null` unless `status` is `resolved`. */
  resolvedDecision: string | null
  /** Who closed the review (resolved or dismissed) and when. */
  resolvedBy: { id: string; name: string } | null
  resolvedAt: Date | null
  comment: string | null
  createdAt: Date
  template: { id: string; slug: string; name: string }
  run: ReviewRunView
  /** `allowedDecisions` with their descriptions from the run's version, in the same order. */
  decisions: ReviewDecisionView[]
}

/** Everything `reviewView` needs, as `reviews.service` loads it. */
export interface ReviewRecord {
  review: ReviewRow
  run: RunRow
  template: { id: string; slug: string; name: string }
  version: { major: number | null; minor: number | null }
  /** The run's version definition (the run's own snapshot wins when it has one). */
  definition: TemplateDefinition | null
  resolver: { id: string; name: string } | null
}

function decisionViews(
  allowed: readonly string[],
  definition: TemplateDefinition | null
): ReviewDecisionView[] {
  const descriptions = new Map(
    (definition?.decisions ?? []).map(decision => [
      decision.label,
      decision.description ?? null
    ])
  )
  return allowed.map(label => ({
    label,
    description: descriptions.get(label) ?? null
  }))
}

export function reviewView(record: ReviewRecord): ReviewView {
  const { review, run, template, version } = record
  const publicRun = publicRunView(
    run,
    {
      templateSlug: template.slug,
      templateName: template.name,
      major: version.major,
      minor: version.minor
    },
    null
  )
  return {
    id: review.id,
    status: review.status,
    reason: review.reason,
    suggestedDecision: review.suggestedDecision,
    allowedDecisions: review.allowedDecisions,
    resolvedDecision: review.resolvedDecision,
    resolvedBy: record.resolver,
    resolvedAt: review.resolvedAt,
    comment: review.comment,
    createdAt: review.createdAt,
    template: { id: template.id, slug: template.slug, name: template.name },
    run: {
      id: run.id,
      mode: run.mode,
      version: publicRun.version,
      decision: publicRun.decision,
      confidence: publicRun.confidence,
      flags: publicRun.flags,
      rule: publicRun.rule,
      answers: publicRun.answers,
      signals: publicRun.signals,
      input: run.input,
      createdAt: run.createdAt
    },
    decisions: decisionViews(
      review.allowedDecisions,
      run.definition ?? record.definition
    )
  }
}
