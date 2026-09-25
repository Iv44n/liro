import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useOrganization } from '#/features/organization/store/organization'
import { api } from '#/sdk'

type SignUpInput = { name: string; email: string; password: string }

/**
 * Registra una cuenta. Como el login exige email verificado, el registro NO
 * inicia sesión: se envía el correo de verificación y se redirige al login con
 * un aviso. El `callbackURL` define a dónde vuelve el usuario tras verificar.
 */
export const useSignUpEmail = () => {
  const clearOrganizations = useOrganization(state => state.clearOrganizations)
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (input: SignUpInput) =>
      api.auth.signUp.email({
        name: input.name,
        email: input.email,
        password: input.password,
        callbackURL: `${window.location.origin}/auth/email-verified`
      }),
    onSuccess: async () => {
      clearOrganizations()

      toast.success('Cuenta creada', {
        description:
          'Te enviamos un correo para verificar tu cuenta. Verifícala para poder iniciar sesión.'
      })

      await navigate({ to: '/auth/login', replace: true })
    },
    onError: (err: Error) => {
      toast.error('Error al registrar cuenta', {
        description: err.message || 'No se pudo registrar la cuenta'
      })
    }
  })

  return {
    signUp: mutation.mutate,
    isPending: mutation.isPending
  }
}
