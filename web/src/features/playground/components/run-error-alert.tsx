import { CircleAlertIcon, RotateCwIcon } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Spinner } from '#/shared/components/ui/spinner'
import type { RunErrorView } from '../utils/run-errors'

/**
 * A failed run, inline: title and description, the lint issues or input
 * issues that no form field shows, and a retry button when it may help.
 */
export function RunErrorAlert({
  error,
  onRetry,
  retrying = false,
  /** Field errors are shown on the form's fields (only in form mode). */
  fieldsShown = true
}: {
  error: RunErrorView
  onRetry?: () => void
  retrying?: boolean
  fieldsShown?: boolean
}) {
  const issues = [
    ...error.issues,
    ...(fieldsShown
      ? []
      : Object.entries(error.fieldErrors).map(([path, message]) => ({
          path,
          message
        })))
  ]

  return (
    <Alert variant="destructive" aria-live="assertive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{error.description}</p>

        {error.lint.length > 0 ? (
          <ul className="space-y-1.5">
            {error.lint.map(issue => (
              <li
                key={`${issue.severity}:${issue.code}:${issue.path}:${issue.message}`}
                className="rounded-md bg-destructive/5 px-2 py-1.5 text-xs"
              >
                <span className="font-medium">
                  {issue.severity === 'error' ? 'Error' : 'Aviso'}
                </span>{' '}
                <code className="font-mono">{issue.code}</code>
                {issue.path ? (
                  <code className="ms-1 font-mono opacity-80">
                    en {issue.path}
                  </code>
                ) : null}
                <p className="opacity-90">{issue.message}</p>
              </li>
            ))}
          </ul>
        ) : null}

        {issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 ps-4 text-xs">
            {issues.map(issue => (
              <li key={`${issue.path}:${issue.message}`}>
                {issue.path ? (
                  <code className="font-mono">{issue.path}</code>
                ) : (
                  'Entrada'
                )}
                : {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {error.technical && error.lint.length === 0 && issues.length === 0 ? (
          <p className="text-xs opacity-75">
            <code className="font-mono">{error.code}</code> · {error.technical}
          </p>
        ) : null}

        {error.retryable && onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={retrying}
            className="mt-1"
          >
            {retrying ? <Spinner /> : <RotateCwIcon aria-hidden />}
            Reintentar
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
