import {
  NEEDS_REVIEW,
  type TemplateDefinition
} from '#/features/templates/types/definition'
import type { ReviewReason } from '#/sdk/modules/reviews/types'
import type {
  PublicAnswer,
  PublicAnswers,
  RunMode
} from '#/sdk/modules/runs/types'
import type { TokenBudgetStatus } from '#/sdk/modules/templates/types'

/** Spanish formatting of run results, shared by the playground and Integrar. */

const percentFormat = new Intl.NumberFormat('es', {
  style: 'percent',
  maximumFractionDigits: 1
})

const integerFormat = new Intl.NumberFormat('es')

const decimalFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 3 })

/** `0.934` → `93,4 %`; `null` → `—`. */
export const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : percentFormat.format(value)

export const formatInteger = (value: number): string =>
  integerFormat.format(Math.round(value))

export const formatDecimal = (value: number): string =>
  decimalFormat.format(value)

/** `840` → `840 ms`; `1530` → `1,53 s`; `null` → `—`. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${formatInteger(ms)} ms`
  return `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(ms / 1000)} s`
}

/** A 0..1 value clamped, for bar widths. */
export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

export const isNeedsReview = (decision: string | null | undefined): boolean =>
  decision === NEEDS_REVIEW

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  low_confidence: 'Confianza baja',
  always_review: 'Siempre revisar',
  rule: 'Regla',
  fallback: 'Sin regla'
}

export const REVIEW_REASON_DESCRIPTIONS: Record<ReviewReason, string> = {
  low_confidence:
    'La confianza no alcanzó el umbral mínimo de la etiqueta sugerida.',
  always_review: 'La etiqueta sugerida está marcada para revisar siempre.',
  rule: 'Una regla o precondición envió la ejecución a revisión.',
  fallback: 'Ninguna regla coincidió y el fallback es revisión humana.'
}

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  live: 'Live',
  test: 'Prueba'
}

export const TOKEN_STATUS_LABELS: Record<TokenBudgetStatus, string> = {
  ok: 'Dentro del límite',
  warn: 'Cerca del límite',
  reject: 'Supera el límite'
}

// ── Policy stage ─────────────────────────────────────────────────────────

export type PolicyStage = 'precondition' | 'rule' | 'fallback'

export interface StageView {
  stage: PolicyStage
  /** The rule id, `null` for the fallback. */
  ruleId: string | null
  /** The rule's `name`, when the definition gives one. */
  ruleName: string | null
  /** Spanish, e.g. `Precondición` / `Regla n.º 2`. */
  label: string
}

/**
 * Which part of the policy decided, from the run's `rule` and the definition
 * that ran (the API does not return the stage): a precondition id, a rule id
 * or — without a rule — the fallback. An id the definition no longer has is
 * reported as a rule.
 */
export function describeStage(
  rule: string | null,
  definition: Pick<TemplateDefinition, 'preconditions' | 'rules'>
): StageView {
  if (rule === null) {
    return {
      stage: 'fallback',
      ruleId: null,
      ruleName: null,
      label: 'Fallback (ninguna regla coincidió)'
    }
  }
  const preconditionIndex = definition.preconditions.findIndex(
    precondition => precondition.id === rule
  )
  if (preconditionIndex >= 0) {
    return {
      stage: 'precondition',
      ruleId: rule,
      ruleName: definition.preconditions[preconditionIndex]?.name ?? null,
      label: `Precondición n.º ${preconditionIndex + 1}`
    }
  }
  const ruleIndex = definition.rules.findIndex(
    candidate => candidate.id === rule
  )
  return {
    stage: 'rule',
    ruleId: rule,
    ruleName:
      ruleIndex >= 0 ? (definition.rules[ruleIndex]?.name ?? null) : null,
    label: ruleIndex >= 0 ? `Regla n.º ${ruleIndex + 1}` : 'Regla'
  }
}

// ── Answers ──────────────────────────────────────────────────────────────

