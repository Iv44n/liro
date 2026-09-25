import type {
  QuestionDef,
  TemplateDefinition
} from '#modules/templates/definition'
import type { CanonicalQuestion } from './evaluator/port'

type BooleanCriteria = NonNullable<
  Extract<CanonicalQuestion, { type: 'boolean' }>['criteria']
>

/**
 * A DSL question as the evaluator receives it. `note` (author-only) and
 * `when` (Liro decides whether to ask) are dropped. A Score level without a
 * description is sent as its label, the only text the author gave for it.
 * Boolean criteria keep just the entries the author wrote (an explicit `null`
 * included), and the key is omitted when there are none. The result shares
 * nothing with `question`, so adapters may transform it freely.
 */
export function toCanonicalQuestion(question: QuestionDef): CanonicalQuestion {
  const copy = structuredClone(question)
  switch (copy.type) {
    case 'choice':
      return {
        type: 'choice',
        instructions: copy.instructions,
        criteria: copy.criteria
      }
    case 'score':
      return {
        type: 'score',
        instructions: copy.instructions,
        criteria: copy.levels.map(level => level.criteria ?? level.label)
      }
    case 'boolean': {
      const criteria: BooleanCriteria = {}
      for (const outcome of ['true', 'false'] as const) {
        const entry = copy.criteria?.[outcome]
        if (entry !== undefined) criteria[outcome] = entry
      }
      return Object.keys(criteria).length > 0
        ? { type: 'boolean', instructions: copy.instructions, criteria }
        : { type: 'boolean', instructions: copy.instructions }
    }
    default: {
      // Unreachable for a parsed definition; one read back without parsing
      // must not silently drop a question from the request.
      const unknown: never = copy
      throw new Error(
        `Unknown question type "${(unknown as QuestionDef).type}"`
      )
    }
  }
}

/**
 * The questions of one evaluation: exactly the `asked` ids (see
 * `questionsToAsk`), keyed in that order; a repeated id is sent once. An id
 * the definition doesn't declare is a caller bug, not bad input, so it throws.
 * Keys are defined as own properties, so no id can reach the prototype.
 */
export function buildQuestions(
  definition: Pick<TemplateDefinition, 'questions'>,
  asked: readonly string[]
): Record<string, CanonicalQuestion> {
  const entries = asked.map((id): [string, CanonicalQuestion] => {
    const question = Object.hasOwn(definition.questions, id)
      ? definition.questions[id]
      : undefined
    if (!question) throw new Error(`Unknown question "${id}"`)
    return [id, toCanonicalQuestion(question)]
  })
  return Object.fromEntries(entries)
}
