import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import { DEFINITION_LIMITS } from '../types/definition'
import { emptyLabel, type LabelFormValues } from '../utils/template-form'

interface LabelsListEditorProps {
  labels: LabelFormValues[]
  errors: Record<string, string>
  onChange: (labels: LabelFormValues[]) => void
}

/** The Classify wizard's outcomes: at least 2 labels, each with a description. */
export function LabelsListEditor({
  labels,
  errors,
  onChange
}: LabelsListEditorProps) {
  const update = (index: number, patch: Partial<LabelFormValues>) =>
    onChange(
      labels.map((label, i) => (i === index ? { ...label, ...patch } : label))
    )
  const remove = (index: number) =>
    onChange(labels.filter((_, i) => i !== index))
  const add = () => onChange([...labels, emptyLabel()])
  const canRemove = labels.length > DEFINITION_LIMITS.choiceOptions.min

  return (
    <div className="space-y-3">
      {typeof errors.labels === 'string' ? (
        <p className="text-sm text-destructive" role="alert">
          {errors.labels}
        </p>
      ) : null}

      <ul className="space-y-3">
        {labels.map((label, index) => {
          const prefix = `labels[${index}]`
          const labelError = errors[`${prefix}.label`]

          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove reindexes safely.
              key={index}
              className="flex flex-wrap items-start gap-3 rounded-2xl p-4 ring-1 ring-foreground/10"
            >
              <Field
                className="min-w-32 flex-1"
                data-invalid={Boolean(labelError)}
              >
                <FieldLabel htmlFor={`${prefix}-label`}>Etiqueta</FieldLabel>
                <Input
                  id={`${prefix}-label`}
                  value={label.label}
                  onChange={event =>
                    update(index, { label: event.target.value })
                  }
                  placeholder="facturacion"
                  className="font-mono"
                  aria-invalid={Boolean(labelError)}
                />
                {labelError ? <FieldError>{labelError}</FieldError> : null}
              </Field>

              <Field className="min-w-40 flex-[2]">
                <FieldLabel htmlFor={`${prefix}-description`}>
                  Descripción
                </FieldLabel>
                <Input
                  id={`${prefix}-description`}
                  value={label.description}
                  onChange={event =>
                    update(index, { description: event.target.value })
                  }
                  placeholder="Cuándo aplica esta etiqueta (opcional)"
                />
              </Field>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="self-end"
                aria-label={`Quitar la etiqueta ${label.label || index + 1}`}
                onClick={() => remove(index)}
                disabled={!canRemove}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={labels.length >= DEFINITION_LIMITS.choiceOptions.max}
      >
        <PlusIcon aria-hidden="true" />
        Añadir etiqueta
      </Button>
    </div>
  )
}
