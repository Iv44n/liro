import { AppError, type ErrorShape } from '../core/app.error'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData'

type PrimitiveBody = BodyInit | null

/**
 * Símbolo de marca para transportar el tipo de error en tiempo de compilación.
 * Nunca existe en runtime — es phantom type metadata.
 */
declare const HTTP_ERROR_SYMBOL: unique symbol

/**
 * Promise con branded type para propagar `TError` a través de inferencia.
 *
 * En runtime es un `Promise<TData>` estándar. El `TError` solo existe
 * en el sistema de tipos para que `InferHttpError` lo pueda extraer.
 */
export type HttpPromise<TData, TError = unknown> = Promise<TData> & {
  readonly [HTTP_ERROR_SYMBOL]?: TError
}

/**
 * Resuelve el tipo de respuesta basado en `TResponseType`.
 * Para `'json'` se retorna `TResponse` directamente.
 */
type InferResponse<
  TResponse,
  TResponseType extends ResponseType
> = TResponseType extends 'text'
  ? string
  : TResponseType extends 'blob'
    ? Blob
    : TResponseType extends 'arrayBuffer'
      ? ArrayBuffer
      : TResponseType extends 'formData'
        ? FormData
        : TResponse

export interface HttpClientConfig
  extends Omit<RequestInit, 'method' | 'body'> {}

export interface RequestOptions<
  TBody = unknown,
  TResponseType extends ResponseType = 'json'
> extends Omit<RequestInit, 'method' | 'body'> {
  body?: TBody | PrimitiveBody

  responseType?: TResponseType

  /**
   * Si `true`:
   * - No serializa JSON automáticamente
   * - No agrega `Content-Type`
   */
  raw?: boolean
}

/** A parsed JSON body together with the response's status and headers. */
export interface HttpResponse<TData> {
  data: TData
  status: number
  headers: Headers
}

export class HttpClient {
  private constructor(
    private readonly baseURL: string,
    private readonly config: HttpClientConfig = {}
  ) {}

  static create(params: {
    baseURL: string
    config?: HttpClientConfig
  }): HttpClient {
    return new HttpClient(params.baseURL, params.config)
  }

  get<TResponse, TError = unknown, TResponseType extends ResponseType = 'json'>(
    path: string,
    options?: RequestOptions<never, TResponseType>
  ): HttpPromise<InferResponse<TResponse, TResponseType>, TError> {
    return this.request<TResponse, never, TError, TResponseType>(
      'GET',
      path,
      options
    )
  }

