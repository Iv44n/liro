import { PlusIcon, Trash2Icon } from 'lucide-react'
import type {
  Condition,
  LintIssue,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { isComparison } from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import {
  ToggleGroup,
  ToggleGroupItem
} from '#/shared/components/ui/toggle-group'
import { issuesAt, issuesForPath } from '../hooks/use-policy-lint'
import {
  conditionDepth,
  defaultComparison,
  defaultGroup,
  MAX_CONDITION_DEPTH
} from '../utils/condition'
import type { OperandContext } from '../utils/operand-model'
import { ComparisonEditor } from './comparison-editor'
import { LintIssueList } from './lint-issue-list'

export interface ConditionEditorProps {
  definition: TemplateDefinition
  condition: Condition
  onChange: (next: Condition) => void
  context: OperandContext
  /** Absolute nesting level of `condition` from the rule's `when` root (1 for the root itself). */
  level?: number
  /** Dotted path matching the API lint's paths (`rules.0.when`, `…when.all.1`…), for issue mapping. */
  path: string
  issues?: readonly LintIssue[]
  /** Omitted at the very top of a rule/question's condition; present for every nested child (removes it from its parent). */
  onRemove?: () => void
}

/**
 * A condition tree: `all`/`any` groups, `not`, or a bare comparison —
 * recursive, depth-limited to `DEFINITION_LIMITS.conditionDepth` (8).
 */
export function ConditionEditor({
  definition,
  condition,
  onChange,
  context,
  level = 1,
  path,
  issues = [],
  onRemove
}: ConditionEditorProps) {
  const canNestOneMore = level + 1 <= MAX_CONDITION_DEPTH
  const canNestTwoMore = level + 2 <= MAX_CONDITION_DEPTH

  if (isComparison(condition)) {
    return (
      <div className="space-y-1 rounded-xl border p-2" data-lint-target={path}>
        <div className="flex items-start gap-1">
          <ComparisonEditor
            definition={definition}
            comparison={condition}
            onChange={onChange}
            context={context}
            idPrefix={path}
          />
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              aria-label="Quitar esta condición"
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(defaultGroup('all'))}
            >
              Agrupar
            </Button>
          )}
        </div>
        <LintIssueList issues={issuesForPath(issues, path)} />
      </div>
    )
  }

  if ('not' in condition) {
    return (
      <div
        className="space-y-2 rounded-xl border border-dashed p-2.5"
        data-lint-target={path}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            NO se cumple que…
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(condition.not)}
            >
              Quitar el «no»
            </Button>
            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onRemove}
                aria-label="Quitar esta condición"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        <ConditionEditor
          definition={definition}
          condition={condition.not}
          onChange={next => onChange({ not: next })}
          context={context}
          level={level + 1}
          path={`${path}.not`}
          issues={issues}
        />
        <LintIssueList issues={issuesAt(issues, path)} />
      </div>
    )
  }

  const isAll = 'all' in condition
  const kind: 'all' | 'any' = isAll ? 'all' : 'any'
  const children = isAll ? condition.all : condition.any

  const setChildren = (next: Condition[]) =>
    onChange(kind === 'all' ? { all: next } : { any: next })

  return (
    <div
      className="space-y-2 rounded-xl bg-muted/30 p-2.5"
      data-lint-target={path}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[kind]}
          onValueChange={values => {
            const [next] = values
            if (next === 'all' || next === 'any') {
              onChange(next === 'all' ? { all: children } : { any: children })
            }
          }}
          aria-label="Se cumplen…"
        >
          <ToggleGroupItem value="all">Todas (Y)</ToggleGroupItem>
          <ToggleGroupItem value="any">Alguna (O)</ToggleGroupItem>
        </ToggleGroup>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label="Quitar este grupo"
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {children.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {kind === 'all'
            ? 'Sin condiciones: siempre se cumple.'
            : 'Sin condiciones: nunca se cumple.'}
        </p>
      ) : (
        <div className="space-y-2 border-s-2 ps-3">
          {children.map((child, index) => (
            <ConditionEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove/reorder reindexes safely, and `path` already encodes the position.
              key={`${path}.${kind}.${index}`}
              definition={definition}
              condition={child}
              onChange={next =>
                setChildren(children.map((c, i) => (i === index ? next : c)))
              }
              context={context}
              level={level + 1}
              path={`${path}.${kind}.${index}`}
              issues={issues}
              onRemove={() =>
                setChildren(children.filter((_, i) => i !== index))
              }
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNestOneMore}
          onClick={() => setChildren([...children, defaultComparison()])}
        >
          <PlusIcon aria-hidden="true" />
          Condición
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNestOneMore}
          onClick={() => setChildren([...children, defaultGroup('all')])}
        >
          <PlusIcon aria-hidden="true" />
          Grupo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNestTwoMore}
          onClick={() =>
            setChildren([...children, { not: defaultComparison() }])
          }
        >
          <PlusIcon aria-hidden="true" />
          Negación
        </Button>
      </div>
      {!canNestOneMore ? (
        <p className="text-xs text-muted-foreground">
          Las condiciones admiten hasta {MAX_CONDITION_DEPTH} niveles de
          anidación.
        </p>
      ) : null}
      <LintIssueList issues={issuesAt(issues, path)} />
    </div>
  )
}

/** `conditionDepth`, re-exported for callers that show it without editing (e.g. a summary badge). */
export { conditionDepth }
