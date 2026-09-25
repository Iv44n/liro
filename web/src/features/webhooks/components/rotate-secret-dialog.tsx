import { Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '#/features/runs/components/copy-button'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '#/shared/components/ui/dialog'
import { useRotateWebhookSecret } from '../hooks/use-webhook-secret'

/**
 * "Rotar secreto": explains the 24h overlap window, then shows the fresh
 * secret once it's generated.
 */
export function RotateSecretDialog({ endpointId }: { endpointId: string }) {
  const [open, setOpen] = useState(false)
  const rotate = useRotateWebhookSecret(endpointId)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) rotate.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      disablePointerDismissal={Boolean(rotate.data)}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <RefreshCwIcon aria-hidden="true" />
        Rotar secreto
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!rotate.data}>
        <DialogHeader>
          <DialogTitle>Rotar secreto</DialogTitle>
          <DialogDescription>
            Se genera un secreto nuevo; el anterior sigue siendo válido 24 horas
            más (las entregas se firman con ambos mientras tanto), así que
            puedes actualizar tu verificación sin perder entregas.
          </DialogDescription>
        </DialogHeader>

        {rotate.data ? (
          <>
            <Alert>
              <AlertDescription>
                Guarda el nuevo secreto ahora: no volverá a mostrarse.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">
                {rotate.data.secret}
              </code>
              <CopyButton
                value={rotate.data.secret}
                label="Copiar secreto"
                variant="secondary"
                successMessage="Secreto copiado"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                className="w-full"
                onClick={() => onOpenChange(false)}
              >
                Listo, ya lo copié
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rotate.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {rotate.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              Rotar secreto
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
