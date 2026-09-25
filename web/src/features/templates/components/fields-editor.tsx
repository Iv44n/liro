import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import { Checkbox } from '#/shared/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel
} from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { Textarea } from '#/shared/components/ui/textarea'
import { DEFINITION_LIMITS, INPUT_FIELD_TYPES } from '../types/definition'
import { INPUT_FIELD_TYPE_LABELS } from '../utils/format'
import { emptyField, type FieldFormValues } from '../utils/template-form'

const TYPE_OPTIONS = INPUT_FIELD_TYPES.map(type => ({
  value: type,
  label: INPUT_FIELD_TYPE_LABELS[type]
}))

interface FieldsEditorProps {
  fields: FieldFormValues[]
  errors: Record<string, string>
  onChange: (fields: FieldFormValues[]) => void
}

/** The Classify/Decide wizards' input contract: add/remove fields, one row each. */
export function FieldsEditor({ fields, errors, onChange }: FieldsEditorProps) {
  const update = (index: number, patch: Partial<FieldFormValues>) =>
    onChange(
      fields.map((field, i) => (i === index ? { ...field, ...patch } : field))
    )
  const remove = (index: number) =>
    onChange(fields.filter((_, i) => i !== index))
  const add = () => onChange([...fields, emptyField()])
  const canRemove = fields.length > 1

  return (
    <div className="space-y-3">
      {typeof errors.fields === 'string' ? (
        <p className="text-sm text-destructive" role="alert">
          {errors.fields}
        </p>
      ) : null}

      <ul className="space-y-3">
        {fields.map((field, index) => {
          const prefix = `fields[${index}]`
          const pathError = errors[`${prefix}.path`]
          const enumError = errors[`${prefix}.enumValues`]

          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove reindexes safely.
              key={index}
              className="space-y-3 rounded-2xl p-4 ring-1 ring-foreground/10"
            >
              <div className="flex flex-wrap items-start gap-3">
                <Field
                  className="min-w-40 flex-1"
                  data-invalid={Boolean(pathError)}
                >
                  <FieldLabel htmlFor={`${prefix}-path`}>Ruta</FieldLabel>
                  <Input
                    id={`${prefix}-path`}
                    value={field.path}
                    onChange={event =>
                      update(index, { path: event.target.value })
                    }
                    placeholder="ticket.message"
                    className="font-mono"
                    aria-invalid={Boolean(pathError)}
                  />
                  {pathError ? <FieldError>{pathError}</FieldError> : null}
                </Field>

                <Field className="w-44">
                  <FieldLabel htmlFor={`${prefix}-type`}>Tipo</FieldLabel>
                  <Select
                    items={TYPE_OPTIONS}
                    value={field.type}
                    onValueChange={value =>
                      update(index, { type: value as FieldFormValues['type'] })
                    }
                  >
                    <SelectTrigger id={`${prefix}-type`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="flex items-center gap-2 self-end pb-2">
                  <Checkbox
                    id={`${prefix}-required`}
                    checked={field.required}
                    onCheckedChange={checked =>
                      update(index, { required: checked === true })
                    }
                  />
                  <FieldLabel
                    htmlFor={`${prefix}-required`}
                    className="font-normal"
                  >
                    Obligatorio
                  </FieldLabel>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="self-end"
                  aria-label={`Quitar el campo ${field.path || index + 1}`}
                  onClick={() => remove(index)}
                  disabled={!canRemove}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>

              <Field>
                <FieldLabel htmlFor={`${prefix}-description`}>
                  Descripción
                </FieldLabel>
                <Input
                  id={`${prefix}-description`}
                  value={field.description}
                  onChange={event =>
                    update(index, { description: event.target.value })
                  }
                  placeholder="Qué contiene este campo (opcional)"
                />
              </Field>

              {field.type === 'enum' ? (
                <Field data-invalid={Boolean(enumError)}>
                  <FieldLabel htmlFor={`${prefix}-enum`}>
                    Valores permitidos
                  </FieldLabel>
                  <Textarea
                    id={`${prefix}-enum`}
                    value={field.enumValues}
                    onChange={event =>
                      update(index, { enumValues: event.target.value })
                    }
                    placeholder="uno, dos, tres"
                    rows={2}
                    aria-invalid={Boolean(enumError)}
                  />
                  <FieldDescription>
                    Sepáralos con comas o saltos de línea.
                  </FieldDescription>
                  {enumError ? <FieldError>{enumError}</FieldError> : null}
                </Field>
              ) : null}
            </li>
          )
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={fields.length >= DEFINITION_LIMITS.fields}
      >
        <PlusIcon aria-hidden="true" />
        Añadir campo
      </Button>
    </div>
  )
}
