import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '#/shared/components/ui/alert-dialog'
import { Button } from '#/shared/components/ui/button'
import type { DraftSaving } from '../hooks/use-draft-saving'

/**
 * 409 `DRAFT_CONFLICT` on save: someone else's edit landed first. Stays
 * open (it's not a plain "cancel" dialog) until the chosen action finishes
 * — `useDraftSaving` closes it itself once it has.
 */
export function DraftConflictDialog({ saving }: { saving: DraftSaving }) {
  const { conflict, resolving, reloadSaved, overwrite, dismissConflict } =
    saving

  return (
    <AlertDialog
      open={conflict !== null}
      onOpenChange={open => {
        if (!open) dismissConflict()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>El borrador cambió mientras tanto</AlertDialogTitle>
          <AlertDialogDescription>
            Alguien más guardó otros cambios en este borrador desde que lo
            abriste. Elige qué hacer con los tuyos: descartarlos y ver la
            versión guardada, o sobrescribirla con los tuyos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            className="rounded-md"
            onClick={reloadSaved}
            disabled={resolving !== null}
          >
            {resolving === 'reload' ? 'Recargando…' : 'Descartar los míos'}
          </Button>
          <Button
            className="rounded-md"
            onClick={overwrite}
            disabled={resolving !== null}
          >
            {resolving === 'overwrite'
              ? 'Sobrescribiendo…'
              : 'Sobrescribir con los míos'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
