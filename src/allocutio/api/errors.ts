// =============================================================================
// ApiError — the request-error plane of the API (EPIC error taxonomy).
// =============================================================================
//
// Two planes: REQUEST errors (the call was bad/unauthorized/un-admittable) carry
// an `ApiError` → HTTP 4xx/5xx + `{ error: { code, message, retryable?, … } }`.
// RUN failures (an admitted run that failed executing) are NOT ApiErrors — they
// surface as a `Run` with `status:'failed', failure:{code}` (see runProjection).
//
// `code` is a stable, append-only string (`category.specific`) the agent branches
// on; `httpStatus` is the class; `retryable`/`retryAfter` let agents auto-backoff.

export interface ApiErrorBody {
  code: string
  message: string
  retryable?: boolean
  retryAfter?: number
  details?: Record<string, unknown>
}

export interface ApiErrorOpts {
  retryable?: boolean
  retryAfter?: number
  details?: Record<string, unknown>
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly opts: ApiErrorOpts = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The wire body under the `error` key: `{ error: <this.toBody()> }`. */
  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.opts.retryable !== undefined ? { retryable: this.opts.retryable } : {}),
      ...(this.opts.retryAfter !== undefined ? { retryAfter: this.opts.retryAfter } : {}),
      ...(this.opts.details ? { details: this.opts.details } : {}),
    }
  }
}

/** Convenience constructors for the common request-error codes. Add more as the
 *  surface grows — codes are append-only (never repurpose one). */
export const Errors = {
  authMissing: () => new ApiError('auth.missing', 'No credential provided', 401),
  authInvalid: (message = 'Invalid or expired credential') => new ApiError('auth.invalid', message, 401),
  authForbidden: (message = 'Not permitted') => new ApiError('auth.forbidden', message, 403),
  inputMalformed: (message = 'Malformed request body') => new ApiError('input.malformed', message, 400),
  invalidAditus: (details?: Record<string, unknown>) =>
    new ApiError('input.invalid_aditus', 'Inputs do not match the flow schema', 422, { details }),
  notFoundFlow: (id: string) => new ApiError('not_found.flow', `Flow '${id}' not found`, 404),
  notFoundRun: (id: string) => new ApiError('not_found.run', `Run '${id}' not found`, 404),
  insufficientSigna: (details?: Record<string, unknown>) =>
    new ApiError('economy.insufficient_signa', 'Balance cannot cover the reservation', 402, { details }),
  internal: (message = 'Internal error') => new ApiError('internal.error', message, 500, { retryable: true }),
} as const
