import {
  CrownIcon,
  Loader2Icon,
  LogOutIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
  UserPlusIcon,
  UsersIcon
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '#/features/auth/store/auth'
import type {
  OrganizationMember,
  OrganizationRole
} from '#/sdk/modules/organization/types'
import {
  Avatar,
  AvatarFallback,
  AvatarImage
} from '#/shared/components/ui/avatar'
import { Button } from '#/shared/components/ui/button'
import { Card } from '#/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { cn } from '#/shared/utils/shadcn.utils'
import { InviteMemberForm } from '../components/invite-member-form'
import { LeaveOrganizationDialog } from '../components/leave-organization-dialog'
import { OrgPageHeader } from '../components/org-page-header'
import { useActiveMemberRole } from '../hooks/use-active-member-role'
import { useMembers } from '../hooks/use-members'
import { useOrganizations } from '../hooks/use-organizations'
import { useRemoveMember } from '../hooks/use-remove-member'
import { useTransferOwnership } from '../hooks/use-transfer-ownership'
import { can, isOwner } from '../utils/permissions'

const roleMeta: Record<
  string,
  { label: string; className: string; icon: typeof CrownIcon }
> = {
  owner: {
    label: 'Propietario',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: CrownIcon
  },
  admin: {
    label: 'Administrador',
    className: 'bg-primary/10 text-primary',
    icon: ShieldIcon
  },
  member: {
    label: 'Miembro',
    className: 'bg-muted text-muted-foreground',
    icon: UserIcon
  }
}

function RoleBadge({ role }: { role: OrganizationRole | null }) {
  const meta = roleMeta[role ?? 'member'] ?? roleMeta.member
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        meta.className
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  )
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  return parts
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}

function MemberRow({
  member,
  organizationId,
  currentUserId,
  currentRole,
  currentMemberId
}: {
  member: OrganizationMember
  organizationId: string
  currentUserId: string | undefined
  currentRole: OrganizationRole | undefined
  currentMemberId: string | undefined
}) {
  const { removeMember, isPending: isRemoving } =
    useRemoveMember(organizationId)
  const { transferOwnership, isPending: isTransferring } =
    useTransferOwnership(organizationId)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)

  const isSelf = member.userId === currentUserId
  const memberIsOwner = isOwner(member.role)

  // No se puede actuar sobre uno mismo aquí (para salir está "Salir de la
  // organización") ni sobre otros propietarios.
  const canRemove =
    can(currentRole, 'member:remove') && !isSelf && !memberIsOwner
  const canTransfer =
    can(currentRole, 'member:transfer') &&
    !isSelf &&
    !memberIsOwner &&
    Boolean(currentMemberId)

  const displayName = member.user?.name || member.user?.email || 'Usuario'

  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <Avatar size="lg" className="rounded-lg">
        <AvatarImage src={member.user?.image ?? undefined} alt={displayName} />
        <AvatarFallback className="rounded-lg">
          {getInitials(displayName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {displayName}
          {isSelf ? (
            <span className="ms-1 text-xs font-normal text-muted-foreground">
              (tú)
            </span>
          ) : null}
        </span>
        {member.user?.email ? (
          <span className="truncate text-xs text-muted-foreground">
            {member.user.email}
          </span>
        ) : null}
      </div>

      <RoleBadge role={member.role} />

      <div className="flex shrink-0 items-center gap-1">
        {canTransfer ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Transferir propiedad a ${displayName}`}
            title="Transferir propiedad"
            className="rounded-md text-muted-foreground hover:text-amber-600"
            disabled={isTransferring}
            onClick={() => setTransferOpen(true)}
          >
            {isTransferring ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <CrownIcon />
            )}
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Eliminar a ${displayName}`}
            title="Eliminar de la organización"
            className="rounded-md text-muted-foreground hover:text-destructive"
            disabled={isRemoving}
            onClick={() => setRemoveOpen(true)}
          >
            {isRemoving ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <Trash2Icon />
            )}
          </Button>
        ) : null}
      </div>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Transferir propiedad</DialogTitle>
            <DialogDescription>
              Vas a convertir a {displayName} en propietario de la organización.
              Pasarás a ser administrador. ¿Continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-md"
              disabled={isTransferring}
              onClick={() => setTransferOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="rounded-md"
              disabled={isTransferring}
              onClick={() =>
                currentMemberId &&
                transferOwnership(
                  {
                    newOwnerMemberId: member.id,
                    currentOwnerMemberId: currentMemberId
                  },
                  { onSuccess: () => setTransferOpen(false) }
                )
              }
            >
              {isTransferring ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <CrownIcon />
              )}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Eliminar miembro</DialogTitle>
            <DialogDescription>
              ¿Seguro que deseas eliminar a {displayName} de la organización?
              Perderá el acceso a su contenido.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-md"
              disabled={isRemoving}
              onClick={() => setRemoveOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="rounded-md"
              disabled={isRemoving}
              onClick={() =>
                removeMember(member.id, {
                  onSuccess: () => setRemoveOpen(false)
                })
              }
            >
              {isRemoving ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Trash2Icon />
              )}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

export default function OrganizationMembersPage() {
  const activeOrganizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )
  const currentUserId = useAuth(state => state.auth?.user.id)
  const { data: roleData } = useActiveMemberRole(activeOrganizationId)
  const { data, isLoading, isError } = useMembers(
    activeOrganizationId ?? undefined
  )
  const { data: organizations = [] } = useOrganizations()
  const organization = organizations.find(
    item => item.id === activeOrganizationId
  )
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  const currentRole = roleData?.role
  const members = data?.members ?? []
  const currentMemberId = members.find(
    member => member.userId === currentUserId
  )?.id
  const canAdd = can(currentRole, 'member:add')

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader
        icon={<UsersIcon />}
        title="Miembros"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'persona' : 'personas'} en esta organización`
            : 'Personas que pertenecen a esta organización.'
        }
        action={
          canAdd ? (
            <Button className="rounded-md" onClick={() => setInviteOpen(true)}>
              <UserPlusIcon />
              Agregar miembro
            </Button>
          ) : undefined
        }
      />

      <Card className="overflow-hidden py-0">
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : isError ? (
          <p className="p-6 text-sm text-destructive">
            No se pudieron cargar los miembros. Recarga la página e inténtalo de
            nuevo.
          </p>
        ) : members.length > 0 ? (
          <ul className="divide-y">
            {members.map(member => (
              <MemberRow
                key={member.id}
                member={member}
                organizationId={activeOrganizationId ?? ''}
                currentUserId={currentUserId}
                currentRole={currentRole}
                currentMemberId={currentMemberId}
              />
            ))}
          </ul>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            Esta organización aún no tiene miembros.
          </p>
        )}
      </Card>

      {organization ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Salir de la organización</p>
            <p className="text-xs text-muted-foreground">
              Dejarás de ser miembro y perderás el acceso a su contenido.
            </p>
          </div>
          <Button
            variant="outline"
            className="rounded-md"
            onClick={() => setLeaveOpen(true)}
          >
            <LogOutIcon />
            Salir
          </Button>
        </div>
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar miembro</DialogTitle>
            <DialogDescription>
              Invita a una persona por email. Se unirá cuando acepte la
              invitación.
            </DialogDescription>
          </DialogHeader>
          {activeOrganizationId ? (
            <InviteMemberForm organizationId={activeOrganizationId} />
          ) : null}
        </DialogContent>
      </Dialog>

      {organization ? (
        <LeaveOrganizationDialog
          organization={organization}
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
        />
      ) : null}
    </div>
  )
}
