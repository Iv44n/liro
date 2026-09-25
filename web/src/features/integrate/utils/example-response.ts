import {
  NEEDS_REVIEW,
  type QuestionDef,
  type TemplateDefinition
} from '#/features/templates/types/definition'
import type { PublicAnswer, PublicRunView } from '#/sdk/modules/runs/types'

/**
 * An illustrative `PublicRunView` for a version, as the Integrar tab shows
 * it: the first declared label decided with high confidence, and plausible
 * answers for each question. Values are examples, not predictions.
 */

const EXAMPLE_ID = '0199c5a2-7b3e-7c1d-9a4f-2e8b6d1c0f3a'
const EXAMPLE_TIME = '2026-01-01T12:00:00.000Z'
const EXAMPLE_DONE = '2026-01-01T12:00:01.240Z'

const round = (value: number) => Math.round(value * 10_000) / 10_000

/** `top` for the first name, the rest shared evenly. */
function distribution(names: readonly string[], top = 0.9) {
  if (names.length === 0) return {}
  if (names.length === 1) return { [names[0] as string]: 1 }
  const rest = round((1 - top) / (names.length - 1))
  return Object.fromEntries(
    names.map((name, index) => [name, index === 0 ? top : rest])
  )
}

/** K-way confidence `(K·p_max − 1)/(K − 1)`, as the engine computes it. */
const confidenceOf = (top: number, k: number) =>
  k > 1 ? round((k * top - 1) / (k - 1)) : 1

function exampleAnswer(question: QuestionDef): PublicAnswer {
  switch (question.type) {
    case 'choice': {
      const options = Object.keys(question.criteria)
      return {
        type: 'choice',
        choice: options[0] ?? 'option',
        probabilities: distribution(options),
        confidence: confidenceOf(0.9, options.length)
      }
    }
    case 'score': {
      const labels = question.levels.map(level => level.label)
      const index = Math.floor((labels.length - 1) / 2)
      const ordered = [
        labels[index] as string,
        ...labels.filter((_, i) => i !== index)
      ]
      const probabilities = distribution(ordered, 0.8)
      return {
        type: 'score',
        score: index,
        level: labels[index] ?? 'level',
        probabilities: Object.fromEntries(
          labels.map(label => [label, probabilities[label] ?? 0])
        ),
        confidence: confidenceOf(0.8, labels.length)
      }
    }
    case 'boolean':
      return { type: 'boolean', probability: 0.95, confidence: 0.9 }
  }
}

export function exampleRunResponse({
  slug,
  version,
  definition
}: {
  slug: string
  /** `M.m`. */
  version: string
  definition: TemplateDefinition
}): PublicRunView {
  const decision = definition.decisions[0]?.label ?? NEEDS_REVIEW
  const answers = Object.fromEntries(
    Object.entries(definition.questions).map(([id, question]) => [
      id,
      exampleAnswer(question)
    ])
  )
  const signals = Object.fromEntries(
    definition.signals.map(signal => [signal.name, 0.8])
  )
  const decided = definition.rules[0]?.id ?? null

  return {
    id: EXAMPLE_ID,
    template: slug,
    version,
    mode: 'live',
    source: 'api',
    status: 'succeeded',
    decision,
    finalDecision: decision === NEEDS_REVIEW ? null : decision,
    confidence: 0.93,
    suggestion: decision === NEEDS_REVIEW ? null : decision,
    flags: [],
    rule: decided,
    reviewReason: null,
    review: null,
    answers,
    signals: definition.signals.length > 0 ? signals : {},
    metadata: null,
    model: 'jev-1.13.0',
    latencyMs: 1240,
    createdAt: EXAMPLE_TIME,
    completedAt: EXAMPLE_DONE,
    error: null
  }
}
