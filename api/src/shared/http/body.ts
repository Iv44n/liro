import type z from 'zod'
import { ApiError, parseOrThrow } from './errors'

/**
 * Reads a JSON request body and validates it with `schema`, failing in the
 * public error format (`400 INVALID_JSON` / `422 VALIDATION_FAILED`). Routes
 * use this instead of `RouteOptions.body`, whose failures bypass `onError`.
 */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<z.output<T>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Expected Content-Type: application/json'
    )
  }

  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON')
  }

  return parseOrThrow(schema, value)
}
