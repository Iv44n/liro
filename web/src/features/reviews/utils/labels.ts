import type {
  ReviewDecisionView,
  ReviewReason,
  ReviewStatus
} from '#/sdk/modules/reviews/types'

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Pendiente',
  resolved: 'Resuelta',
  dismissed: 'Descartada',
  expired: 'Expirada'
}

export const REVIEW_REASON_LABELS: Record<
  ReviewReason,
  { label: string; description: string }
> = {
  low_confidence: {
    label: 'Confianza baja',
    description:
      'La confianza no alcanzó el umbral mínimo de la decisión sugerida.'
  },
  always_review: {
    label: 'Siempre revisar',
    description: 'La decisión sugerida está configurada para revisarse siempre.'
  },
  rule: {
    label: 'Regla',
    description: 'Una regla o precondición envió la ejecución a revisión.'
  },
  fallback: {
    label: 'Sin regla',
    description:
      'Ninguna regla coincidió y la decisión por defecto es revisión humana.'
  }
}

/** The inbox's tabs (expired reviews are rare and only shown via the API). */
export const REVIEW_TABS = ['pending', 'resolved', 'dismissed'] as const
export type ReviewTab = (typeof REVIEW_TABS)[number]

export const REVIEW_TAB_LABELS: Record<ReviewTab, string> = {
  pending: 'Pendientes',
  resolved: 'Resueltas',
  dismissed: 'Descartadas'
}

export const isReviewTab = (value: unknown): value is ReviewTab =>
  typeof value === 'string' &&
  (REVIEW_TABS as readonly string[]).includes(value)

/** Up to 9 decisions get a number key (`1`..`9`), in the review's order. */
export const MAX_DECISION_SHORTCUTS = 9

export interface DecisionOption extends ReviewDecisionView {
  /** `'1'`..`'9'`, or `null` past the ninth decision. */
  shortcut: string | null
  suggested: boolean
}

/**
 * The review's buttons: every allowed decision with its description, its
 * number key and whether it is the engine's suggestion.
 */
export function decisionOptions(review: {
  allowedDecisions: readonly string[]
  decisions: readonly ReviewDecisionView[]
  suggestedDecision: string | null
}): DecisionOption[] {
  const descriptions = new Map(
    review.decisions.map(decision => [decision.label, decision.description])
  )
  return review.allowedDecisions.map((label, index) => ({
    label,
    description: descriptions.get(label) ?? null,
    shortcut: index < MAX_DECISION_SHORTCUTS ? String(index + 1) : null,
    suggested: label === review.suggestedDecision
  }))
}

/** The decision a number key picks, if any. */
export function decisionForKey(
  options: readonly DecisionOption[],
  key: string
): DecisionOption | undefined {
  return options.find(option => option.shortcut === key)
}

/**
 * Whether a keydown should be read as a review shortcut: not while typing,
 * not with modifiers, not when repeated.
 */
export function isShortcutEvent(event: {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  repeat?: boolean
  target: EventTarget | null
}): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
    return false
  }
  if (!/^[1-9]$/.test(event.key)) return false

  const target = event.target as {
    tagName?: string
    isContentEditable?: boolean
  } | null
  const tag = target?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false
  return !target?.isContentEditable
}
