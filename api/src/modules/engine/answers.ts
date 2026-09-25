import {
  type CanonicalAnswer,
  EvaluatorError
} from '#modules/engine/evaluator/port'
import type { ResolvedAnswer, ResolvedAnswers } from '#modules/engine/types'
import type { QuestionDef } from '#modules/templates/definition'
import {
  booleanConfidence,
  distributionConfidence,
  normalizeProbabilities
} from './confidence'

/**
 * Turns the provider's canonical answers into what the policy reads
 * (`ResolvedAnswer`): complete, normalized probabilities keyed by the names
 * the template uses, plus Liro's own confidence. An answer that cannot belong
 * to its question is the provider's fault, so it fails the run with
 * `BAD_RESPONSE` instead of being guessed at.
 */

type ChoiceQuestion = Extract<QuestionDef, { type: 'choice' }>
type ScoreQuestion = Extract<QuestionDef, { type: 'score' }>
type ChoiceAnswer = Extract<CanonicalAnswer, { type: 'choice' }>
type ScoreAnswer = Extract<CanonicalAnswer, { type: 'score' }>
type BooleanAnswer = Extract<CanonicalAnswer, { type: 'boolean' }>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** A provider value for an error message; never throws (unlike `JSON.stringify` on a BigInt). */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null || typeof value !== 'object') return String(value)
  return Array.isArray(value) ? 'an array' : 'an object'
}

const badResponse = (id: string, message: string) =>
  new EvaluatorError('BAD_RESPONSE', `Answer "${id}": ${message}`)

/** The provider's distribution, if it sent something that can hold one. */
const probabilitiesOf = (answer: { probabilities: unknown }) =>
  isRecord(answer.probabilities)
    ? (answer.probabilities as Record<string, number>)
    : null

function resolveChoice(
  question: ChoiceQuestion,
  answer: ChoiceAnswer,
  id: string
): ResolvedAnswer {
  const { choice } = answer
  if (typeof choice !== 'string' || !Object.hasOwn(question.criteria, choice)) {
    throw badResponse(
      id,
      `choice ${describe(choice)} is not one of the question's options`
    )
  }

  const received = probabilitiesOf(answer)
  const probabilities = received
    ? normalizeProbabilities(received, Object.keys(question.criteria))
    : null

  return {
    type: 'choice',
    choice,
    probabilities,
    confidence: choiceConfidence(choice, probabilities)
  }
}

/**
 * `distributionConfidence` measures the MOST PROBABLE option, so it only
 * belongs to `choice` when the choice is one (ties included). A provider whose
 * choice contradicts its own distribution has given no confidence in that
 * choice: `null`, so the run goes to review instead of auto-deciding it with
 * another option's confidence.
 */
function choiceConfidence(
  choice: string,
  probabilities: Record<string, number> | null
): number | null {
  if (!probabilities) return null
  const top = Math.max(...Object.values(probabilities))
  return probabilities[choice] === top
    ? distributionConfidence(probabilities)
    : null
}

/** Most probable level; ties go to the level closest to `score`, then the lowest. */
function argmaxLevel(byIndex: Record<string, number>, score: number): number {
  let best = 0
  let bestP = Number.NEGATIVE_INFINITY
  for (const [key, p] of Object.entries(byIndex)) {
    const index = Number(key)
    const closer = Math.abs(index - score) < Math.abs(best - score)
    if (p > bestP || (p === bestP && closer)) {
      best = index
      bestP = p
    }
  }
  return best
}

function resolveScore(
  question: ScoreQuestion,
  answer: ScoreAnswer,
  id: string
): ResolvedAnswer {
  const { levels } = question
  const n = levels.length
  if (n === 0) throw badResponse(id, 'the question has no levels')
  if (typeof answer.score !== 'number' || Number.isNaN(answer.score)) {
    throw badResponse(id, 'score is not a number')
  }
  const score = Math.min(n - 1, Math.max(0, answer.score))

  // The provider keys levels by position; the policy reads them by label.
  const received = probabilitiesOf(answer)
  const byIndex = received
    ? normalizeProbabilities(
        received,
        levels.map((_, index) => String(index))
      )
    : null
  const levelIndex = byIndex ? argmaxLevel(byIndex, score) : Math.round(score)

  let probabilities: Record<string, number> | null = null
  if (byIndex) {
    // Duplicate labels (a lint error) add up instead of overwriting each other.
    const byLabel = new Map<string, number>()
    for (const [index, { label }] of levels.entries()) {
      byLabel.set(label, (byLabel.get(label) ?? 0) + (byIndex[index] ?? 0))
    }
    probabilities = Object.fromEntries(byLabel)
  }

  return {
    type: 'score',
    score,
    // A single level (a lint error) has no range to normalize over.
    scoreNorm: n > 1 ? score / (n - 1) : 0,
    level: levels[levelIndex]?.label ?? '',
    levelIndex,
    probabilities,
    // K = number of levels, whatever the label map collapsed.
    confidence: byIndex ? distributionConfidence(byIndex) : null
  }
}

