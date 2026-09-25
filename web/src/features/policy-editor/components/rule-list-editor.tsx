import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import { useState } from 'react'
import { keyError } from '#/features/template-editor/schemas/definition'
import {
  move,
  uniqueName
} from '#/features/template-editor/utils/definition-ops'
import type {
  DecisionRule,
  LintIssue,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { issuesForPath } from '../hooks/use-policy-lint'
import type { OperandContext } from '../utils/operand-model'
import { questionIds } from '../utils/operand-model'
import { ConditionEditor } from './condition-editor'
import { DecisionTargetEditor } from './decision-target-editor'
import { LintIssueList } from './lint-issue-list'

function RuleIdField({
  id,
  taken,
  onRename
}: {
  id: string
  taken: readonly string[]
  onRename: (next: string) => void
}) {
  const [draft, setDraft] = useState(id)
  const issue = draft.trim() ? keyError(draft.trim()) : 'Obligatorio'
  const duplicate = draft.trim() !== id && taken.includes(draft.trim())

  return (
    <Field className="w-40 shrink-0 gap-1">
      <FieldLabel className="text-xs text-muted-foreground">Id</FieldLabel>
      <Input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim()
          if (
            trimmed &&
            trimmed !== id &&
            !keyError(trimmed) &&
            !taken.includes(trimmed)
          ) {
            onRename(trimmed)
          } else {
            setDraft(id)
          }
        }}
        className="font-mono text-sm"
        aria-invalid={draft !== id && (Boolean(issue) || duplicate)}
      />
      {draft !== id && issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : draft !== id && duplicate ? (
        <p className="text-xs text-destructive">Ese id ya está en uso.</p>
      ) : null}
    </Field>
  )
}

function RuleRow({
  definition,
  rule,
  index,
  total,
  otherIds,
  context,
  allowFromAnswer,
  path,
  issues,
  onChange,
  onMove,
  onRemove
}: {
  definition: TemplateDefinition
  rule: DecisionRule
  index: number
  total: number
  otherIds: readonly string[]
  context: OperandContext
  allowFromAnswer: boolean
  path: string
  issues: readonly LintIssue[]
  onChange: (next: DecisionRule) => void
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}) {
  const ids = questionIds(definition)

  return (
    <li className="space-y-2.5 rounded-2xl border p-3" data-lint-target={path}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-6 text-xs text-muted-foreground tabular-nums">
          {index + 1}.
        </span>
        <RuleIdField
          id={rule.id}
          taken={otherIds}
          onRename={id => onChange({ ...rule, id })}
        />
        <Field className="min-w-32 flex-1 gap-1">
          <FieldLabel className="text-xs text-muted-foreground">
            Nombre (opcional)
          </FieldLabel>
          <Input
            value={rule.name ?? ''}
            onChange={event =>
              onChange({ ...rule, name: event.target.value || undefined })
            }
          />
        </Field>
        <div className="ms-auto flex items-center gap-1 self-end pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Subir"
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Bajar"
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label="Quitar esta regla"
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <FieldLabel className="text-xs text-muted-foreground">
          Cuando…
        </FieldLabel>
        <ConditionEditor
          definition={definition}
          condition={rule.when}
          onChange={when => onChange({ ...rule, when })}
          context={context}
          path={`${path}.when`}
          issues={issues}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <FieldLabel className="text-xs text-muted-foreground">
            → decide
          </FieldLabel>
          <DecisionTargetEditor
            definition={definition}
            value={rule.decision}
            onChange={decision => onChange({ ...rule, decision })}
            allowFromAnswer={allowFromAnswer}
            idPrefix={path}
          />
        </div>
        <div className="w-48 space-y-1">
          <FieldLabel className="text-xs text-muted-foreground">
            Confianza de (opcional)
          </FieldLabel>
          <Select
            value={rule.confidenceFrom ?? '__none__'}
            onValueChange={value => {
              if (value === null) return
              onChange({
                ...rule,
                confidenceFrom: value === '__none__' ? undefined : value
              })
            }}
          >
            <SelectTrigger size="sm" className="w-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                {typeof rule.decision === 'string'
                  ? 'ninguna'
                  : 'la pregunta decidida'}
              </SelectItem>
              {ids.map(id => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <LintIssueList issues={issuesForPath(issues, `${path}.decision`)} />
      <LintIssueList issues={issuesForPath(issues, `${path}.confidenceFrom`)} />
    </li>
  )
}

export function RuleListEditor({
  definition,
  rules,
  onChange,
  context,
  allowFromAnswer,
  section,
  idBase,
  emptyText,
  issues
}: {
  definition: TemplateDefinition
  rules: DecisionRule[]
  onChange: (next: DecisionRule[]) => void
  context: OperandContext
  allowFromAnswer: boolean
  section: 'preconditions' | 'rules'
  idBase: string
  emptyText: string
  issues: readonly LintIssue[]
}) {
  const addRule = () => {
    const id = uniqueName(
      idBase,
      rules.map(r => r.id)
    )
    onChange([
      ...rules,
      {
        id,
        when: { all: [] },
        decision: definition.decisions[0]?.label ?? 'needs_review'
      }
    ])
  }

  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ol className="space-y-2.5">
          {rules.map((rule, index) => (
            <RuleRow
              key={rule.id}
              definition={definition}
              rule={rule}
              index={index}
              total={rules.length}
              otherIds={rules.filter((_, i) => i !== index).map(r => r.id)}
              context={context}
              allowFromAnswer={allowFromAnswer}
              path={`${section}.${index}`}
              issues={issues}
              onChange={next =>
                onChange(rules.map((r, i) => (i === index ? next : r)))
              }
              onMove={offset => onChange(move(rules, index, offset))}
              onRemove={() => onChange(rules.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addRule}>
        <PlusIcon aria-hidden="true" />
        Añadir regla
      </Button>
    </div>
  )
}
