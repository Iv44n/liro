import { cn } from '#/shared/utils/shadcn.utils'
import { formatPercent, formatProbability } from '../utils/format'

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** A horizontal bar for a value in [0, 1] (decorative: pair it with text). */
export function MeterBar({
  value,
  highlighted = true,
  className
}: {
  value: number
  highlighted?: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-muted',
        className
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width]',
          highlighted ? 'bg-primary' : 'bg-muted-foreground/35'
        )}
        style={{ width: `${clamp(value) * 100}%` }}
      />
    </div>
  )
}

/** Confidence as a percentage with a small bar; `—` when there is none. */
export function ConfidenceMeter({
  value,
  className
}: {
  value: number | null | undefined
  className?: string
}) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <MeterBar value={value} className="w-12 sm:w-16" />
      <span className="text-xs tabular-nums">{formatPercent(value)}</span>
    </span>
  )
}

/** One option / level / side of an answer: name, bar and probability. */
export function ProbabilityRow({
  label,
  probability,
  selected
}: {
  label: string
  probability: number
  selected: boolean
}) {
  return (
    <li className="grid grid-cols-[minmax(0,8rem)_1fr_3.5rem] items-center gap-2 text-xs sm:grid-cols-[minmax(0,10rem)_1fr_3.5rem]">
      <span
        title={label}
        className={cn(
          'truncate font-mono',
          selected ? 'font-semibold text-foreground' : 'text-muted-foreground'
        )}
      >
        {label}
        {selected ? <span className="sr-only"> (elegida)</span> : null}
      </span>
      <MeterBar value={probability} highlighted={selected} />
      <span
        className={cn(
          'text-end tabular-nums',
          selected ? 'font-semibold' : 'text-muted-foreground'
        )}
      >
        {formatProbability(probability)}
      </span>
    </li>
  )
}
