import { createFileRoute } from '@tanstack/react-router'
import EmailVerifiedPage from '#/features/auth/pages/email-verified'

export const Route = createFileRoute('/auth/email-verified')({
  // El enlace de verificación redirige aquí; `?error=...` si el token no es válido.
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined
  }),
  component: EmailVerifiedPage
})
