import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useId, useState } from 'react'
import { BandSlider } from '#/features/templates/components/band-slider'
import { ConfidenceSlider } from '#/features/templates/components/confidence-slider'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import { Slider } from '#/shared/components/ui/slider'
import { Switch } from '#/shared/components/ui/switch'
import { Textarea } from '#/shared/components/ui/textarea'
import { labelError } from '../../schemas/definition'
import { useEditorContext, useEditorStore } from '../../store/editor-context'
import {
  addClassifyLabel,
  addDecision,
  removeClassifyLabel,
  removeDecision,
  renameClassifyLabel,
  renameLabel,
  updateDecision
} from '../../utils/definition-ops'
import { formatPercent } from '../../utils/format'
import {
  decidePattern,
  linkedChoiceQuestion,
  setDecideBand,
  setSharedThreshold,
  sharedThreshold
} from '../../utils/thresholds'

function LabelInput({
  label,
  onRename
}: {
  label: string
  onRename: (next: string) => void
}) {
  const [draft, setDraft] = useState(label)
  const issue = draft.trim() ? labelError(draft.trim()) : 'Obligatorio'

  return (
    <div className="min-w-32 flex-1 space-y-1">
      <Input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim()
          if (trimmed && trimmed !== label && !labelError(trimmed))
            onRename(trimmed)
          else setDraft(label)
        }}
        className="font-mono text-sm"
      />
      {draft !== label && issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : null}
    </div>
  )
}

