import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'
import { organizationsQueryOptions } from '#/features/organization/hooks/use-organizations'
import OnboardingPage from '#/features/organization/pages/onboarding'

export const Route = createFileRoute('/onboarding')({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const auth = useAuth.getState().auth

    if (!auth?.session) {
      throw redirect({ to: '/auth/login', replace: true })
    }

    const organizations = await context.queryClient.ensureQueryData(
      organizationsQueryOptions
    )

    // El onboarding es solo para usuarios sin organizaciones.
    if (organizations.length > 0) {
      throw redirect({
        to: auth.session.activeOrganizationId ? '/dashboard' : '/organizations',
        replace: true
      })
    }
  },
  component: OnboardingPage
})
