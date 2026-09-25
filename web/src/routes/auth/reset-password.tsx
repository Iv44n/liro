import { createFileRoute } from '@tanstack/react-router'
import ResetPasswordPage from '#/features/auth/pages/reset-password'

export const Route = createFileRoute('/auth/reset-password')({
  // better-auth redirige aquí con `?token=...` (o `?error=...` si caducó).
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined
  }),
  component: ResetPasswordPage
})