function resolveBoolean(answer: BooleanAnswer, id: string): ResolvedAnswer {
  const { probability } = answer
  if (typeof probability !== 'number' || Number.isNaN(probability)) {
    throw badResponse(id, 'probability is not a number')
  }
  const clamped = Math.min(1, Math.max(0, probability))
  return {
    type: 'boolean',
    probability: clamped,
    confidence: booleanConfidence(clamped)
  }
}

/**
 * Resolves one provider answer against its question. Out-of-range numbers
 * are clamped (score to [0, levels − 1], probability to [0, 1]); a wrong
 * type, an unknown option or a NaN throws `EvaluatorError('BAD_RESPONSE')`.
 * Missing or all-zero probabilities resolve to `probabilities: null` and
 * `confidence: null`, so the policy fails closed; so does a Choice whose
 * `choice` isn't its own most probable option (`confidence: null`).
 */
export function resolveAnswer(
  question: QuestionDef,
  answer: CanonicalAnswer,
  id: string
): ResolvedAnswer {
  const received: unknown = answer
  if (!isRecord(received)) {
    throw badResponse(id, `expected a ${question.type} answer, got nothing`)
  }

  switch (question.type) {
    case 'choice':
      if (answer.type === 'choice') return resolveChoice(question, answer, id)
      break
    case 'score':
      if (answer.type === 'score') return resolveScore(question, answer, id)
      break
    case 'boolean':
      if (answer.type === 'boolean') return resolveBoolean(answer, id)
      break
  }
  throw badResponse(
    id,
    `expected a ${question.type} answer, got ${describe(received.type)}`
  )
}

/**
 * Resolves a run's answers. Every question of the definition gets a key, in
 * definition order: `null` when it wasn't `asked` (its `when` didn't hold),
 * otherwise its resolved answer — a missing one is `BAD_RESPONSE`. Answers
 * to questions that weren't asked, or that the definition doesn't have, are
 * ignored, and so are `asked` ids the definition doesn't have.
 */
export function resolveAnswers(
  questions: Record<string, QuestionDef>,
  asked: readonly string[],
  answers: Record<string, CanonicalAnswer>
): ResolvedAnswers {
  const askedIds = new Set(asked)
  const resolved: ResolvedAnswers = {}
  for (const [id, question] of Object.entries(questions)) {
    if (!askedIds.has(id)) {
      resolved[id] = null
      continue
    }
    const answer =
      isRecord(answers) && Object.hasOwn(answers, id) ? answers[id] : undefined
    if (answer === undefined || answer === null) {
      throw badResponse(id, 'the provider did not answer this question')
    }
    resolved[id] = resolveAnswer(question, answer, id)
  }
  return resolved
}

/** The diagnostic view of an answer in API responses (outside the versioned contract). */
export type PublicAnswer =
  | {
      type: 'choice'
      choice: string
      probabilities: Record<string, number> | null
      confidence: number | null
    }
  | {
      type: 'score'
      score: number
      level: string
      probabilities: Record<string, number> | null
      confidence: number | null
    }
  | { type: 'boolean'; probability: number; confidence: number }

const round = (value: number) => Math.round(value * 10_000) / 10_000

const roundOrNull = (value: number | null) =>
  value === null ? null : round(value)

const roundAll = (probabilities: Record<string, number> | null) =>
  probabilities
    ? Object.fromEntries(
        Object.entries(probabilities).map(([key, p]) => [key, round(p)])
      )
    : null

function publicAnswer(answer: ResolvedAnswer): PublicAnswer {
  switch (answer.type) {
    case 'choice':
      return {
        type: 'choice',
        choice: answer.choice,
        probabilities: roundAll(answer.probabilities),
        confidence: roundOrNull(answer.confidence)
      }
    case 'score':
      return {
        type: 'score',
        score: round(answer.score),
        level: answer.level,
        probabilities: roundAll(answer.probabilities),
        confidence: roundOrNull(answer.confidence)
      }
    case 'boolean':
      return {
        type: 'boolean',
        probability: round(answer.probability),
        confidence: round(answer.confidence)
      }
  }
}

/**
 * Resolved answers as exposed in API responses: only the fields a caller can
 * reason about (no internal `scoreNorm`/`levelIndex`), numbers rounded to 4
 * decimals, `null` for questions that weren't asked.
 */
export function publicAnswers(
  answers: ResolvedAnswers
): Record<string, PublicAnswer | null> {
  return Object.fromEntries(
    Object.entries(answers).map(([id, answer]) => [
      id,
      answer ? publicAnswer(answer) : null
    ])
  )
}
