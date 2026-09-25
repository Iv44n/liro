import { cn } from '#/shared/utils/shadcn.utils'
import { CopyButton } from './copy-button'

/** Pretty-printed JSON with a copy button; scrolls when long. */
export function JsonBlock({
  value,
  label,
  className
}: {
  value: unknown
  /** Accessible name of the block (e.g. "Entrada en JSON"). */
  label: string
  className?: string
}) {
  const text = JSON.stringify(value, null, 2) ?? 'null'

  return (
    <div className={cn('relative', className)}>
      <section aria-label={label}>
        <pre
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions must be reachable by keyboard.
          tabIndex={0}
          className="max-h-96 overflow-auto rounded-xl border bg-muted/40 p-3 pe-10 font-mono text-xs leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {text}
        </pre>
      </section>
      <CopyButton
        value={text}
        label={`Copiar ${label.toLowerCase()}`}
        className="absolute end-1.5 top-1.5"
      />
    </div>
  )
}
