import { Link } from '@tanstack/react-router'
import { CheckIcon, ChevronRightIcon, RocketIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { cn } from '#/shared/utils/shadcn.utils'

export interface ChecklistStep {
  title: string
  description: string
  done: boolean
  /** Present only when the step isn't done and the role may act on it. */
  to?: ComponentProps<typeof Link>['to']
  ctaLabel?: string
}

function StepRow({ step, index }: { step: ChecklistStep; index: number }) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          step.done
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {step.done ? <CheckIcon className="size-3.5" /> : index + 1}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          className={cn(
            'block text-sm font-medium',
            step.done && 'text-muted-foreground line-through'
          )}
        >
          {step.title}
        </span>
        <span className="block text-xs text-muted-foreground">
          {step.description}
        </span>
      </span>
      {!step.done && step.to ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 self-center text-muted-foreground"
        />
      ) : null}
    </>
  )

  if (!step.done && step.to) {
    return (
      <li>
        <Link
          to={step.to}
          className="flex items-center gap-3 rounded-xl p-2 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {content}
        </Link>
      </li>
    )
  }

  return <li className="flex items-center gap-3 p-2">{content}</li>
}

function ChecklistSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <Skeleton key={index} className="h-10 w-full rounded-xl" />
      ))}
    </div>
  )
}

/** The onboarding checklist: crear decisión → publicar → API key → ejecución. */
export function GettingStartedChecklist({
  steps,
  loading,
  action
}: {
  steps: ChecklistStep[]
  loading: boolean
  /** Shown when every step is done. */
  action?: ReactNode
}) {
  const allDone = !loading && steps.every(step => step.done)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RocketIcon aria-hidden="true" className="size-4 text-primary" />
          Primeros pasos
        </CardTitle>
        <CardDescription>
          {allDone
            ? 'Completaste la configuración inicial.'
            : 'Pon en marcha tu primera decisión en minutos.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <ChecklistSkeleton />
        ) : (
          <ol className="space-y-1">
            {steps.map((step, index) => (
              <StepRow key={step.title} step={step} index={index} />
            ))}
          </ol>
        )}
        {allDone && action ? <div className="mt-3">{action}</div> : null}
      </CardContent>
    </Card>
  )
}
