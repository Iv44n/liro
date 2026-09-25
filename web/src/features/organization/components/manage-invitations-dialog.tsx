import type { Organization } from '#/sdk/modules/organization/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { InvitationsManager } from './invitations-manager'

export function ManageInvitationsDialog({
  organization,
  open,
  onOpenChange
}: {
  organization: Organization
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitaciones</DialogTitle>
          <DialogDescription>
            Invita personas a "{organization.name}" y gestiona las invitaciones
            enviadas.
          </DialogDescription>
        </DialogHeader>

        {/* Solo se piden las invitaciones mientras el diálogo está abierto. */}
        <InvitationsManager organizationId={organization.id} enabled={open} />
      </DialogContent>
    </Dialog>
  )
}
