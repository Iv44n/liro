import { Link } from '@tanstack/react-router'
import { Loader2Icon, LogOutIcon, UsersIcon } from 'lucide-react'
import { useAuth } from '#/features/auth/store/auth'
import type { Organization } from '#/sdk/modules/organization/types'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { useLeaveOrganization } from '../hooks/use-leave-organization'
import { useMembers } from '../hooks/use-members'
import { isOwner } from '../utils/permissions'

/**
 * Diálogo de confirmación para salir de una organización. Detecta de forma
 * proactiva el caso del único propietario: en ese caso bloquea la salida y pide
 * transferir la propiedad primero (el servidor también lo impide, pero así el
 * mensaje es claro y en español). Funciona con cualquier organización del
 * usuario, sea o no la activa.
 */
export function LeaveOrganizationDialog({
  organization,
  open,
  onOpenChange
}: {
  organization: Organization
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const currentUserId = useAuth(state => state.auth?.user.id)
  const { data, isLoading } = useMembers(organization.id, open)
  const { leaveOrganization, isPending } = useLeaveOrganization()

  const members = data?.members ?? []
  const myMember = members.find(member => member.userId === currentUserId)
  const ownersCount = members.filter(member => isOwner(member.role)).length
  const isSoleOwner = isOwner(myMember?.role) && ownersCount <= 1
  // Si no hay nadie más, la propiedad no puede transferirse: la única salida es
  // eliminar la organización.
  const hasOtherMembers = members.some(
    member => member.userId !== currentUserId
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Salir de la organización</DialogTitle>
          <DialogDescription>
            {isSoleOwner
              ? hasOtherMembers
                ? `Eres el único propietario de "${organization.name}". Transfiere la propiedad a otro miembro antes de salir.`
                : `Eres el único miembro de "${organization.name}". No puedes salir; elimina la organización si ya no la necesitas.`
              : `¿Seguro que deseas salir de "${organization.name}"? Perderás el acceso a su contenido.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            className="rounded-md"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          {isSoleOwner ? (
            hasOtherMembers ? (
              <Button
                className="rounded-md"
                render={<Link to="/organization/members" />}
                onClick={() => onOpenChange(false)}
              >
                <UsersIcon />
                Ir a miembros
              </Button>
            ) : null
          ) : (
            <Button
              variant="destructive"
              className="rounded-md"
              disabled={isPending || isLoading}
              onClick={() =>
                leaveOrganization(organization.id, {
                  onSuccess: () => onOpenChange(false)
                })
              }
            >
              {isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LogOutIcon />
              )}
              Salir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
