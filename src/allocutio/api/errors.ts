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
  notFoundFundamentum: (id: string) => new ApiError('not_found.fundamentum', `Fundamentum '${id}' not found`, 404),
  notFoundStudio: (id: string) => new ApiError('not_found.studio', `Studio '${id}' not found`, 404),
  conflictSlug: (slug: string) => new ApiError('conflict.slug_taken', `The slug '${slug}' is already taken`, 409),
  notFoundRun: (id: string) => new ApiError('not_found.run', `Run '${id}' not found`, 404),
  notFoundCollection: (id: string) => new ApiError('not_found.collection', `Collection '${id}' not found`, 404),
  insufficientSigna: (details?: Record<string, unknown>) =>
    new ApiError('economy.insufficient_signa', 'Balance cannot cover the reservation', 402, { details }),
  capTooLow: (details?: Record<string, unknown>) =>
    new ApiError('economy.cap_too_low', 'maxImpetus is below the estimated reservation', 422, { details }),
  /** No GPU capacity could be procured for a studio (provision failed / no pods). Retryable. */
  capacityNoPods: (details?: Record<string, unknown>) =>
    new ApiError('capacity.no_pods', 'No GPU capacity available to provision a studio', 503, { retryable: true, retryAfter: 30, ...(details ? { details } : {}) }),
  /** The deployment has no studio-provisioning rail wired (no Procurator). */
  studioUnavailable: () => new ApiError('internal.unavailable', 'Studio provisioning is not available on this deployment', 503, { retryable: true }),
  internal: (message = 'Internal error') => new ApiError('internal.error', message, 500, { retryable: true }),
} as const
