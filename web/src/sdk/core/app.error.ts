export interface ErrorShape<TDetails = unknown> {
  message: string
  code: string
  details?: TDetails
  /** HTTP status of the failed response, when the error came from one. */
  status?: number
}

export class AppError<TDetails = unknown> extends Error {
  override readonly name = 'ApiError'
  readonly code: string
  readonly details?: TDetails
  /** HTTP status of the failed response (`undefined` for client-side errors). */
  readonly status?: number

  constructor(error: ErrorShape<TDetails>, options?: { cause?: unknown }) {
    super(error.message, options)

    this.code = error.code
    this.details = error.details
    this.status = error.status
  }

  serialize(): ErrorShape<TDetails> {
    return {
      message: this.message,
      code: this.code,
      details: this.details,
      status: this.status
    }
  }

  static fromUnknown<TDetails = unknown>(error: unknown): AppError<TDetails> {
    if (error instanceof AppError) {
      return error as AppError<TDetails>
    }

    if (error instanceof Error) {
      return new AppError<TDetails>(
        { message: error.message, code: 'UNKNOWN_ERROR' },
        { cause: error }
      )
    }

    return new AppError<TDetails>(
      { message: 'Unexpected error', code: 'UNKNOWN_ERROR' },
      { cause: error }
    )
  }
}
