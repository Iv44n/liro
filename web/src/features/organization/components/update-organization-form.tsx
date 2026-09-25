import { useForm } from '@tanstack/react-form'
import type { Organization } from '#/sdk/modules/organization/types'
import { FormInput } from '#/shared/components/base/form-input'
import { Button } from '#/shared/components/ui/button'
import { FieldGroup } from '#/shared/components/ui/field'
import { useUpdateOrganization } from '../hooks/use-update-organization'
import { createOrganizationSchema } from '../schemas/create-organization'

/**
 * Formulario para actualizar nombre, slug y logo de una organización. Reutiliza
 * el esquema de creación (mismas reglas de validación). El slug es editable
 * directamente (no se autogenera al editar una organización existente).
 */
export function UpdateOrganizationForm({
  organization
}: {
  organization: Organization
}) {
  const { updateOrganization, isPending } = useUpdateOrganization()

  const form = useForm({
    defaultValues: {
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo ?? ''
    },

    validators: {
      onSubmit: createOrganizationSchema
    },

    onSubmit: ({ value }) =>
      updateOrganization({
        organizationId: organization.id,
        data: {
          name: value.name,
          slug: value.slug,
          logo: value.logo || null
        }
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
              onValueChange={field.handleChange}
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
            <FormInput
              name={field.name}
              label="Slug"
              onValueChange={field.handleChange}
              onBlur={field.handleBlur}
              value={field.state.value}
              errorMessage={field.state.meta.errors[0]?.message}
              placeholder="mi-organizacion"
            />
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

        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => {
            const isLoading = isSubmitting || isPending
            return (
              <Button
                type="submit"
                disabled={isLoading}
                className="mt-2 rounded-md"
              >
                {isLoading ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            )
          }}
        </form.Subscribe>
      </FieldGroup>
    </form>
  )
}
