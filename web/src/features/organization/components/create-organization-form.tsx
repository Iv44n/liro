import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { FormInput } from '#/shared/components/base/form-input'
import { Button } from '#/shared/components/ui/button'
import { FieldGroup } from '#/shared/components/ui/field'
import { useCreateOrganization } from '../hooks/use-create-organization'
import { createOrganizationSchema } from '../schemas/create-organization'
import { slugify } from '../utils/slug'

type CreateOrganizationFormProps = {
  submitLabel?: string
  onCancel?: () => void
}

export function CreateOrganizationForm({
  submitLabel = 'Crear organización',
  onCancel
}: CreateOrganizationFormProps) {
  const { createOrganization, isPending } = useCreateOrganization()
  const [slugEdited, setSlugEdited] = useState(false)

  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
      logo: ''
    },
    validators: {
      onSubmit: createOrganizationSchema
    },
    onSubmit: ({ value }) =>
      createOrganization({
        name: value.name,
        slug: value.slug,
        logo: value.logo
      })
  })

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="name">
          {field => (
            <FormInput
              name={field.name}
              label="Nombre"
              onValueChange={value => {
                field.handleChange(value)
                if (!slugEdited) {
                  form.setFieldValue('slug', slugify(value))
                }
              }}
              onBlur={field.handleBlur}
              value={field.state.value}
              errorMessage={field.state.meta.errors[0]?.message}
              placeholder="Mi organización"
              required
            />
          )}
        </form.Field>

        <form.Field name="slug">
          {field => (
            <div className="space-y-1.5">
              <FormInput
                name={field.name}
                label="Slug"
                onValueChange={value => {
                  setSlugEdited(true)
                  field.handleChange(value)
                }}
                onBlur={field.handleBlur}
                value={field.state.value}
                errorMessage={field.state.meta.errors[0]?.message}
                placeholder="mi-organizacion"
              />
              <p className="text-xs text-muted-foreground">
                Se genera automáticamente desde el nombre.
              </p>
            </div>
          )}
        </form.Field>

        <form.Field name="logo">
          {field => (
            <FormInput
              name={field.name}
              label="Logo URL"
              onValueChange={field.handleChange}
              onBlur={field.handleBlur}
              value={field.state.value}
              errorMessage={field.state.meta.errors[0]?.message}
              placeholder="https://example.com/logo.png"
            />
          )}
        </form.Field>

        <form.Subscribe
          selector={state => [state.canSubmit, state.isSubmitting]}
        >
          {([_, isSubmitting]) => {
            const isLoading = isSubmitting || isPending

            if (onCancel) {
              return (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-md"
                    disabled={isLoading}
                    onClick={onCancel}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    className="rounded-md"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Creando...' : 'Crear'}
                  </Button>
                </div>
              )
            }

            return (
              <Button
                type="submit"
                disabled={isLoading}
                className="mt-2 w-full rounded-md transition-none focus-visible:ring-0 disabled:ring-0"
              >
                {isLoading ? 'Creando...' : submitLabel}
              </Button>
            )
          }}
        </form.Subscribe>
      </FieldGroup>
    </form>
  )
}
