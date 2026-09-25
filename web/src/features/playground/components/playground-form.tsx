import { BracesIcon, ListIcon } from 'lucide-react'
import type { InputField } from '#/features/templates/types/definition'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel
} from '#/shared/components/ui/field'
import { Textarea } from '#/shared/components/ui/textarea'
import {
  ToggleGroup,
  ToggleGroupItem
} from '#/shared/components/ui/toggle-group'
import {
  type FieldValue,
  type FormValues,
  readValue
} from '../utils/input-form'
import { InputFieldControl } from './input-field-control'

export type InputMode = 'form' | 'json'

/** "Formulario / JSON" switch of the playground's input. */
export function InputModeToggle({
  mode,
  onModeChange,
  disabled
}: {
  mode: InputMode
  onModeChange: (mode: InputMode) => void
  disabled?: boolean
}) {
  return (
    <ToggleGroup
      value={[mode]}
      onValueChange={value => {
        const next = value[0]
        if (next === 'form' || next === 'json') onModeChange(next)
      }}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Modo de entrada"
      disabled={disabled}
    >
      <ToggleGroupItem value="form" aria-label="Formulario">
        <ListIcon aria-hidden />
        <span className="hidden @xs:inline">Formulario</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="json" aria-label="JSON">
        <BracesIcon aria-hidden />
        <span className="hidden @xs:inline">JSON</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

/** The generated fields, one control per `definition.input.fields` entry. */
export function InputFieldsForm({
  fields,
  values,
  errors,
  onChange,
  idPrefix,
  disabled
}: {
  fields: readonly InputField[]
  values: FormValues
  errors: Readonly<Record<string, string>>
  onChange: (path: string, value: FieldValue) => void
  idPrefix: string
  disabled?: boolean
}) {
  if (fields.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Esta decisión todavía no declara campos de entrada. Añádelos en la
        pestaña <span className="font-medium text-foreground">Entrada</span> o
        prueba con una entrada en JSON.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.map(field => (
        <InputFieldControl
          key={field.path}
          field={field}
          value={readValue(field, values)}
          error={errors[field.path]}
          onChange={value => onChange(field.path, value)}
          idPrefix={idPrefix}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

/** Raw JSON input (the whole `input` object). */
export function InputJsonEditor({
  value,
  onChange,
  error,
  id,
  disabled
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
  id: string
  disabled?: boolean
}) {
  return (
    <Field data-invalid={Boolean(error) || undefined} className="gap-1.5">
      <FieldLabel htmlFor={id}>Entrada (JSON)</FieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        spellCheck={false}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        disabled={disabled}
        rows={10}
        className="max-h-[28rem] min-h-40 font-mono text-xs md:text-xs"
      />
      <FieldDescription id={`${id}-hint`} className="text-xs">
        Se envía tal cual como <code className="font-mono">input</code>. Las
        claves que ningún campo declara se descartan.
      </FieldDescription>
      {error ? (
        <FieldError id={`${id}-error`} className="text-xs">
          {error}
        </FieldError>
      ) : null}
    </Field>
  )
}
