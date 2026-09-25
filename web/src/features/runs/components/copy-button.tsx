import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/shared/components/ui/button'
import { cn } from '#/shared/utils/shadcn.utils'

/** Copies `value` to the clipboard; the icon confirms for two seconds. */
export function CopyButton({
  value,
  label = 'Copiar',
  successMessage = 'Copiado al portapapeles',
  showLabel = false,
  variant = 'ghost',
  size,
  className
}: {
  value: string
  /** Accessible name (and visible text with `showLabel`). */
  label?: string
  successMessage?: string
  showLabel?: boolean
  variant?: 'ghost' | 'outline' | 'secondary' | 'default'
  size?: 'default' | 'sm' | 'xs' | 'icon' | 'icon-sm' | 'icon-xs'
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current)
    },
    []
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(successMessage)
      if (timeout.current) clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar', {
        description: 'Tu navegador bloqueó el portapapeles. Cópialo a mano.'
      })
    }
  }

  const Icon = copied ? CheckIcon : CopyIcon

  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (showLabel ? 'sm' : 'icon-xs')}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
      className={cn(!showLabel && 'text-muted-foreground', className)}
      onClick={copy}
    >
      <Icon aria-hidden="true" />
      {showLabel ? (copied ? 'Copiado' : label) : null}
    </Button>
  )
}
