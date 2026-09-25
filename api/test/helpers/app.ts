import type {
  RuntimeAdapter,
  RuntimeHandler,
  RuntimeRequestContext
} from '@arcton/contracts'
import { createApp, MAX_BODY_SIZE, openapiIntegration } from '#/app'

/**
 * Serves `createApp()` through a capturing runtime adapter — the same
 * technique as `@arcton/core`'s own tests — so requests go through the full
 * pipeline (middleware, providers, onError) without opening a port.
 */
function createInMemoryServer(): RuntimeHandler {
  let handler: RuntimeHandler | undefined

  const adapter: RuntimeAdapter = {
    name: 'test',
    version: '0.0.0',
    capabilities: { websocket: false },
    serve(options) {
      handler = options.fetch
      return {
        port: 0,
        url: new URL('http://localhost'),
        stop() {}
      }
    }
  }

  createApp().listen({
    port: 0,
    adapter,
    env: 'test',
    maxBodySize: MAX_BODY_SIZE,
    openapi: openapiIntegration()
  })

  if (!handler)
    throw new Error('createApp().listen() did not register a handler')
  return handler
}

const noopContext: RuntimeRequestContext = { upgrade: () => false }

export interface RequestOptions {
  body?: unknown
  /** Sent as `x-api-key`. */
  apiKey?: string
  /** Sent as `Authorization: Bearer …` instead of `x-api-key`. */
  bearer?: string
  cookie?: string
  headers?: Record<string, string>
}

export interface TestApi {
  request(
    method: string,
    path: string,
    options?: RequestOptions
  ): Promise<Response>
  get(path: string, options?: RequestOptions): Promise<Response>
  post(path: string, options?: RequestOptions): Promise<Response>
  delete(path: string, options?: RequestOptions): Promise<Response>
}

let server: RuntimeHandler | undefined

export function testApi(): TestApi {
  server ??= createInMemoryServer()
  const handler = server

  const request = async (
    method: string,
    path: string,
    options: RequestOptions = {}
  ) => {
    const headers = new Headers(options.headers)
    if (options.apiKey) headers.set('x-api-key', options.apiKey)
    if (options.bearer) headers.set('authorization', `Bearer ${options.bearer}`)
    if (options.cookie) headers.set('cookie', options.cookie)

    let body: string | undefined
    if (options.body !== undefined) {
      body =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
      if (!headers.has('content-type'))
        headers.set('content-type', 'application/json')
    }

    const response = await handler(
      new Request(new URL(path, 'http://localhost:3002').toString(), {
        method,
        headers,
        body
      }),
      noopContext
    )
    if (!response) throw new Error(`No response for ${method} ${path}`)
    return response
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    delete: (path, options) => request('DELETE', path, options)
  }
}

/** `response.json()` typed loosely for assertions (Bun types it as `unknown`). */
// biome-ignore lint/suspicious/noExplicitAny: test assertions inspect arbitrary JSON
export const json = (response: Response): Promise<any> => response.json()
