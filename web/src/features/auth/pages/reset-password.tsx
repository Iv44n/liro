import { useForm } from '@tanstack/react-form'
import { getRouteApi, Link } from '@tanstack/react-router'
import { FormInput } from '#/shared/components/base/form-input'
import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import { FieldGroup } from '#/shared/components/ui/field'
import { useResetPassword } from '../hooks/use-reset-password'
import { resetPasswordSchema } from '../schemas/reset-password'

const routeApi = getRouteApi('/auth/reset-password')

export default function ResetPasswordPage() {
  const { token, error } = routeApi.useSearch()
  const { resetPassword, isPending } = useResetPassword()

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: { onSubmit: resetPasswordSchema },
    onSubmit: ({ value }) => {
      if (!token) return
      resetPassword({ token, newPassword: value.password })
    }
  })

  const isLinkInvalid = !token || Boolean(error)

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 text-foreground md:p-10">
      <div className="w-full max-w-sm">
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Nueva contraseña</CardTitle>
            <CardDescription>
              {isLinkInvalid
                ? 'El enlace no es válido o ha caducado.'
                : 'Elige una nueva contraseña para tu cuenta.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLinkInvalid ? (
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Solicita un nuevo enlace de restablecimiento para continuar.
                </p>
                <Button
                  className="w-full rounded-md"
                  nativeButton={false}
                  render={<Link to="/auth/forgot-password" />}
                >
                  Solicitar nuevo enlace
                </Button>
              </div>
            ) : (
              <form
                onSubmit={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  form.handleSubmit()
                }}
              >
                <FieldGroup>
                  <form.Field name="password">
                    {field => (
                      <FormInput
                        type="password"
                        name={field.name}
                        label="Nueva contraseña"
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        value={field.state.value}
                        errorMessage={field.state.meta.errors[0]?.message}
                        placeholder="Mínimo 8 caracteres"
                        required
                      />
                    )}
                  </form.Field>

                  <form.Field name="confirmPassword">
                    {field => (
                      <FormInput
                        type="password"
                        name={field.name}
                        label="Confirmar contraseña"
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        value={field.state.value}
                        errorMessage={field.state.meta.errors[0]?.message}
                        placeholder="Repite la contraseña"
                        required
                      />
                    )}
                  </form.Field>

                  <form.Subscribe
                    selector={state => [state.canSubmit, state.isSubmitting]}
                  >
                    {([_, isSubmitting]) => {
                      const isLoading = isSubmitting || isPending

                      return (
                        <Button
                          type="submit"
                          disabled={isLoading}
                          className="mt-2 w-full rounded-md"
                        >
                          {isLoading
                            ? 'Guardando...'
                            : 'Restablecer contraseña'}
                        </Button>
                      )
                    }}
                  </form.Subscribe>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
