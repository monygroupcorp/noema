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
  /** The same work is already running, and a second run of it would hold a second
   *  reservation against it for as long as it lived. 409 — a fact about the caller's own
   *  resource rather than a server fault, so it must not be masked as `internal.error`.
   *  Retryable: the request succeeds once the running one ends. */
  conflictRunInFlight: (message: string, details?: Record<string, unknown>) =>
    new ApiError('conflict.run_in_flight', message, 409, { retryable: true, ...(details ? { details } : {}) }),
  notFoundRun: (id: string) => new ApiError('not_found.run', `Run '${id}' not found`, 404),
  notFoundCollection: (id: string) => new ApiError('not_found.collection', `Collection '${id}' not found`, 404),
  notFoundTeam: (id: string) => new ApiError('not_found.team', `Team '${id}' not found`, 404),
  notFoundProject: (id: string) => new ApiError('not_found.project', `Project '${id}' not found`, 404),
  notFoundEdition: (id: string) => new ApiError('not_found.edition', `Edition '${id}' not found`, 404),
  notFoundModel: (id: string) => new ApiError('not_found.model', `Model '${id}' not found`, 404),
  /** A pinned model (id | slug | trigger) could not be resolved to a registered model at the run
   *  boundary. 422 — the request is well-formed but references a model that does not exist / is not
   *  accessible; NOT an internal error (this replaces the Compiler's misleading `model 'undefined'`
   *  500). (noema-113) */
  modelNotResolved: (token: string) =>
    new ApiError('input.model_not_resolved', `pinned model "${token}" is not a registered/accessible model`, 422),
  /** A pinned model resolved to a PRIVATE model the caller does not own — a visibility refusal, not a
   *  malformed request. 403. A pin must not bypass access control. (noema-113) */
  modelForbidden: (token: string) =>
    new ApiError('auth.forbidden', `pinned model "${token}" is not accessible`, 403),
  notFoundTabula: (id: string) => new ApiError('not_found.tabula', `Tabula '${id}' not found`, 404),
  /** A Tabula's graph can't compile to a Modus — a cycle, a mismatched port wire, a node
   *  pointing at an unknown modus, or an empty graph. `details.vinculumId` names the
   *  offending wire when the failure is wire-specific (cycle/mismatch). */
  tabulaGraphInvalid: (message: string, details?: { code: string; vinculumId?: string }) =>
    new ApiError('input.invalid_graph', message, 400, { ...(details ? { details } : {}) }),
  /** A model can't be promoted to the public (commercial) catalog under its license. Private use is
   *  unaffected. 403 — a policy refusal, not a malformed request. */
  licenseRestricted: (message: string) => new ApiError('license.restricted', message, 403),
  /** A prompt was refused by the input CSAM guard. 403 — a policy refusal, not a malformed request. */
  contentRefused: (message: string) => new ApiError('content.refused', message, 403),
  /** A gated model import needs a connected BYO secret for `provider` (Civitai/HF). 422 — the request
   *  is well-formed but a precondition (a connected token) is unmet. `details.provider` drives the
   *  frontend deep-link to Profile → Connected accounts (BYO-secrets F2). */
  secretRequired: (provider: string, message?: string) =>
    new ApiError('secret.required', message ?? `Connect a ${provider} token to import this gated model`, 422, { details: { provider } }),
  notFoundAdapter: (key: string) => new ApiError('not_found.adapter', `Publication destination '${key}' is not available`, 404),
  notFoundPartnerRequest: (id: string) => new ApiError('not_found.partner_request', `Partner request '${id}' not found`, 404),
  /** A partner request PATCH targets a request that already has a decision (approved/declined).
   *  Refused rather than re-run — re-approving would risk minting a SECOND API key for the
   *  same request, and an already-issued key is never re-shown (show-once). */
  conflictAlreadyDecided: (id: string, status: string) =>
    new ApiError('conflict.already_decided', `Partner request '${id}' was already ${status}`, 409),
  /** No `Partner` record for the caller's animaId, OR one exists but is `status: 'revoked'` —
   *  both look identical from the caller's side: "you don't have partner access". */
  notFoundPartner: () => new ApiError('not_found.partner', 'No partner record found for this account', 404),
  notFoundQuerela: (id: string) => new ApiError('not_found.querela', `Report '${id}' not found`, 404),
  insufficientSigna: (details?: Record<string, unknown>) =>
    new ApiError('economy.insufficient_signa', 'Balance cannot cover the reservation', 402, { details }),
  capTooLow: (details?: Record<string, unknown>) =>
    new ApiError('economy.cap_too_low', 'maxImpetus is below the estimated reservation', 422, { details }),
  /** No GPU capacity could be procured for a studio (provision failed / no pods). Retryable. */
  capacityNoPods: (details?: Record<string, unknown>) =>
    new ApiError('capacity.no_pods', 'No GPU capacity available to provision a studio', 503, { retryable: true, retryAfter: 30, ...(details ? { details } : {}) }),
  /** The deployment has no studio-provisioning rail wired (no Procurator). */
  studioUnavailable: () => new ApiError('internal.unavailable', 'Studio provisioning is not available on this deployment', 503, { retryable: true }),
  depositUnavailable: () => new ApiError('internal.unavailable', 'Deposit pricing is not available on this deployment (no price oracle configured)', 503, { retryable: true }),
  reportUnavailable: () => new ApiError('internal.unavailable', 'The revenue report is not available on this deployment (no revenue book configured)', 503, { retryable: true }),
  /** The fiat (Stripe) funding rail is not configured on this deployment (missing keys / stores). */
  paymentsUnavailable: () => new ApiError('internal.unavailable', 'Fiat payments are not available on this deployment (Stripe is not configured)', 503, { retryable: true }),
  /** No `PartnerStore` wired into this deployment's router — distinct from `notFoundPartner`
   *  (the store IS wired and simply has no record for this caller). */
  partnerDirectoryUnavailable: () => new ApiError('internal.unavailable', 'The partner directory is not available on this deployment', 503, { retryable: true }),
  priceUnavailable: (message = 'Could not price this asset — it is not supported or has no available price') => new ApiError('deposit.price_unavailable', message, 422),
  /** Account erasure is globally disabled on this deployment (feature flag off). Only reachable
   *  by an authenticated caller — the flag state is never revealed to an anonymous caller. */
  erasureNotImplemented: () => new ApiError('feature.not_implemented', 'Account erasure is not enabled on this deployment', 501),
  internal: (message = 'Internal error') => new ApiError('internal.error', message, 500, { retryable: true }),
} as const
