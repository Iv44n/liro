import { useForm } from '@tanstack/react-form'
import { SendIcon, ShieldIcon, UserIcon } from 'lucide-react'
import { FormInput } from '#/shared/components/base/form-input'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldLabel } from '#/shared/components/ui/field'
import { cn } from '#/shared/utils/shadcn.utils'
import { useInviteMember } from '../hooks/use-invite-member'
import {
  type invitableRoles,
  inviteMemberSchema
} from '../schemas/invite-member'

const roleOptions: {
  value: (typeof invitableRoles)[number]
  label: string
  description: string
  icon: typeof UserIcon
}[] = [
  {
    value: 'member',
    label: 'Miembro',
    description: 'Acceso de lectura',
    icon: UserIcon
  },
  {
    value: 'admin',
    label: 'Administrador',
    description: 'Gestiona miembros e invitaciones',
    icon: ShieldIcon
  }
]

/**
 * Formulario para invitar a un usuario por email a una organización concreta.
 * El `organizationId` se fija al construir el hook para invalidar el listado
 * de invitaciones correcto.
 */
export function InviteMemberForm({
  organizationId
}: {
  organizationId: string
}) {
  const { inviteMember, isPending } = useInviteMember(organizationId)

  const form = useForm({
    defaultValues: {
      email: '',
      role: 'member' as (typeof invitableRoles)[number]
    },

    validators: {
      onSubmit: inviteMemberSchema
    },

    onSubmit: ({ value, formApi }) => {
      inviteMember(
        { email: value.email, role: value.role },
        {
          onSuccess: () => formApi.reset()
        }
      )
    }
  })

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <form.Field name="email">
        {field => (
          <FormInput
            name={field.name}
            type="email"
            label="Email"
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
            value={field.state.value}
            errorMessage={field.state.meta.errors[0]?.message}
            placeholder="persona@empresa.com"
            required
          />
        )}
      </form.Field>

      <form.Field name="role">
        {field => (
          <Field className="gap-2">
            <FieldLabel className="text-sm font-medium">Rol</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {roleOptions.map(option => {
                const isSelected = field.state.value === option.value
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => field.handleChange(option.value)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        isSelected ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={state => state.isSubmitting}>
        {isSubmitting => {
          const isLoading = isSubmitting || isPending
          return (
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-md"
            >
              <SendIcon />
              {isLoading ? 'Enviando...' : 'Enviar invitación'}
            </Button>
          )
        }}
      </form.Subscribe>
    </form>
  )
}
