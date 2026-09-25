import { Loader2Icon, Trash2Icon } from 'lucide-react'
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
import { useDeleteOrganization } from '../hooks/use-delete-organization'

/**
 * Diálogo de confirmación para eliminar una organización (solo el propietario
 * tiene permiso; el servidor lo valida). Al eliminarla, el hook refresca la
 * sesión y reevalúa los guards (que pueden redirigir al onboarding/selector).
 */
export function DeleteOrganizationDialog({
  organization,
  open,
  onOpenChange
}: {
  organization: Organization
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { deleteOrganization, isPending } = useDeleteOrganization()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Eliminar organización</DialogTitle>
          <DialogDescription>
            ¿Seguro que deseas eliminar "{organization.name}"? Esta acción no se
            puede deshacer y se eliminarán sus miembros e invitaciones.
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
          <Button
            variant="destructive"
            className="rounded-md"
            disabled={isPending}
            onClick={() =>
              deleteOrganization(organization.id, {
                onSuccess: () => onOpenChange(false)
              })
            }
          >
            {isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <Trash2Icon />
            )}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
