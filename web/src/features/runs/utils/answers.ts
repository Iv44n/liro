import type { PublicAnswer, PublicAnswers } from '#/sdk/modules/runs/types'

/**
 * Turns the API's answers into what the UI draws: one row per question with
 * its value and one probability bar per option / level / yes-no.
 */

export interface AnswerBar {
  label: string
  probability: number
  /** The option, level or side the answer landed on. */
  selected: boolean
}

export type AnswerSummary =
  | {
      id: string
      asked: false
    }
  | {
      id: string
      asked: true
      type: PublicAnswer['type']
      /** The chosen option, the most probable level, or `Sí` / `No`. */
      value: string
      /** Score questions: the expected level, in [0, levels − 1]. */
      score: number | null
      confidence: number | null
      /** Empty when the provider sent no probabilities. */
      bars: AnswerBar[]
    }

const TYPE_LABELS: Record<PublicAnswer['type'], string> = {
  choice: 'Opción',
  score: 'Escala',
  boolean: 'Sí / no'
}

export const answerTypeLabel = (type: PublicAnswer['type']) => TYPE_LABELS[type]

function barsFrom(
  probabilities: Record<string, number> | null,
  selected: string
): AnswerBar[] {
  if (!probabilities) return []
  return Object.entries(probabilities).map(([label, probability]) => ({
    label,
    probability,
    selected: label === selected
  }))
}

export function summarizeAnswer(
  id: string,
  answer: PublicAnswer | null
): AnswerSummary {
  if (!answer) return { id, asked: false }

  switch (answer.type) {
    case 'choice':
      return {
        id,
        asked: true,
        type: 'choice',
        value: answer.choice,
        score: null,
        confidence: answer.confidence,
        bars: barsFrom(answer.probabilities, answer.choice)
      }
    case 'score':
      return {
        id,
        asked: true,
        type: 'score',
        value: answer.level,
        score: answer.score,
        confidence: answer.confidence,
        bars: barsFrom(answer.probabilities, answer.level)
      }
    case 'boolean': {
      const yes = answer.probability >= 0.5
      return {
        id,
        asked: true,
        type: 'boolean',
        value: yes ? 'Sí' : 'No',
        score: null,
        confidence: answer.confidence,
        bars: [
          { label: 'Sí', probability: answer.probability, selected: yes },
          { label: 'No', probability: 1 - answer.probability, selected: !yes }
        ]
      }
    }
  }
}

/** Every answer, in the order the API sent them (the definition's order). */
export function summarizeAnswers(
  answers: PublicAnswers | null | undefined
): AnswerSummary[] {
  if (!answers) return []
  return Object.entries(answers).map(([id, answer]) =>
    summarizeAnswer(id, answer)
  )
}

export interface SignalRow {
  name: string
  value: number | null
}

export function signalRows(
  signals: Record<string, number | null> | null | undefined
): SignalRow[] {
  if (!signals) return []
  return Object.entries(signals).map(([name, value]) => ({ name, value }))
}
