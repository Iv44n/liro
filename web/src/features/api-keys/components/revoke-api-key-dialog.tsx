import { Loader2Icon, TrashIcon } from 'lucide-react'
import type { ApiKeyView } from '#/sdk/modules/api-keys/types'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { useRevokeApiKey } from '../hooks/use-api-keys'
import { maskedApiKey } from '../utils/api-key'

/** Confirms revoking a key: it stops working immediately, and this can't be undone. */
export function RevokeApiKeyDialog({
  apiKey,
  open,
  onOpenChange
}: {
  apiKey: ApiKeyView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const revokeApiKey = useRevokeApiKey()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Revocar API key</DialogTitle>
          <DialogDescription>
            {apiKey ? (
              <>
                «{apiKey.name || maskedApiKey(apiKey)}» dejará de funcionar de
                inmediato. Cualquier sistema que la use empezará a recibir
                errores. Esta acción no se puede deshacer.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={revokeApiKey.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={revokeApiKey.isPending || !apiKey}
            onClick={() => {
              if (!apiKey) return
              revokeApiKey.mutate(apiKey, {
                onSuccess: () => onOpenChange(false)
              })
            }}
          >
            {revokeApiKey.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <TrashIcon />
            )}
            Revocar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
