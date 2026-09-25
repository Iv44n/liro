import type { ReactNode } from 'react'

/**
 * The header of the runs, reviews, API keys and dashboard pages: an icon
 * chip, the title, a description and optional actions (which wrap below on
 * narrow screens).
 */
export function PageHeader({
  title,
  description,
  icon,
  action,
  eyebrow
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  /** Small content above the title, e.g. a back link. */
  eyebrow?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 space-y-1">
          {eyebrow}
          <h1 className="text-xl font-semibold tracking-tight break-words">
            {title}
          </h1>
          {description ? (
            <div className="text-sm text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </div>
      {action ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {action}
        </div>
      ) : null}
    </header>
  )
}
