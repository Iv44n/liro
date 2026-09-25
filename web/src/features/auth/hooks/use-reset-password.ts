import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api } from '#/sdk'

/** Establece una nueva contraseña usando el token recibido por correo. */
export const useResetPassword = () => {
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      api.auth.resetPassword(input),
    onSuccess: async () => {
      toast.success('Contraseña actualizada', {
        description: 'Ya puedes iniciar sesión con tu nueva contraseña.'
      })

      await navigate({ to: '/auth/login', replace: true })
    },
    onError: (err: Error) => {
      toast.error('No se pudo restablecer la contraseña', {
        description:
          err.message || 'El enlace puede haber caducado. Solicita uno nuevo.'
      })
    }
  })

  return {
    resetPassword: mutation.mutate,
    isPending: mutation.isPending
  }
}
