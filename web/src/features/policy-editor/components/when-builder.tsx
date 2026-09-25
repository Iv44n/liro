import { PlusIcon, Trash2Icon } from 'lucide-react'
import type {
  Condition,
  LintIssue,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import { issuesForPath } from '../hooks/use-policy-lint'
import { ConditionEditor } from './condition-editor'
import { LintIssueList } from './lint-issue-list'

/**
 * A question's `when`: "Preguntar solo si…", an input-only condition (a
 * question is asked before any answer exists, so it can only read the input)
 * — the same builder as preconditions, collapsed to a toggle since most
 * questions have none.
 */
export function WhenBuilder({
  definition,
  questionId,
  onChange,
  issues = []
}: {
  definition: TemplateDefinition
  questionId: string
  onChange: (
    recipe: (when: Condition | undefined) => Condition | undefined
  ) => void
  issues?: readonly LintIssue[]
}) {
  const question = definition.questions[questionId]
  const when = question?.when
  const path = `questions.${questionId}.when`

  if (!when) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(() => ({ all: [] }))}
      >
        <PlusIcon aria-hidden="true" />
        Preguntar solo si…
      </Button>
    )
  }

  return (
    <div className="space-y-1.5" data-lint-target={path}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Preguntar solo si…
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(() => undefined)}
        >
          <Trash2Icon aria-hidden="true" />
          Quitar la condición (preguntar siempre)
        </Button>
      </div>
      <ConditionEditor
        definition={definition}
        condition={when}
        onChange={next => onChange(() => next)}
        context="input-only"
        path={path}
        issues={issues}
      />
      <LintIssueList issues={issuesForPath(issues, path)} />
    </div>
  )
}
