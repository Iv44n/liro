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
  AggregateSignal,
  LintIssue,
  Operand,
  SignalDef,
  SignalKind,
  TemplateDefinition,
  WeightedSignal
} from '#/features/templates/types/definition'
import { SIGNAL_KINDS } from '#/features/templates/types/definition'
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
import { Switch } from '#/shared/components/ui/switch'
import { issuesForPath } from '../hooks/use-policy-lint'
import { defaultOperand } from '../utils/condition'
import { LintIssueList } from './lint-issue-list'
import { OperandEditor } from './operand-editor'

const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  weighted: 'Media ponderada',
  min: 'Mínimo',
  max: 'Máximo',
  mean: 'Promedio'
}

function emptySignal(kind: SignalKind, name: string): SignalDef {
  return kind === 'weighted'
    ? { name, kind, terms: [] }
    : { name, kind, of: [] }
}

function SignalNameField({
  name,
  taken,
  onRename
}: {
  name: string
  taken: readonly string[]
  onRename: (next: string) => void
}) {
  const [draft, setDraft] = useState(name)
  const issue = draft.trim() ? keyError(draft.trim()) : 'Obligatorio'
  const duplicate = draft.trim() !== name && taken.includes(draft.trim())

  return (
    <Field className="w-40 shrink-0 gap-1">
      <FieldLabel className="text-xs text-muted-foreground">Nombre</FieldLabel>
      <Input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim()
          if (
            trimmed &&
            trimmed !== name &&
            !keyError(trimmed) &&
            !taken.includes(trimmed)
          ) {
            onRename(trimmed)
          } else {
            setDraft(name)
          }
        }}
        className="font-mono text-sm"
        aria-invalid={draft !== name && (Boolean(issue) || duplicate)}
      />
      {draft !== name && issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : draft !== name && duplicate ? (
        <p className="text-xs text-destructive">Ese nombre ya está en uso.</p>
      ) : null}
    </Field>
  )
}

