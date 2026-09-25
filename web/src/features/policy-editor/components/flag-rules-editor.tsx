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
  FlagRule,
  LintIssue,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import { issuesForPath } from '../hooks/use-policy-lint'
import { ConditionEditor } from './condition-editor'
import { LintIssueList } from './lint-issue-list'

function FlagChips({
  flags,
  onChange
}: {
  flags: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const issue = draft.trim() ? keyError(draft.trim()) : null

  const add = () => {
    const trimmed = draft.trim()
    if (!trimmed || keyError(trimmed) || flags.includes(trimmed)) return
    onChange([...flags, trimmed])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {flags.map(flag => (
          <Badge key={flag} variant="outline" className="font-mono">
            {flag}
            <button
              type="button"
              onClick={() => onChange(flags.filter(f => f !== flag))}
              aria-label={`Quitar la marca ${flag}`}
              className="ms-0.5"
            >
              ×
            </button>
          </Badge>
        ))}
        {flags.length === 0 ? (
          <span className="text-xs text-muted-foreground">Sin marcas</span>
        ) : null}
      </div>
      <div className="flex items-start gap-1.5">
        <Input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          placeholder="nombre_de_marca"
          className="w-48 font-mono"
          aria-invalid={Boolean(draft && issue)}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <PlusIcon aria-hidden="true" />
          Añadir
        </Button>
      </div>
      {draft && issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : null}
    </div>
  )
}

export function FlagRulesEditor({
  definition,
  rules,
  onChange,
  issues
}: {
  definition: TemplateDefinition
  rules: FlagRule[]
  onChange: (next: FlagRule[]) => void
  issues: readonly LintIssue[]
}) {
  const addRule = () => {
    const id = uniqueName(
      'flag_rule',
      rules.map(r => r.id)
    )
    onChange([...rules, { id, when: { all: [] }, flags: [] }])
  }

  return (
    <div className="space-y-2">
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          Ninguna: no se añade ninguna marca.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {rules.map((rule, index) => {
            const path = `flagRules.${index}`
            return (
              <li
                key={rule.id}
                className="space-y-2.5 rounded-2xl border p-3"
                data-lint-target={path}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span className="mt-6 text-xs text-muted-foreground tabular-nums">
                    {index + 1}.
                  </span>
                  <Field className="w-40 shrink-0 gap-1">
                    <FieldLabel className="text-xs text-muted-foreground">
                      Id
                    </FieldLabel>
                    <Input
                      value={rule.id}
                      disabled
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field className="min-w-32 flex-1 gap-1">
                    <FieldLabel className="text-xs text-muted-foreground">
                      Nombre (opcional)
                    </FieldLabel>
                    <Input
                      value={rule.name ?? ''}
                      onChange={event =>
                        onChange(
                          rules.map((r, i) =>
                            i === index
                              ? { ...r, name: event.target.value || undefined }
                              : r
                          )
                        )
                      }
                    />
                  </Field>
                  <div className="ms-auto flex items-center gap-1 self-end pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onChange(move(rules, index, -1))}
                      disabled={index === 0}
                      aria-label="Subir"
                    >
                      <ChevronUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onChange(move(rules, index, 1))}
                      disabled={index === rules.length - 1}
                      aria-label="Bajar"
                    >
                      <ChevronDownIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        onChange(rules.filter((_, i) => i !== index))
                      }
                      aria-label="Quitar esta regla de marcas"
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
                    onChange={when =>
                      onChange(
                        rules.map((r, i) => (i === index ? { ...r, when } : r))
                      )
                    }
                    context="full"
                    path={`${path}.when`}
                    issues={issues}
                  />
                </div>

                <div className="space-y-1">
                  <FieldLabel className="text-xs text-muted-foreground">
                    → añade las marcas
                  </FieldLabel>
                  <FlagChips
                    flags={rule.flags}
                    onChange={flags =>
                      onChange(
                        rules.map((r, i) => (i === index ? { ...r, flags } : r))
                      )
                    }
                  />
                </div>
                <LintIssueList
                  issues={issuesForPath(issues, `${path}.flags`)}
                />
              </li>
            )
          })}
        </ol>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addRule}>
        <PlusIcon aria-hidden="true" />
        Añadir regla de marcas
      </Button>
    </div>
  )
}