function DecisionRow({
  index,
  label,
  description,
  minConfidence,
  alwaysReview,
  showThreshold,
  canRemove,
  onRename,
  onDescription,
  onThreshold,
  onAlwaysReview,
  onRemove
}: {
  index: number
  label: string
  description?: string
  minConfidence?: number
  alwaysReview?: boolean
  showThreshold: boolean
  canRemove: boolean
  onRename: (next: string) => void
  onDescription: (next: string) => void
  onThreshold?: (next: number | undefined) => void
  onAlwaysReview: (next: boolean) => void
  onRemove: () => void
}) {
  const thresholdDescriptionId = useId()

  return (
    <div
      className="space-y-3 rounded-2xl border p-3"
      data-lint-target={`decisions.${index}`}
    >
      <div className="flex items-start gap-2">
        <LabelInput label={label} onRename={onRename} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Quitar la decisión ${label}`}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>

      <Field className="gap-1">
        <FieldLabel className="text-xs text-muted-foreground">
          Descripción (opcional)
        </FieldLabel>
        <Textarea
          value={description ?? ''}
          onChange={event => onDescription(event.target.value)}
          rows={2}
          placeholder="Para quién lea el resultado (revisión, integraciones…)"
        />
      </Field>

      {showThreshold && onThreshold ? (
        <div className="space-y-2">
          <FieldLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <Switch
              size="sm"
              checked={minConfidence !== undefined}
              onCheckedChange={checked =>
                onThreshold(checked ? 0.8 : undefined)
              }
            />
            Umbral de confianza
          </FieldLabel>
          {minConfidence !== undefined ? (
            <div className="space-y-1">
              <Slider
                value={[Math.round(minConfidence * 100)]}
                min={0}
                max={100}
                step={1}
                aria-label={`Confianza mínima de ${label}`}
                aria-valuetext={formatPercent(minConfidence)}
                aria-describedby={thresholdDescriptionId}
                onValueChange={values => {
                  const [next] = Array.isArray(values) ? values : [values]
                  if (typeof next === 'number') onThreshold(next / 100)
                }}
              />
              <p
                id={thresholdDescriptionId}
                className="text-xs text-muted-foreground"
              >
                Por debajo de {formatPercent(minConfidence)}, va a revisión
                humana sugiriendo <code>{label}</code>.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sin umbral: si no hay de dónde tomar la confianza, siempre va a
              revisión (salvo que actives "Revisar siempre" abajo, que es
              redundante en ese caso).
            </p>
          )}
        </div>
      ) : null}

      <FieldLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Switch
          size="sm"
          checked={alwaysReview ?? false}
          onCheckedChange={onAlwaysReview}
        />
        Revisar siempre (todo caso con esta decisión pasa por una persona)
      </FieldLabel>
    </div>
  )
}

function ClassifyDecisions({
  definition,
  questionId
}: {
  definition: TemplateDefinition
  questionId: string
}) {
  const update = useEditorStore(state => state.update)
  const shared = sharedThreshold(definition)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-3">
        <FieldLabel className="flex items-center gap-2 text-sm font-normal">
          <Switch
            checked={shared !== undefined}
            onCheckedChange={checked =>
              update(d => setSharedThreshold(d, checked ? 0.8 : undefined))
            }
          />
          Umbral de confianza compartido
        </FieldLabel>
        {shared === null ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
            Las etiquetas tienen umbrales distintos. Activa el interruptor de
            nuevo para unificarlos en 80 %.
          </p>
        ) : shared !== undefined ? (
          <div className="mt-3">
            <ConfidenceSlider
              value={Math.round(shared * 100)}
              onChange={percent =>
                update(d => setSharedThreshold(d, percent / 100))
              }
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Sin umbral: la decisión siempre se aplica sola (nunca va a revisión
            por baja confianza).
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Etiquetas</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update(d => addClassifyLabel(d, questionId))}
        >
          <PlusIcon aria-hidden="true" />
          Añadir etiqueta
        </Button>
      </div>

      {definition.decisions.map((decision, index) => (
        <DecisionRow
          key={decision.label}
          index={index}
          label={decision.label}
          description={decision.description}
          alwaysReview={decision.alwaysReview}
          showThreshold={false}
          canRemove={definition.decisions.length > 2}
          onRename={next =>
            update(d =>
              renameClassifyLabel(d, questionId, decision.label, next)
            )
          }
          onDescription={next =>
            update(d =>
              updateDecision(d, index, { description: next || undefined })
            )
          }
          onAlwaysReview={next =>
            update(d => updateDecision(d, index, { alwaysReview: next }))
          }
          onRemove={() =>
            update(d => removeClassifyLabel(d, questionId, decision.label))
          }
        />
      ))}
    </div>
  )
}

function DecideDecisions({ definition }: { definition: TemplateDefinition }) {
  const update = useEditorStore(state => state.update)
  const pattern = decidePattern(definition)
  if (!pattern || pattern.yesThreshold === null || pattern.noThreshold === null)
    return null
  const { yesLabel, noLabel, yesThreshold, noThreshold } = pattern

  const others = definition.decisions.filter(
    decision => decision.label !== yesLabel && decision.label !== noLabel
  )

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-3">
        <BandSlider
          value={{
            no: Math.round(noThreshold * 100),
            yes: Math.round(yesThreshold * 100)
          }}
          onChange={next =>
            update(d =>
              setDecideBand(
                d,
                { yesLabel, noLabel },
                { yes: next.yes / 100, no: next.no / 100 }
              )
            )
          }
        />
      </div>

      {[yesLabel, noLabel].map(label => {
        const index = definition.decisions.findIndex(
          decision => decision.label === label
        )
        const decision = definition.decisions[index]
        if (!decision) return null
        return (
          <div
            key={label}
            className="space-y-2 rounded-2xl border p-3"
            data-lint-target={`decisions.${index}`}
          >
            <p className="font-mono text-sm">{label}</p>
            <Field className="gap-1">
              <FieldLabel className="text-xs text-muted-foreground">
                Descripción (opcional)
              </FieldLabel>
              <Textarea
                value={decision.description ?? ''}
                onChange={event =>
                  update(d =>
                    updateDecision(d, index, {
                      description: event.target.value || undefined
                    })
                  )
                }
                rows={2}
              />
            </Field>
            <FieldLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Switch
                size="sm"
                checked={decision.alwaysReview ?? false}
                onCheckedChange={next =>
                  update(d => updateDecision(d, index, { alwaysReview: next }))
                }
              />
              Revisar siempre
            </FieldLabel>
          </div>
        )
      })}

      {others.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Otras decisiones</h3>
          {others.map(decision => {
            const index = definition.decisions.findIndex(
              d => d.label === decision.label
            )
            return (
              <DecisionRow
                key={decision.label}
                index={index}
                label={decision.label}
                description={decision.description}
                minConfidence={decision.minConfidence}
                alwaysReview={decision.alwaysReview}
                showThreshold
                canRemove
                onRename={next =>
                  update(d => renameLabel(d, decision.label, next))
                }
                onDescription={next =>
                  update(d =>
                    updateDecision(d, index, { description: next || undefined })
                  )
                }
                onThreshold={next =>
                  update(d => updateDecision(d, index, { minConfidence: next }))
                }
                onAlwaysReview={next =>
                  update(d => updateDecision(d, index, { alwaysReview: next }))
                }
                onRemove={() => update(d => removeDecision(d, index))}
              />
            )
          })}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          update(d => addDecision(d, { label: 'needs_review_custom' }))
        }
      >
        <PlusIcon aria-hidden="true" />
        Añadir otra decisión
      </Button>
    </div>
  )
}

function GenericDecisions({ definition }: { definition: TemplateDefinition }) {
  const update = useEditorStore(state => state.update)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Decisiones</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            update(d => addDecision(d, { label: 'nueva_decision' }))
          }
        >
          <PlusIcon aria-hidden="true" />
          Añadir decisión
        </Button>
      </div>

      {definition.decisions.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Sin decisiones todavía. Declara al menos una etiqueta.
        </p>
      ) : (
        definition.decisions.map((decision, index) => (
          <DecisionRow
            key={decision.label}
            index={index}
            label={decision.label}
            description={decision.description}
            minConfidence={decision.minConfidence}
            alwaysReview={decision.alwaysReview}
            showThreshold
            canRemove={definition.decisions.length > 1}
            onRename={next => update(d => renameLabel(d, decision.label, next))}
            onDescription={next =>
              update(d =>
                updateDecision(d, index, { description: next || undefined })
              )
            }
            onThreshold={next =>
              update(d => updateDecision(d, index, { minConfidence: next }))
            }
            onAlwaysReview={next =>
              update(d => updateDecision(d, index, { alwaysReview: next }))
            }
            onRemove={() => update(d => removeDecision(d, index))}
          />
        ))
      )}
    </div>
  )
}

export function DecisionsTab() {
  const definition = useEditorStore(state => state.definition)
  const { readOnly } = useEditorContext()
  if (!definition) return null

  const linked =
    definition.kind === 'classify' ? linkedChoiceQuestion(definition) : null
  const pattern =
    definition.kind === 'decide' ? decidePattern(definition) : null
  const decideReady =
    pattern !== null &&
    pattern.yesThreshold !== null &&
    pattern.noThreshold !== null

  return (
    // The sliders here (band/confidence/minConfidence) aren't native form
    // controls, so the shell's `<fieldset disabled>` can't reach them.
    <div
      aria-disabled={readOnly || undefined}
      className={readOnly ? 'pointer-events-none opacity-60' : undefined}
    >
      {linked ? (
        <ClassifyDecisions definition={definition} questionId={linked} />
      ) : decideReady ? (
        <DecideDecisions definition={definition} />
      ) : (
        <GenericDecisions definition={definition} />
      )}
    </div>
  )
}
