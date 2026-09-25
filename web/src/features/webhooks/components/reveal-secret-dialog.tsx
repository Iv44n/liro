import { EyeIcon, Loader2Icon } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '#/features/runs/components/copy-button'
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
import { useRevealWebhookSecret } from '../hooks/use-webhook-secret'

/** "Revelar secreto": confirms, then fetches and shows the current signing secret. */
export function RevealSecretDialog({ endpointId }: { endpointId: string }) {
  const [open, setOpen] = useState(false)
  const reveal = useRevealWebhookSecret(endpointId)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reveal.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" />}>
        <EyeIcon aria-hidden="true" />
        Revelar secreto
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Secreto de firma</DialogTitle>
          <DialogDescription>
            Úsalo para verificar que las entregas vienen de Liro. Cualquiera con
            acceso a esta pantalla podrá verlo.
          </DialogDescription>
        </DialogHeader>

        {reveal.data ? (
          <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 truncate font-mono text-sm">
              {reveal.data.secret}
            </code>
            <CopyButton
              value={reveal.data.secret}
              label="Copiar secreto"
              variant="secondary"
              successMessage="Secreto copiado"
            />
          </div>
        ) : (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reveal.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              {reveal.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <EyeIcon />
              )}
              Revelar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
