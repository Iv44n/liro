import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel
} from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import { Textarea } from '#/shared/components/ui/textarea'
import type { TemplateFormValues } from '../utils/template-form'

interface BasicsFieldsProps {
  values: Pick<TemplateFormValues, 'name' | 'slug' | 'description'>
  errors: Record<string, string>
  onNameChange: (value: string) => void
  onSlugChange: (value: string) => void
  onDescriptionChange: (value: string) => void
}

/** Name, slug (auto from the name, editable) and description: every method sends these. */
export function BasicsFields({
  values,
  errors,
  onNameChange,
  onSlugChange,
  onDescriptionChange
}: BasicsFieldsProps) {
  const hasNameError = Boolean(errors.name)
  const hasSlugError = Boolean(errors.slug)
  const hasDescriptionError = Boolean(errors.description)

  return (
    <div className="space-y-4">
      <Field data-invalid={hasNameError || undefined}>
        <FieldLabel htmlFor="template-name">Nombre</FieldLabel>
        <Input
          id="template-name"
          value={values.name}
          onChange={event => onNameChange(event.target.value)}
          placeholder="Clasificación de tickets"
          required
          aria-invalid={hasNameError || undefined}
          aria-describedby={hasNameError ? 'template-name-error' : undefined}
        />
        {hasNameError ? (
          <FieldError id="template-name-error">{errors.name}</FieldError>
        ) : null}
      </Field>

      <Field data-invalid={hasSlugError || undefined}>
        <FieldLabel htmlFor="template-slug">Slug</FieldLabel>
        <Input
          id="template-slug"
          value={values.slug}
          onChange={event => onSlugChange(event.target.value)}
          placeholder="tickets-soporte"
          className="font-mono"
          aria-invalid={hasSlugError || undefined}
          aria-describedby="template-slug-description"
        />
        <FieldDescription id="template-slug-description">
          Se genera a partir del nombre; identifica la decisión en la API y ya
          no se puede cambiar una vez publicada la primera versión.
        </FieldDescription>
        {hasSlugError ? (
          <FieldError id="template-slug-error">{errors.slug}</FieldError>
        ) : null}
      </Field>

      <Field data-invalid={hasDescriptionError || undefined}>
        <FieldLabel htmlFor="template-description">Descripción</FieldLabel>
        <Textarea
          id="template-description"
          value={values.description}
          onChange={event => onDescriptionChange(event.target.value)}
          placeholder="Para qué sirve esta decisión (opcional)"
          rows={3}
          aria-invalid={hasDescriptionError || undefined}
        />
        {hasDescriptionError ? (
          <FieldError id="template-description-error">
            {errors.description}
          </FieldError>
        ) : null}
      </Field>
    </div>
  )
}
