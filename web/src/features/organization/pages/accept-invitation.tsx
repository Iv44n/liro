import { useNavigate } from '@tanstack/react-router'
import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { useAcceptInvitation } from '../hooks/use-accept-invitation'
import { useInvitation } from '../hooks/use-invitation'
import { useRejectInvitation } from '../hooks/use-reject-invitation'

const statusMessages: Record<string, string> = {
  accepted: 'Esta invitación ya fue aceptada.',
  rejected: 'Esta invitación fue rechazada.',
  canceled: 'Esta invitación fue cancelada por la organización.'
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 text-foreground md:p-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

export default function AcceptInvitationPage({
  invitationId
}: {
  invitationId: string
}) {
  const navigate = useNavigate()
  const { data: invitation, isLoading, isError } = useInvitation(invitationId)
  const { acceptInvitation, isPending: isAccepting } = useAcceptInvitation()
  const { rejectInvitation, isPending: isRejecting } = useRejectInvitation()

  if (isLoading) {
    return (
      <Shell>
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <Skeleton className="h-6 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full rounded-md" />
          </CardContent>
        </Card>
      </Shell>
    )
  }

  if (isError || !invitation) {
    return (
      <Shell>
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Invitación no válida</CardTitle>
            <CardDescription>
              El enlace no es válido o la invitación ya no está disponible.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              className="rounded-md"
              onClick={() => navigate({ to: '/organizations' })}
            >
              Ir a mis organizaciones
            </Button>
          </CardFooter>
        </Card>
      </Shell>
    )
  }

  // La invitación ya fue resuelta (aceptada, rechazada o cancelada).
  if (invitation.status !== 'pending') {
    return (
      <Shell>
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">
              {invitation.organizationName}
            </CardTitle>
            <CardDescription>
              {statusMessages[invitation.status] ??
                'Esta invitación ya no está disponible.'}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              className="rounded-md"
              onClick={() => navigate({ to: '/organizations' })}
            >
              Ir a mis organizaciones
            </Button>
          </CardFooter>
        </Card>
      </Shell>
    )
  }

  const isBusy = isAccepting || isRejecting

  return (
    <Shell>
      <Card className="rounded-md shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">
            Te invitaron a {invitation.organizationName}
          </CardTitle>
          <CardDescription>
            {invitation.inviterEmail} te invitó a unirte como{' '}
            {invitation.role ?? 'member'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Aceptar la invitación te añadirá como miembro de "
          {invitation.organizationName}".
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            variant="ghost"
            className="rounded-md"
            disabled={isBusy}
            onClick={() =>
              rejectInvitation(invitation.id, {
                onSuccess: () =>
                  navigate({ to: '/organizations', replace: true })
              })
            }
          >
            {isRejecting ? <Loader2Icon className="animate-spin" /> : <XIcon />}
            Rechazar
          </Button>
          <Button
            className="rounded-md"
            disabled={isBusy}
            onClick={() => acceptInvitation(invitation.id)}
          >
            {isAccepting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <CheckIcon />
            )}
            Aceptar invitación
          </Button>
        </CardFooter>
      </Card>
    </Shell>
  )
}
