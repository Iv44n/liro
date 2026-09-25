import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'
import { organizationsQueryOptions } from '#/features/organization/hooks/use-organizations'
import OrganizationsPage from '#/features/organization/pages/organizations'

export const Route = createFileRoute('/organizations')({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const auth = useAuth.getState().auth

    if (!auth?.session) {
      throw redirect({ to: '/auth/login', replace: true })
    }

    const organizations = await context.queryClient.ensureQueryData(
      organizationsQueryOptions
    )

    // Sin organizaciones el usuario debe pasar primero por el onboarding.
    if (organizations.length === 0) {
      throw redirect({ to: '/onboarding', replace: true })
    }
  },
  component: OrganizationsPage
})
