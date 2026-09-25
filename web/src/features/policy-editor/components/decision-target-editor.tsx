import type {
  DecisionTarget,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { NEEDS_REVIEW } from '#/features/templates/types/definition'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import {
  ToggleGroup,
  ToggleGroupItem
} from '#/shared/components/ui/toggle-group'

/** Question ids that can decide `fromAnswer` (not boolean: it has no label to propose — `FROM_ANSWER_BOOLEAN`). */
function fromAnswerQuestionIds(definition: TemplateDefinition): string[] {
  return Object.entries(definition.questions)
    .filter(([, question]) => question.type !== 'boolean')
    .map(([id]) => id)
}

/**
 * A rule's `decision`: a fixed label, or "según la respuesta de <pregunta>"
 * (a Choice/Score question's answer). `allowFromAnswer` is false for
 * preconditions — they run before Jev, so they can't read an answer
 * (`FROM_ANSWER_IN_PRECONDITION`).
 */
export function DecisionTargetEditor({
  definition,
  value,
  onChange,
  allowFromAnswer,
  idPrefix
}: {
  definition: TemplateDefinition
  value: DecisionTarget
  onChange: (next: DecisionTarget) => void
  allowFromAnswer: boolean
  idPrefix: string
}) {
  const isFromAnswer = typeof value !== 'string'
  const labels = [...definition.decisions.map(d => d.label), NEEDS_REVIEW]
  const questionIds = fromAnswerQuestionIds(definition)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowFromAnswer ? (
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[isFromAnswer ? 'answer' : 'label']}
          onValueChange={values => {
            const [next] = values
            if (next === 'label' && isFromAnswer) {
              onChange(labels[0] ?? NEEDS_REVIEW)
            } else if (next === 'answer' && !isFromAnswer) {
              const [id] = questionIds
              if (id) onChange({ fromAnswer: id })
            }
          }}
          aria-label="Cómo decide"
        >
          <ToggleGroupItem value="label">Etiqueta fija</ToggleGroupItem>
          <ToggleGroupItem value="answer">Según la respuesta</ToggleGroupItem>
        </ToggleGroup>
      ) : null}

      {isFromAnswer ? (
        questionIds.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hay preguntas de opción o puntuación declaradas todavía.
          </p>
        ) : (
          <Select
            value={value.fromAnswer}
            onValueChange={id => {
              if (id !== null) onChange({ fromAnswer: id })
            }}
          >
            <SelectTrigger
              id={`${idPrefix}-target`}
              size="sm"
              className="font-mono"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {questionIds.map(id => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : (
        <Select
          value={value}
          onValueChange={label => {
            if (label !== null) onChange(label)
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-target`}
            size="sm"
            className="font-mono"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {labels.map(label => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
