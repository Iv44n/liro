import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'
import AcceptInvitationPage from '#/features/organization/pages/accept-invitation'

export const Route = createFileRoute('/accept-invitation/$invitationId')({
  ssr: false,
  beforeLoad: () => {
    const auth = useAuth.getState().auth

    // Para aceptar una invitación el usuario debe haber iniciado sesión.
    if (!auth?.session) {
      throw redirect({ to: '/auth/login', replace: true })
    }
  },
  component: AcceptInvitationRoute
})

function AcceptInvitationRoute() {
  const { invitationId } = Route.useParams()
  return <AcceptInvitationPage invitationId={invitationId} />
}