export interface ProbabilityRow {
  /** Option name, level label, or `sí`/`no`. */
  label: string
  probability: number
  /** The chosen option / most probable level / the boolean's side. */
  selected: boolean
}

export interface AnswerView {
  id: string
  type: PublicAnswer['type'] | null
  /** `null` when the question was not asked. */
  answer: PublicAnswer | null
  /** Bars in display order (choice: most probable first; score: level order). */
  rows: ProbabilityRow[]
  /** Short Spanish summary, e.g. `bug`, `medium (1,2 de 2)`, `Sí (P = 93 %)`. */
  summary: string
  confidence: number | null
}

function choiceRows(
  answer: Extract<PublicAnswer, { type: 'choice' }>,
  options: readonly string[]
): ProbabilityRow[] {
  const probabilities = answer.probabilities ?? {}
  const names = [
    ...options,
    ...Object.keys(probabilities).filter(name => !options.includes(name))
  ]
  if (names.length === 0) names.push(answer.choice)
  return names
    .map(name => ({
      label: name,
      probability:
        probabilities[name] ??
        (answer.probabilities === null && name === answer.choice ? 1 : 0),
      selected: name === answer.choice
    }))
    .sort((a, b) => b.probability - a.probability)
}

function scoreRows(
  answer: Extract<PublicAnswer, { type: 'score' }>,
  levels: readonly string[]
): ProbabilityRow[] {
  const probabilities = answer.probabilities ?? {}
  const labels = levels.length > 0 ? levels : Object.keys(probabilities)
  return labels.map(label => ({
    label,
    probability:
      probabilities[label] ??
      (answer.probabilities === null && label === answer.level ? 1 : 0),
    selected: label === answer.level
  }))
}

/** One question's answer as `answerViews` shows it. */
function answerView(
  id: string,
  answer: PublicAnswer | null,
  question: TemplateDefinition['questions'][string] | undefined
): AnswerView {
  if (!answer) {
    return {
      id,
      type: question?.type ?? null,
      answer: null,
      rows: [],
      summary: 'No se preguntó',
      confidence: null
    }
  }
  switch (answer.type) {
    case 'choice': {
      const options =
        question?.type === 'choice' ? Object.keys(question.criteria) : []
      return {
        id,
        type: 'choice',
        answer,
        rows: choiceRows(answer, options),
        summary: answer.choice,
        confidence: answer.confidence
      }
    }
    case 'score': {
      const levels =
        question?.type === 'score'
          ? question.levels.map(level => level.label)
          : []
      const rows = scoreRows(answer, levels)
      const max = Math.max(rows.length - 1, 1)
      return {
        id,
        type: 'score',
        answer,
        rows,
        summary: `${answer.level} (${formatDecimal(answer.score)} de ${max})`,
        confidence: answer.confidence
      }
    }
    case 'boolean':
      return {
        id,
        type: 'boolean',
        answer,
        rows: [
          {
            label: 'Sí',
            probability: answer.probability,
            selected: answer.probability >= 0.5
          },
          {
            label: 'No',
            probability: 1 - answer.probability,
            selected: answer.probability < 0.5
          }
        ],
        summary: `${answer.probability >= 0.5 ? 'Sí' : 'No'} · P(sí) = ${formatPercent(answer.probability)}`,
        confidence: answer.confidence
      }
  }
}

/**
 * The run's answers in the definition's question order (then any other
 * answered question), with probability bars per option / level / side.
 */
export function answerViews(
  answers: PublicAnswers | null,
  definition: Pick<TemplateDefinition, 'questions'>
): AnswerView[] {
  if (!answers) return []
  const ids = [
    ...Object.keys(definition.questions).filter(id => id in answers),
    ...Object.keys(answers).filter(id => !(id in definition.questions))
  ]

  return ids.map(id =>
    answerView(id, answers[id] ?? null, definition.questions[id])
  )
}
