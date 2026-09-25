import { Trash2Icon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { Spinner } from '#/shared/components/ui/spinner'
import { useDeleteEffectBinding } from '../hooks/use-effect-mutations'
import type { EffectBindingView } from '../types'
import { triggerLabel } from '../utils/labels'

/** Confirms deleting an effect binding; can't be undone. */
export function EffectDeleteDialog({
  templateId,
  binding,
  open,
  onOpenChange
}: {
  templateId: string
  binding: EffectBindingView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const deleteBinding = useDeleteEffectBinding(templateId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Eliminar efecto</DialogTitle>
          <DialogDescription>
            {binding ? (
              <>
                Deja de dispararse para «{triggerLabel(binding.on)}». Esta
                acción no se puede deshacer.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={deleteBinding.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteBinding.isPending || !binding}
            onClick={() => {
              if (!binding) return
              deleteBinding.mutate(binding, {
                onSuccess: () => onOpenChange(false)
              })
            }}
          >
            {deleteBinding.isPending ? (
              <Spinner />
            ) : (
              <Trash2Icon aria-hidden="true" />
            )}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
