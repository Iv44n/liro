import type { ReactNode } from 'react'

/** Title block of the templates pages: icon chip, title, description and an action. */
export function PageHeader({
  title,
  description,
  icon,
  action
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
            aria-hidden="true"
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}
