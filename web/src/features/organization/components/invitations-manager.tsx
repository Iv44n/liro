import {
  ClockIcon,
  InboxIcon,
  Loader2Icon,
  RotateCwIcon,
  XIcon
} from 'lucide-react'
import type { Invitation } from '#/sdk/modules/organization/types'
import { Button } from '#/shared/components/ui/button'
import { FieldSeparator } from '#/shared/components/ui/field'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { cn } from '#/shared/utils/shadcn.utils'
import { useCancelInvitation } from '../hooks/use-cancel-invitation'
import { useInvitations } from '../hooks/use-invitations'
import { useInviteMember } from '../hooks/use-invite-member'
import { InviteMemberForm } from './invite-member-form'

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  canceled: 'Cancelada'
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  accepted: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  rejected: 'bg-destructive/10 text-destructive',
  canceled: 'bg-muted text-muted-foreground'
}

const roleLabels: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro'
}

const dateFormatter = new Intl.DateTimeFormat('es', {
  day: '2-digit',
  month: 'short'
})

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date)
}

// Ordena las pendientes primero y, dentro de cada grupo, las más recientes
// arriba, para que las acciones disponibles queden visibles al inicio.
function sortInvitations(invitations: Invitation[]): Invitation[] {
  return [...invitations].sort((a, b) => {
    const aPending = a.status === 'pending' ? 0 : 1
    const bPending = b.status === 'pending' ? 0 : 1
    if (aPending !== bPending) return aPending - bPending
    return b.createdAt.localeCompare(a.createdAt)
  })
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        statusStyles[status] ?? 'bg-muted text-muted-foreground'
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {statusLabels[status] ?? status}
    </span>
  )
}

function InvitationRow({
  invitation,
  organizationId
}: {
  invitation: Invitation
  organizationId: string
}) {
  const { cancelInvitation, pendingInvitationId: cancelingId } =
    useCancelInvitation(organizationId)
  const { inviteMember, isPending: isResending } =
    useInviteMember(organizationId)

  const isPending = invitation.status === 'pending'
  const isCanceling = cancelingId === invitation.id
  const roleLabel = roleLabels[invitation.role ?? 'member'] ?? invitation.role

  return (
    <li
      className={cn(
        'flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-muted/40',
        !isPending && 'opacity-70'
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary uppercase">
        {invitation.email.charAt(0) || '@'}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{invitation.email}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span>{roleLabel}</span>
          {isPending && invitation.expiresAt ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="size-3" />
                Expira {formatDate(invitation.expiresAt)}
              </span>
            </>
          ) : null}
        </span>
      </div>

      <StatusBadge status={invitation.status} />

      {isPending ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reenviar invitación"
            title="Reenviar invitación"
            className="rounded-md text-muted-foreground"
            disabled={isResending}
            onClick={() =>
              inviteMember({
                email: invitation.email,
                role: (invitation.role as 'member' | 'admin') ?? 'member',
                resend: true
              })
            }
          >
            {isResending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <RotateCwIcon />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancelar invitación"
            title="Cancelar invitación"
            className="rounded-md text-muted-foreground hover:text-destructive"
            disabled={isCanceling}
            onClick={() => cancelInvitation(invitation.id)}
          >
            {isCanceling ? <Loader2Icon className="animate-spin" /> : <XIcon />}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Listado autocontenido de invitaciones enviadas (encabezado con contador +
 * lista con estados de carga/error/vacío). Se usa tanto en la página de
 * invitaciones como dentro del diálogo de la tarjeta de organización.
 */
export function SentInvitationsList({
  organizationId,
  enabled = true
}: {
  organizationId: string
  enabled?: boolean
}) {
  const {
    data: invitations,
    isLoading,
    isError
  } = useInvitations(organizationId, enabled)

  const sorted = invitations ? sortInvitations(invitations) : []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-0.5">
        <h2 className="text-sm font-medium">Invitaciones enviadas</h2>
        {sorted.length > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {sorted.length}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          No se pudieron cargar las invitaciones.
        </p>
      ) : sorted.length > 0 ? (
        <ul className="max-h-96 divide-y overflow-y-auto rounded-xl border bg-card">
          {sorted.map(invitation => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              organizationId={organizationId}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <InboxIcon className="size-5" />
          </div>
          <p className="text-sm font-medium">Aún no has enviado invitaciones</p>
          <p className="text-xs text-muted-foreground">
            Las invitaciones que envíes aparecerán aquí.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Cuerpo compacto para gestionar invitaciones (formulario + listado), pensado
 * para el diálogo de la tarjeta de organización. La página de invitaciones usa
 * `InviteMemberForm` y `SentInvitationsList` por separado en tarjetas propias.
 *
 * `enabled` permite diferir la consulta (p. ej. solo cuando el diálogo abre).
 */
export function InvitationsManager({
  organizationId,
  enabled = true
}: {
  organizationId: string
  enabled?: boolean
}) {
  return (
    <div className="space-y-6">
      <InviteMemberForm organizationId={organizationId} />
      <FieldSeparator />
      <SentInvitationsList organizationId={organizationId} enabled={enabled} />
    </div>
  )
}
