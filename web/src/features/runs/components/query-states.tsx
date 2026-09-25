import { AlertTriangleIcon, RefreshCwIcon, SearchXIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppError } from '#/sdk/core/app.error'
import { Button } from '#/shared/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'

export const isNotFoundError = (error: unknown) =>
  error instanceof AppError &&
  (error.status === 404 || error.code === 'NOT_FOUND')

/** A failed load, with the API's message and a retry button. */
export function ErrorState({
  title,
  error,
  onRetry,
  isRetrying
}: {
  title: string
  error: unknown
  onRetry?: () => void
  isRetrying?: boolean
}) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Ocurrió un error inesperado.'

  return (
    <Empty className="border" role="alert">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="bg-destructive/10 text-destructive"
        >
          <AlertTriangleIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" onClick={onRetry} disabled={isRetrying}>
            <RefreshCwIcon
              aria-hidden="true"
              className={isRetrying ? 'animate-spin' : undefined}
            />
            Reintentar
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

/** A resource that doesn't exist (or belongs to another organization). */
export function NotFoundState({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
