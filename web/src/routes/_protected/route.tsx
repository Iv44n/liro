import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'
import { AppSidebar } from '#/features/dashboard/components/app-sidebar'
import { organizationsQueryOptions } from '#/features/organization/hooks/use-organizations'
import { SidebarProvider, SidebarTrigger } from '#/shared/components/ui/sidebar'

export const Route = createFileRoute('/_protected')({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const auth = useAuth.getState().auth

    if (!auth?.session) {
      throw redirect({
        to: '/auth/login',
        replace: true
      })
    }

    const organizations = await context.queryClient.ensureQueryData(
      organizationsQueryOptions
    )

    // Un usuario sin organizaciones no puede acceder al workspace.
    if (organizations.length === 0) {
      throw redirect({ to: '/onboarding', replace: true })
    }

    // Debe existir una organización activa y válida para usar la aplicación.
    // (Si la organización activa fue eliminada, el id en la sesión queda
    // obsoleto y debe volver al selector.)
    const { activeOrganizationId } = auth.session

    const hasValidActiveOrganization =
      Boolean(activeOrganizationId) &&
      organizations.some(
        organization => organization.id === activeOrganizationId
      )

    if (!hasValidActiveOrganization) {
      throw redirect({ to: '/organizations', replace: true })
    }
  },
  component: ProtectedLayout
})

function ProtectedLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="w-full flex-1 bg-background text-foreground">
        <SidebarTrigger />
        <div className="p-4">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  )
}
