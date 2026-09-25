import { createFileRoute, redirect } from '@tanstack/react-router'
import { meQueryOptions } from '#/features/auth/hooks/use-me'
import { useAuth } from '#/features/auth/store/auth'
import NewTemplatePage from '#/features/templates/pages/new-template'

export const Route = createFileRoute('/_protected/decisions/new')({
  // Crear decisiones requiere `template:create`.
  beforeLoad: async ({ context }) => {
    const activeOrganizationId =
      useAuth.getState().auth?.session.activeOrganizationId

    const me = await context.queryClient.ensureQueryData(
      meQueryOptions(activeOrganizationId)
    )

    if (!me.permissions.template.create) {
      throw redirect({ to: '/decisions', replace: true })
    }
  },
  head: () => ({ meta: [{ title: 'Nueva decisión · Liro' }] }),
  component: NewTemplatePage
})
