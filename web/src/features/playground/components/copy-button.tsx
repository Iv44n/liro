import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/shared/components/ui/button'
import { cn } from '#/shared/utils/shadcn.utils'

/**
 * Copies `text` to the clipboard; the icon turns into a check for a moment
 * (announced to screen readers). Falls back to a toast when the clipboard is
 * unavailable (insecure origin, denied permission).
 */
export function CopyButton({
  text,
  label = 'Copiar',
  showLabel = false,
  className,
  size
}: {
  text: string
  /** Accessible name (and visible text with `showLabel`). */
  label?: string
  showLabel?: boolean
  className?: string
  size?: 'xs' | 'sm' | 'icon-xs' | 'icon-sm'
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('No se pudo copiar', {
        description: 'Tu navegador no permitió acceder al portapapeles.'
      })
    }
  }

  const Icon = copied ? CheckIcon : CopyIcon

  return (
    <Button
      type="button"
      variant="ghost"
      size={size ?? (showLabel ? 'xs' : 'icon-xs')}
      onClick={copy}
      aria-label={showLabel ? undefined : label}
      title={label}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      <Icon aria-hidden className={cn(copied && 'text-primary')} />
      {showLabel ? <span>{copied ? 'Copiado' : label}</span> : null}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copiado al portapapeles' : ''}
      </span>
    </Button>
  )
}
