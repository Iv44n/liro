import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'

/**
 * Solicita el correo de restablecimiento de contraseña. `redirectTo` apunta a
 * la página web donde el usuario elegirá la nueva contraseña (recibe el token
 * como query param).
 */
export const useForgotPassword = () => {
  const mutation = useMutation({
    mutationFn: (email: string) =>
      api.auth.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/auth/reset-password`
      }),
    onSuccess: () => {
      toast.success('Revisa tu correo', {
        description:
          'Si existe una cuenta con ese correo, te enviamos un enlace para restablecer la contraseña.'
      })
    },
    onError: (err: Error) => {
      toast.error('No se pudo enviar el correo', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    requestReset: mutation.mutate,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess
  }
}
