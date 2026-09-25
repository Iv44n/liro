import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'

/** Reenvía el correo de verificación de cuenta para un email dado. */
export const useResendVerification = () => {
  const mutation = useMutation({
    mutationFn: (email: string) =>
      api.auth.sendVerificationEmail({
        email,
        callbackURL: `${window.location.origin}/auth/email-verified`
      }),
    onSuccess: () => {
      toast.success('Correo reenviado', {
        description:
          'Te reenviamos el enlace de verificación. Revisa tu bandeja de entrada.'
      })
    },
    onError: (err: Error) => {
      toast.error('No se pudo reenviar', {
        description: err.message || 'Inténtalo de nuevo en unos minutos.'
      })
    }
  })

  return {
    resend: mutation.mutate,
    isPending: mutation.isPending
  }
}
