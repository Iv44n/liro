import { cn } from '#/shared/utils/shadcn.utils'
import { clamp01, formatPercent } from '../utils/format'

/**
 * A labelled 0..1 bar (probability, confidence, signal). The text carries
 * the value; the bar itself is decorative.
 */
export function ProbabilityBar({
  label,
  value,
  selected = false,
  tone = 'primary',
  mono = true,
  valueLabel
}: {
  label: string
  value: number
  /** The winning option / level: stronger bar and bold label. */
  selected?: boolean
  tone?: 'primary' | 'warning' | 'destructive' | 'muted'
  /** Render the label in a monospace font (option names, keys). */
  mono?: boolean
  /** Overrides the formatted percentage. */
  valueLabel?: string
}) {
  const width = `${clamp01(value) * 100}%`

  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs @sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
      <span
        className={cn(
          'truncate',
          mono && 'font-mono',
          selected ? 'font-semibold text-foreground' : 'text-muted-foreground'
        )}
        title={label}
      >
        {label}
      </span>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            tone === 'primary' && (selected ? 'bg-primary' : 'bg-primary/45'),
            tone === 'warning' && 'bg-amber-500',
            tone === 'destructive' && 'bg-destructive',
            tone === 'muted' && 'bg-muted-foreground/50'
          )}
          style={{ width }}
        />
      </div>
      <span
        className={cn(
          'min-w-12 text-end tabular-nums',
          selected ? 'font-semibold text-foreground' : 'text-muted-foreground'
        )}
      >
        {valueLabel ?? formatPercent(value)}
      </span>
    </div>
  )
}
