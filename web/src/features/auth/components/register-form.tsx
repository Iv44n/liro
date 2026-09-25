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
import { useSignUpEmail } from '../hooks/use-sign-up-email'
import { registerSchema } from '../schemas/register'

export default function RegisterForm() {
  const { signUp, isPending } = useSignUpEmail()

  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: ''
    },

    validators: {
      onSubmit: registerSchema
    },

    onSubmit: ({ value }) => signUp(value)
  })

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-md rounded-md">
        <CardHeader>
          <CardTitle className="text-xl">Crear una cuenta</CardTitle>
          <CardDescription>
            Ingresa tus datos a continuación para registrarte
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    onValueChange={field.handleChange}
                    onBlur={field.handleBlur}
                    value={field.state.value}
                    errorMessage={field.state.meta.errors[0]?.message}
                    label="Nombre completo"
                    placeholder="Juan Pérez"
                    required
                  />
                )}
              </form.Field>

              <form.Field name="email">
                {field => (
                  <FormInput
                    name={field.name}
                    onValueChange={field.handleChange}
                    onBlur={field.handleBlur}
                    value={field.state.value}
                    errorMessage={field.state.meta.errors[0]?.message}
                    label="Correo electrónico"
                    type="email"
                    placeholder="correo@ejemplo.com"
                    required
                  />
                )}
              </form.Field>

              <form.Field name="password">
                {field => (
                  <FormInput
                    type="password"
                    name={field.name}
                    onValueChange={field.handleChange}
                    onBlur={field.handleBlur}
                    value={field.state.value}
                    errorMessage={field.state.meta.errors[0]?.message}
                    label="Contraseña"
                    placeholder="Ingresa tu contraseña"
                    required
                  />
                )}
              </form.Field>

              <form.Field name="confirmPassword">
                {field => (
                  <FormInput
                    type="password"
                    name={field.name}
                    onValueChange={field.handleChange}
                    onBlur={field.handleBlur}
                    value={field.state.value}
                    errorMessage={field.state.meta.errors[0]?.message}
                    label="Confirmar contraseña"
                    placeholder="Confirma tu contraseña"
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
                      className="mt-2 w-full rounded-md transition-none focus-visible:ring-0 disabled:ring-0"
                    >
                      {isLoading ? 'Registrando...' : 'Registrarse'}
                    </Button>
                  )
                }}
              </form.Subscribe>

              <p className="text-center text-sm text-muted-foreground">
                ¿Ya tienes una cuenta?{' '}
                <Link
                  to="/auth/login"
                  className="hover:underline font-medium text-foreground"
                >
                  Inicia sesión
                </Link>
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
