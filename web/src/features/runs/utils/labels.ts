import { NEEDS_REVIEW } from '#/features/templates/types/definition'
import type { RunMode, RunSource, RunStatus } from '#/sdk/modules/runs/types'

/** Spanish names of a run's attributes, for badges and filters. */

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  live: 'Producción',
  test: 'Prueba'
}

export const RUN_SOURCE_LABELS: Record<RunSource, string> = {
  api: 'API',
  playground: 'Playground',
  review: 'Revisión',
  evaluation: 'Evaluación'
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  succeeded: 'Completada',
  failed: 'Fallida'
}

export const NEEDS_REVIEW_LABEL = 'Revisión humana'

/** Whether `decision` sends the run to a human (`needs_review`). */
export const isNeedsReview = (decision: string | null | undefined) =>
  decision === NEEDS_REVIEW

/** A decision as the UI names it (`needs_review` → `Revisión humana`). */
export function decisionText(decision: string | null | undefined): string {
  if (!decision) return 'Sin decisión'
  return isNeedsReview(decision) ? NEEDS_REVIEW_LABEL : decision
}

/**
 * What a run ended with, for the runs table: the engine's decision and, when
 * a reviewer changed it, the final one (`needs_review` → `spam`).
 */
export interface DecisionOutcome {
  decision: string | null
  /** Set when it differs from `decision` (e.g. after a review). */
  finalDecision: string | null
  /** In review and nobody has decided yet. */
  awaitingReview: boolean
}

export function decisionOutcome(run: {
  decision: string | null
  finalDecision: string | null
}): DecisionOutcome {
  const { decision, finalDecision } = run
  return {
    decision,
    finalDecision:
      finalDecision !== null && finalDecision !== decision
        ? finalDecision
        : null,
    awaitingReview: isNeedsReview(decision) && finalDecision === null
  }
}