function WeightedTerms({
  definition,
  signal,
  onChange,
  path,
  issues
}: {
  definition: TemplateDefinition
  signal: WeightedSignal
  onChange: (next: WeightedSignal) => void
  path: string
  issues: readonly LintIssue[]
}) {
  const { terms } = signal
  const setTerms = (next: WeightedSignal['terms']) =>
    onChange({ ...signal, terms: next })

  return (
    <div className="space-y-2">
      {terms.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin términos todavía.</p>
      ) : (
        <ul className="space-y-2">
          {terms.map((term, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove/reorder reindexes safely.
              key={index}
              className="space-y-1 rounded-xl bg-muted/40 p-2"
              data-lint-target={`${path}.terms.${index}`}
            >
              <div className="flex flex-wrap items-start gap-1.5">
                <OperandEditor
                  definition={definition}
                  value={term.operand}
                  onChange={operand =>
                    setTerms(
                      terms.map((t, i) => (i === index ? { ...t, operand } : t))
                    )
                  }
                  context="full"
                  idPrefix={`${path}-term-${index}`}
                />
                <div className="w-24">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={term.weight}
                    onChange={event => {
                      const weight = Number(event.target.value)
                      setTerms(
                        terms.map((t, i) =>
                          i === index && Number.isFinite(weight)
                            ? { ...t, weight }
                            : t
                        )
                      )
                    }}
                    aria-label="Peso"
                    className="font-mono"
                  />
                </div>
                <FieldLabel className="flex h-9 items-center gap-1.5 text-xs font-normal">
                  <Switch
                    checked={Boolean(term.invert)}
                    onCheckedChange={checked =>
                      setTerms(
                        terms.map((t, i) =>
                          i === index
                            ? { ...t, invert: Boolean(checked) || undefined }
                            : t
                        )
                      )
                    }
                  />
                  Invertir
                </FieldLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setTerms(terms.filter((_, i) => i !== index))}
                  aria-label={`Quitar el término ${index + 1}`}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
              <LintIssueList
                issues={issuesForPath(issues, `${path}.terms.${index}`)}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          setTerms([...terms, { operand: defaultOperand(), weight: 1 }])
        }
      >
        <PlusIcon aria-hidden="true" />
        Añadir término
      </Button>
    </div>
  )
}

function AggregateOperands({
  definition,
  signal,
  onChange,
  path,
  issues
}: {
  definition: TemplateDefinition
  signal: AggregateSignal
  onChange: (next: AggregateSignal) => void
  path: string
  issues: readonly LintIssue[]
}) {
  const { of } = signal
  const setOf = (next: Operand[]) => onChange({ ...signal, of: next })

  return (
    <div className="space-y-2">
      {of.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin operandos todavía.</p>
      ) : (
        <ul className="space-y-1.5">
          {of.map((operand, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove reindexes safely.
              key={index}
              className="flex items-start gap-1.5"
              data-lint-target={`${path}.of.${index}`}
            >
              <OperandEditor
                definition={definition}
                value={operand}
                onChange={next =>
                  setOf(of.map((o, i) => (i === index ? next : o)))
                }
                context="full"
                idPrefix={`${path}-of-${index}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setOf(of.filter((_, i) => i !== index))}
                aria-label={`Quitar el operando ${index + 1}`}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LintIssueList issues={issuesForPath(issues, `${path}.of`)} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOf([...of, defaultOperand()])}
      >
        <PlusIcon aria-hidden="true" />
        Añadir operando
      </Button>
    </div>
  )
}

export function SignalsEditor({
  definition,
  signals,
  onChange,
  issues
}: {
  definition: TemplateDefinition
  signals: SignalDef[]
  onChange: (next: SignalDef[]) => void
  issues: readonly LintIssue[]
}) {
  const addSignal = () => {
    const name = uniqueName(
      'signal',
      signals.map(s => s.name)
    )
    onChange([...signals, emptySignal('mean', name)])
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Un número entre 0 y 1 que combina varios operandos; una señal solo ve
        las definidas antes que ella.
      </p>
      {signals.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          Ninguna definida.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {signals.map((signal, index) => {
            const path = `signals.${index}`
            return (
              <li
                key={signal.name}
                className="space-y-2.5 rounded-2xl border p-3"
                data-lint-target={path}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span className="mt-6 text-xs text-muted-foreground tabular-nums">
                    {index + 1}.
                  </span>
                  <SignalNameField
                    name={signal.name}
                    taken={signals
                      .filter((_, i) => i !== index)
                      .map(s => s.name)}
                    onRename={name =>
                      onChange(
                        signals.map((s, i) =>
                          i === index ? { ...s, name } : s
                        )
                      )
                    }
                  />
                  <div className="w-44 space-y-1">
                    <FieldLabel className="text-xs text-muted-foreground">
                      Cómo combina
                    </FieldLabel>
                    <Select
                      value={signal.kind}
                      onValueChange={kind =>
                        onChange(
                          signals.map((s, i) =>
                            i === index
                              ? emptySignal(kind as SignalKind, s.name)
                              : s
                          )
                        )
                      }
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SIGNAL_KINDS.map(kind => (
                          <SelectItem key={kind} value={kind}>
                            {SIGNAL_KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="ms-auto flex items-center gap-1 self-end pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onChange(move(signals, index, -1))}
                      disabled={index === 0}
                      aria-label="Subir"
                    >
                      <ChevronUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onChange(move(signals, index, 1))}
                      disabled={index === signals.length - 1}
                      aria-label="Bajar"
                    >
                      <ChevronDownIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        onChange(signals.filter((_, i) => i !== index))
                      }
                      aria-label={`Quitar la señal ${signal.name}`}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {signal.kind === 'weighted' ? (
                  <WeightedTerms
                    definition={definition}
                    signal={signal}
                    onChange={next =>
                      onChange(signals.map((s, i) => (i === index ? next : s)))
                    }
                    path={path}
                    issues={issues}
                  />
                ) : (
                  <AggregateOperands
                    definition={definition}
                    signal={signal}
                    onChange={next =>
                      onChange(signals.map((s, i) => (i === index ? next : s)))
                    }
                    path={path}
                    issues={issues}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addSignal}>
        <PlusIcon aria-hidden="true" />
        Añadir señal
      </Button>
    </div>
  )
}
