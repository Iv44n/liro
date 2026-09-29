import type { ErrorHandler } from '@arcton/contracts'
import { HttpError, ValidationError } from '@arcton/core'
import z from 'zod'
import { log } from '#shared/config/logger'

/**
 * An `HttpError` that can also set response headers (e.g. `Retry-After`).
 * Everything thrown from a route should be an `HttpError`/`ApiError`; anything
 * else is reported as a 500 and logged.
 */
export class ApiError extends HttpError {
  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {}
  ) {
    super(status, code, message, options.details)
    this.headers = options.headers ?? {}
  }

  readonly headers: Record<string, string>
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
}

interface NormalizedIssue {
  path: string
  message: string
  code?: string
}

/** Path segments as arcton/`StandardSchema` issues carry them, or as zod's own. */
type IssuePath = ReadonlyArray<PropertyKey | { key: PropertyKey }>

function normalizeIssues(
  issues: ReadonlyArray<{ message: string; path?: IssuePath; code?: string }>
): NormalizedIssue[] {
  return issues.map(issue => ({
    path: (issue.path ?? [])
      .map(segment =>
        typeof segment === 'object' ? String(segment.key) : String(segment)
      )
      .join('.'),
    message: issue.message,
    code: issue.code
  }))
}

export const errorHandler: ErrorHandler = (err, ctx): ErrorBody => {
  if (err instanceof ValidationError) {
    // arcton's own synthetic issue for a body that failed to parse at all
    // (e.g. malformed JSON) — no `path`, unlike a real schema issue.
    const issue = err.issues.length === 1 ? err.issues[0] : undefined
    if (issue !== undefined && issue.path === undefined) {
      ctx.response.status = 400
      return {
        error: {
          code: 'INVALID_JSON',
          message: 'Request body is not valid JSON'
        }
      }
    }

    ctx.response.status = 422
    return {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: { issues: normalizeIssues(err.issues) }
      }
    }
  }

  if (err instanceof HttpError) {
    ctx.response.status = err.status

    if (err instanceof ApiError) {
      for (const [name, value] of Object.entries(err.headers)) {
        ctx.response.headers.set(name, value)
      }
    }

    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.body === undefined ? {} : { details: err.body })
      }
    }
  }

  if (err instanceof z.ZodError) {
    ctx.response.status = 422
    return {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: { issues: normalizeIssues(err.issues) }
      }
    }
  }

  log.logger.error('Unhandled error', {
    error:
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : String(err),
    method: ctx.request.method,
    url: ctx.request.url
  })

  ctx.response.status = 500
  return {
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' }
  }
}
