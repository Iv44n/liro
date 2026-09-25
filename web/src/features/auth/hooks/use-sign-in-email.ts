import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useOrganization } from '#/features/organization/store/organization'
import { api } from '#/sdk'
import { AppError } from '#/sdk/core/app.error'
import { useAuth } from '../store/auth'

export const useSignInEmail = ({
  onEmailNotVerified
}: {
  onEmailNotVerified?: (email: string) => void
} = {}) => {
  const refreshAuth = useAuth(state => state.refreshAuth)
  const clearOrganizations = useOrganization(state => state.clearOrganizations)
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: api.auth.signIn.email,
    onSuccess: async ({ user }) => {
      clearOrganizations()
      await refreshAuth()
      await router.invalidate({ sync: true })

      toast.success(`¡Bienvenido de nuevo ${user.name || user.email}!`)
    },
    onError: (err, variables) => {
      if (err instanceof AppError && err.code === 'EMAIL_NOT_VERIFIED') {
        onEmailNotVerified?.(variables.email)

        toast.error('Verifica tu correo', {
          description:
            'Tu cuenta aún no está verificada. Reenvía el enlace de verificación a tu correo.'
        })
        return
      }

      toast.error('Error al iniciar sesión', {
        description: err.message || 'Error al iniciar sesión'
      })
    }
  })

  return {
    signIn: mutation.mutate,
    isPending: mutation.isPending
  }
}
