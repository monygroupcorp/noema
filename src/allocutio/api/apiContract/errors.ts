import type { JsonSchema, ErrorCodeSpec } from './types'

export const ErrorEnvelopeSchema: JsonSchema = {
  type: 'object',
  description: 'The uniform request-error envelope.',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'A stable `category.specific` code to branch on.' },
        message: { type: 'string' },
        retryable: { type: 'boolean', description: 'Whether the same call may succeed if retried.' },
        retryAfter: { type: 'number', description: 'Suggested back-off in seconds.' },
        details: { type: 'object', additionalProperties: true },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
}

  // Mirrors the request-error taxonomy in `errors.ts`. Append-only.
export const API_ERROR_CODES: ErrorCodeSpec[] = [
    { code: 'auth.missing', httpStatus: 401 },
    { code: 'auth.invalid', httpStatus: 401 },
    { code: 'auth.forbidden', httpStatus: 403 },
    { code: 'input.malformed', httpStatus: 400 },
    { code: 'input.invalid_aditus', httpStatus: 422 },
    { code: 'input.invalid_graph', httpStatus: 400 },
    { code: 'not_found.flow', httpStatus: 404 },
    { code: 'not_found.tabula', httpStatus: 404 },
    { code: 'not_found.fundamentum', httpStatus: 404 },
    { code: 'not_found.studio', httpStatus: 404 },
    { code: 'not_found.collection', httpStatus: 404 },
    { code: 'not_found.team', httpStatus: 404 },
    { code: 'not_found.project', httpStatus: 404 },
    { code: 'not_found.edition', httpStatus: 404 },
    { code: 'not_found.model', httpStatus: 404 },
    { code: 'not_found.adapter', httpStatus: 404 },
    { code: 'not_found.partner', httpStatus: 404 },
    { code: 'not_found.run', httpStatus: 404 },
    { code: 'not_found.muse_session', httpStatus: 404 },
    { code: 'not_found.muse_piece', httpStatus: 404 },
    { code: 'not_found.dataset', httpStatus: 404 },
    { code: 'not_found.partner_request', httpStatus: 404 },
    { code: 'not_found.partner_invoice', httpStatus: 404 },
    { code: 'not_found.querela', httpStatus: 404 },
    { code: 'input.model_not_resolved', httpStatus: 422 },
    // The balance cannot cover the reservation. NOT retryable: only funding the account changes
    // the answer, so a caller that asks again just refuses faster.
    { code: 'economy.insufficient_signa', httpStatus: 402, retryable: false },
    { code: 'economy.cap_too_low', httpStatus: 422 },
    { code: 'conflict.slug_taken', httpStatus: 409 },
    // The same work is already running on the caller's own resource. Retryable: the request
    // succeeds once the running one ends.
    { code: 'conflict.run_in_flight', httpStatus: 409, retryable: true },
    // There is no work left to do. NOT retryable: the request cannot succeed until the resource
    // changes or the caller asks for a rebuild.
    { code: 'conflict.nothing_to_decompose', httpStatus: 409, retryable: false },
    // Concurrent writes to the same muse session exhausted the retry budget. Retryable: the
    // stored session is intact, and the same call succeeds once contention clears.
    { code: 'conflict.muse_session', httpStatus: 409, retryable: true },
    // A partner request PATCH targets a request that already has a decision. NOT retryable:
    // an already-issued API key is show-once and never re-minted for the same decision.
    { code: 'conflict.already_decided', httpStatus: 409, retryable: false },
    // Payment was requested for an invoice that is already paid or was voided. NOT retryable:
    // both states are terminal, and the payer needs a different invoice, not a retry.
    { code: 'conflict.invoice_not_open', httpStatus: 409, retryable: false },
    // An invoice already covers this partner and period. NOT retryable: a period is billed once,
    // and re-issuing goes through voiding the first invoice.
    { code: 'conflict.period_already_billed', httpStatus: 409, retryable: false },
    // The B2B API Customer Agreement has not been signed at its current version, so no key is
    // issued. NOT retryable by itself — the caller signs, then asks again.
    { code: 'partner.contract_unsigned', httpStatus: 422, retryable: false },
    // No billing account is on file, so there is nowhere to send the invoice a key would run up.
    { code: 'partner.billing_required', httpStatus: 422, retryable: false },
    // Collections dispatch through a path the B2B meter does not reach yet. NOT retryable as-is:
    // the same call over POST /v1/runs (or run_flow over MCP) is metered and succeeds.
    { code: 'partner.unmetered_surface', httpStatus: 403, retryable: false },
    { code: 'license.restricted', httpStatus: 403 },
    { code: 'content.refused', httpStatus: 403 },
    // The flow carries licence terms the caller has not accepted at their current version. NOT
    // retryable as-is: details name the terms and where to read them; accept, then run again.
    { code: 'terms.required', httpStatus: 403, retryable: false },
    // The caller is suspended under the flow's licence terms after repeated confirmed violations.
    { code: 'terms.suspended', httpStatus: 403, retryable: false },
    // The flow names terms this deployment publishes no text for — a configuration fault.
    { code: 'terms.unknown', httpStatus: 503, retryable: false },
    // The caller's origin falls inside a territory the flow's upstream licence excludes
    // (MiniMax H3: the EU, UK, Republic of Korea). NOT retryable: the request cannot succeed
    // from this origin, however many times it is sent.
    { code: 'territory.excluded', httpStatus: 403, retryable: false },
    { code: 'not_found.terms', httpStatus: 404 },
    { code: 'secret.required', httpStatus: 422 },
    { code: 'deposit.price_unavailable', httpStatus: 422 },
    { code: 'feature.not_implemented', httpStatus: 501 },
    { code: 'purse.disabled', httpStatus: 503 },
    // The purse behind the presented bursa token is revoked or redeemed. NOT retryable:
    // both states are terminal, and the holder needs a different code, not a retry.
    { code: 'purse.revoked', httpStatus: 403, retryable: false },
    { code: 'rate.limited', httpStatus: 429, retryable: true },
    { code: 'capacity.no_pods', httpStatus: 503, retryable: true },
    { code: 'internal.unavailable', httpStatus: 503, retryable: true },
    { code: 'internal.upstream_unavailable', httpStatus: 503, retryable: true },
    { code: 'internal.error', httpStatus: 500, retryable: true },
]
