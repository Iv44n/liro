import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
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
import { useForgotPassword } from '../hooks/use-forgot-password'
import { forgotPasswordSchema } from '../schemas/forgot-password'

export default function ForgotPasswordPage() {
  const { requestReset, isPending, isSuccess } = useForgotPassword()

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: forgotPasswordSchema },
    onSubmit: ({ value }) => requestReset(value.email)
  })

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 text-foreground md:p-10">
      <div className="w-full max-w-sm">
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">¿Olvidaste tu contraseña?</CardTitle>
            <CardDescription>
              Ingresa tu correo y te enviaremos un enlace para restablecerla.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSuccess ? (
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Si existe una cuenta con ese correo, te enviamos un enlace
                  para restablecer la contraseña. Revisa tu bandeja de entrada.
                </p>
                <Button
                  className="w-full rounded-md"
                  nativeButton={false}
                  render={<Link to="/auth/login" />}
                >
                  Volver a iniciar sesión
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
                  <form.Field name="email">
                    {field => (
                      <FormInput
                        name={field.name}
                        label="Correo electrónico"
                        type="email"
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        value={field.state.value}
                        errorMessage={field.state.meta.errors[0]?.message}
                        placeholder="correo@ejemplo.com"
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
                          {isLoading ? 'Enviando...' : 'Enviar enlace'}
                        </Button>
                      )
                    }}
                  </form.Subscribe>

                  <p className="text-center text-sm text-muted-foreground">
                    <Link
                      to="/auth/login"
                      className="font-medium text-foreground hover:underline"
                    >
                      Volver a iniciar sesión
                    </Link>
                  </p>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
