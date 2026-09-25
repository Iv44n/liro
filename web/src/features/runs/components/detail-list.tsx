import type { ReactNode } from 'react'
import { cn } from '#/shared/utils/shadcn.utils'
import { CopyButton } from './copy-button'

export interface DetailItem {
  label: string
  value: ReactNode
  /** Adds a copy button for this raw value. */
  copy?: string | null
  /** Monospace (ids, hashes, model names). */
  mono?: boolean
}

/** A definition list of `label: value` rows; empty values show `—`. */
export function DetailList({
  items,
  className
}: {
  items: readonly DetailItem[]
  className?: string
}) {
  return (
    <dl className={cn('divide-y text-sm', className)}>
      {items.map(item => {
        const empty =
          item.value === null || item.value === undefined || item.value === ''
        return (
          <div
            key={item.label}
            className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'flex min-w-0 items-center gap-1 sm:justify-end sm:text-end',
                item.mono && 'font-mono text-xs'
              )}
            >
              {empty ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="min-w-0 break-all">{item.value}</span>
              )}
              {item.copy ? (
                <CopyButton value={item.copy} label={`Copiar ${item.label}`} />
              ) : null}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
