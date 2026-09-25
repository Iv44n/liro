import type { ErrorHandler } from '@arcton/contracts'
import { HttpError } from '@arcton/core'
import type z from 'zod'
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

/**
 * Validates `value` against `schema`, throwing a `422 VALIDATION_FAILED` in
 * the public error format. Used instead of `RouteOptions.body` on `/v1`:
 * Arcton answers route-level validation failures with its own raw
 * `400 { issues }` response, which bypasses `onError`.
 */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown
): z.output<T> {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Request validation failed', {
      details: {
        issues: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code
        }))
      }
    })
  }

  return result.data
}

export const errorHandler: ErrorHandler = (err, ctx): ErrorBody => {
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
