import type { ReactNode } from 'react'
import { Card, CardContent } from '#/shared/components/ui/card'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { cn } from '#/shared/utils/shadcn.utils'

/** One number of the dashboard's quick-stats row. */
export function StatCard({
  icon,
  label,
  value,
  hint,
  loading,
  tone = 'default',
  className
}: {
  icon: ReactNode
  label: string
  /** Already formatted (e.g. `formatNumber(value, 0)`). */
  value: string
  hint?: string
  loading?: boolean
  tone?: 'default' | 'warning'
  className?: string
}) {
  return (
    <Card size="sm" className={cn('gap-3', className)}>
      <CardContent className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4.5',
            tone === 'warning'
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
              : 'bg-primary/10 text-primary'
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-12" />
          ) : (
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          )}
          {hint ? (
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
