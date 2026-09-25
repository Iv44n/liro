import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import type { LabelFormValues } from '../utils/template-form'

interface DecideLabelsFieldsProps {
  yes: LabelFormValues
  no: LabelFormValues
  errors: Record<string, string>
  onYesChange: (value: LabelFormValues) => void
  onNoChange: (value: LabelFormValues) => void
}

/** The Decide wizard's two outcomes: the label and description for "sí" and "no". */
export function DecideLabelsFields({
  yes,
  no,
  errors,
  onYesChange,
  onNoChange
}: DecideLabelsFieldsProps) {
  const yesError = errors['yes.label']
  const noError = errors['no.label']

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3 rounded-2xl p-4 ring-1 ring-foreground/10">
        <p className="text-sm font-medium">Cuando la respuesta es «sí»</p>
        <Field data-invalid={Boolean(yesError)}>
          <FieldLabel htmlFor="decide-yes-label">Etiqueta</FieldLabel>
          <Input
            id="decide-yes-label"
            value={yes.label}
            onChange={event =>
              onYesChange({ ...yes, label: event.target.value })
            }
            placeholder="yes"
            className="font-mono"
            aria-invalid={Boolean(yesError)}
          />
          {yesError ? <FieldError>{yesError}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="decide-yes-description">Descripción</FieldLabel>
          <Input
            id="decide-yes-description"
            value={yes.description}
            onChange={event =>
              onYesChange({ ...yes, description: event.target.value })
            }
            placeholder="Qué implica (opcional)"
          />
        </Field>
      </div>

      <div className="space-y-3 rounded-2xl p-4 ring-1 ring-foreground/10">
        <p className="text-sm font-medium">Cuando la respuesta es «no»</p>
        <Field data-invalid={Boolean(noError)}>
          <FieldLabel htmlFor="decide-no-label">Etiqueta</FieldLabel>
          <Input
            id="decide-no-label"
            value={no.label}
            onChange={event => onNoChange({ ...no, label: event.target.value })}
            placeholder="no"
            className="font-mono"
            aria-invalid={Boolean(noError)}
          />
          {noError ? <FieldError>{noError}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="decide-no-description">Descripción</FieldLabel>
          <Input
            id="decide-no-description"
            value={no.description}
            onChange={event =>
              onNoChange({ ...no, description: event.target.value })
            }
            placeholder="Qué implica (opcional)"
          />
        </Field>
      </div>
    </div>
  )
}
