import { CheckIcon, Loader2Icon, MailIcon, XIcon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent } from '#/shared/components/ui/card'
import { useAcceptInvitation } from '../hooks/use-accept-invitation'
import { useRejectInvitation } from '../hooks/use-reject-invitation'
import { useUserInvitations } from '../hooks/use-user-invitations'

/**
 * Invitaciones que el usuario ha recibido y aún están pendientes. Se muestra en
 * el selector de organizaciones para aceptarlas o rechazarlas sin salir de la
 * pantalla (no redirige tras aceptar).
 */
export function PendingInvitations() {
  const { data: invitations = [] } = useUserInvitations()
  const { acceptInvitation, pendingInvitationId: acceptingId } =
    useAcceptInvitation({ redirect: false })
  const { rejectInvitation, pendingInvitationId: rejectingId } =
    useRejectInvitation()

  if (invitations.length === 0) {
    return null
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Invitaciones pendientes</h2>
        <p className="text-sm text-muted-foreground">
          Te han invitado a las siguientes organizaciones.
        </p>
      </div>

      <div className="space-y-2">
        {invitations.map(invitation => {
          const isAccepting = acceptingId === invitation.id
          const isRejecting = rejectingId === invitation.id
          const isBusy = isAccepting || isRejecting

          return (
            <Card key={invitation.id} size="sm" className="rounded-lg">
              <CardContent className="flex flex-wrap items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <MailIcon className="size-5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {invitation.organizationName ?? 'Una organización'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Rol: {invitation.role ?? 'member'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-md"
                    disabled={isBusy}
                    onClick={() => rejectInvitation(invitation.id)}
                  >
                    {isRejecting ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <XIcon />
                    )}
                    Rechazar
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-md"
                    disabled={isBusy}
                    onClick={() => acceptInvitation(invitation.id)}
                  >
                    {isAccepting ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <CheckIcon />
                    )}
                    Aceptar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