  post<
    TResponse,
    TBody = unknown,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    path: string,
    options?: RequestOptions<TBody, TResponseType>
  ): HttpPromise<InferResponse<TResponse, TResponseType>, TError> {
    return this.request<TResponse, TBody, TError, TResponseType>(
      'POST',
      path,
      options
    )
  }

  put<
    TResponse,
    TBody = unknown,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    path: string,
    options?: RequestOptions<TBody, TResponseType>
  ): HttpPromise<InferResponse<TResponse, TResponseType>, TError> {
    return this.request<TResponse, TBody, TError, TResponseType>(
      'PUT',
      path,
      options
    )
  }

  patch<
    TResponse,
    TBody = unknown,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    path: string,
    options?: RequestOptions<TBody, TResponseType>
  ): HttpPromise<InferResponse<TResponse, TResponseType>, TError> {
    return this.request<TResponse, TBody, TError, TResponseType>(
      'PATCH',
      path,
      options
    )
  }

  delete<
    TResponse,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    path: string,
    options?: RequestOptions<never, TResponseType>
  ): HttpPromise<InferResponse<TResponse, TResponseType>, TError> {
    return this.request<TResponse, never, TError, TResponseType>(
      'DELETE',
      path,
      options
    )
  }

  /**
   * Like the verb methods (JSON only), but also resolves with the response's
   * status and headers — e.g. to read a draft's `ETag`. Errors are thrown as
   * `AppError`, exactly like the verb methods.
   */
  async requestWithHeaders<TResponse, TBody = unknown>(
    method: HttpMethod,
    path: string,
    options?: RequestOptions<TBody, 'json'>
  ): Promise<HttpResponse<TResponse>> {
    const response = await this.send(method, path, options)
    const data = await this.parseResponse<TResponse, 'json'>(response, 'json')

    return { data, status: response.status, headers: response.headers }
  }

  private request<
    TResponse,
    TBody = unknown,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    method: HttpMethod,
    path: string,
    options?: RequestOptions<TBody, TResponseType>
  ): HttpPromise<InferResponse<TResponse, TResponseType>, TError> {
    return this.executeRequest<TResponse, TBody, TError, TResponseType>(
      method,
      path,
      options
    )
  }

  private async executeRequest<
    TResponse,
    TBody = unknown,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    method: HttpMethod,
    path: string,
    options?: RequestOptions<TBody, TResponseType>
  ): Promise<InferResponse<TResponse, TResponseType>> {
    const response = await this.send<TBody, TError, TResponseType>(
      method,
      path,
      options
    )

    const responseType: ResponseType = options?.responseType ?? 'json'

    return this.parseResponse<TResponse, TResponseType>(
      response,
      responseType as TResponseType
    )
  }

  /** Performs the request; a non-2xx response is thrown as an `AppError`. */
  private async send<
    TBody = unknown,
    TError = unknown,
    TResponseType extends ResponseType = 'json'
  >(
    method: HttpMethod,
    path: string,
    options?: RequestOptions<TBody, TResponseType>
  ): Promise<Response> {
    const { body, raw, responseType: _responseType, ...init } = options ?? {}
    const isRaw = raw ?? this.isRawBody(body)
    const headers = this.mergeHeaders(this.config.headers, init.headers)

    if (
      !isRaw &&
      body !== undefined &&
      body !== null &&
      !headers.has('Content-Type')
    ) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(this.buildURL(path), {
      ...this.config,
      ...init,
      method,
      headers,
      body: this.serializeBody(body, isRaw)
    })

    if (!response.ok) {
      const errorData = await this.parseErrorResponse(response)

      throw this.normalizeHttpError<TError>(errorData, response.status)
    }

    return response
  }

  private buildURL(path: string): URL {
    const base = this.baseURL.endsWith('/') ? this.baseURL : `${this.baseURL}/`
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path

    return new URL(normalizedPath, base)
  }

  private isRawBody(body: unknown): body is BodyInit {
    return (
      body instanceof FormData ||
      body instanceof Blob ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body) ||
      body instanceof URLSearchParams ||
      body instanceof ReadableStream ||
      typeof body === 'string'
    )
  }

  private serializeBody(body: unknown, raw: boolean): BodyInit | undefined {
    if (body === undefined || body === null) {
      return undefined
    }

    if (raw && this.isRawBody(body)) {
      return body
    }

    return JSON.stringify(body)
  }

  private async parseResponse<TResponse, TResponseType extends ResponseType>(
    response: Response,
    responseType: TResponseType
  ): Promise<InferResponse<TResponse, TResponseType>> {
    if (response.status === 204 || response.status === 205) {
      return undefined as InferResponse<TResponse, TResponseType>
    }

    switch (responseType) {
      case 'text':
        return (await response.text()) as InferResponse<
          TResponse,
          TResponseType
        >

      case 'blob':
        return (await response.blob()) as InferResponse<
          TResponse,
          TResponseType
        >

      case 'arrayBuffer':
        return (await response.arrayBuffer()) as InferResponse<
          TResponse,
          TResponseType
        >

      case 'formData':
        return (await response.formData()) as InferResponse<
          TResponse,
          TResponseType
        >

      default:
        return (await this.safeParseJson(
          response,
          'response'
        )) as InferResponse<TResponse, TResponseType>
    }
  }

  private async parseErrorResponse(response: Response): Promise<unknown> {
    if (response.status === 204 || response.status === 205) {
      return undefined
    }

    const contentType = response.headers.get('content-type')

    if (contentType?.includes('json')) {
      return this.safeParseJson(response, 'error')
    }

    return response.text()
  }

  private async safeParseJson(
    response: Response,
    kind: 'response' | 'error'
  ): Promise<unknown> {
    const text = await response.text()

    if (!text.trim()) {
      return undefined
    }

    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new AppError({
        message: `Invalid JSON ${kind} body`,
        code:
          kind === 'response' ? 'INVALID_JSON_RESPONSE' : 'INVALID_JSON_ERROR',
        details: {
          status: response.status,
          contentType: response.headers.get('content-type')
        }
      })
    }
  }

  private normalizeHttpError<TDetails>(
    data: unknown,
    status: number
  ): AppError<TDetails> {
    if (data && typeof data === 'object') {
      // Liro's API wraps errors (`{ error: { code, message, details } }`);
      // better-auth's endpoints return them flat.
      const wrapped = (data as { error?: unknown }).error
      const error = (
        wrapped && typeof wrapped === 'object' ? wrapped : data
      ) as Partial<ErrorShape<TDetails>>

      return new AppError<TDetails>({
        message: error.message ?? 'Request failed',
        code: error.code ?? `HTTP_${status}`,
        details: error.details,
        status
      })
    }

    return new AppError<TDetails>({
      message: typeof data === 'string' ? data : 'Request failed',
      code: `HTTP_${status}`,
      status
    })
  }

  private mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
    const headers = new Headers()

    for (const source of sources) {
      if (!source) continue

      new Headers(source).forEach((value, key) => {
        headers.set(key, value)
      })
    }

    return headers
  }
}
