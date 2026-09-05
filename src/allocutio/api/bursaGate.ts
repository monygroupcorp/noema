// =============================================================================
// bursaGate — the single place a presented bursa token is checked against its purse.
// =============================================================================
//
// A `bursaToken` is a bearer credential: whoever holds the string is the caller. The
// `/widget` embed hands one to a partner's visitor in a QUERY STRING (`?code=`), so a
// code reaches browser history, shared links and access logs as a matter of course. The
// owner's remedy for a leaked code is `POST /v1/purses/:token/revoke`.
//
// That remedy used to be a BALANCE fact rather than an ACCESS one: revoking drains the
// purse to zero (`reclaimOwnedPurse`) but nothing on the request path ever read
// `Bursa.status`, so a revoked or redeemed code still authenticated on every route that
// accepts one — and any credits that landed back in it (`ActumInceptor` credits the purse
// back when actum creation fails after the debit) were spendable again. This module makes
// a terminal purse refuse its own token.
//
// The check lives at the CREDENTIAL boundary, deliberately not in `Bursarum.debit`:
// redemption flips the purse to 'redeemed' and THEN drains it (`drainRemaining`), so a
// status-aware debit would strand the credits it exists to move.

import { ApiError } from './errors.js'
import type { Bursa, Bursarum } from '../../types/bursa.js'

/**
 * The refusal a terminal purse raises. A named subclass because callers that funnel every
 * identity-resolution throw into one 401 ("could not work out who you are") must let this
 * one past: it is a decided answer about a credential the caller definitely holds, not a
 * failure to read one.
 */
export class TerminalPurseError extends ApiError {}

/**
 * Refuse a purse in a terminal state. `status` is absent on anon purses and on owned
 * purses minted before the lifecycle existed, and both of those spend as before — only an
 * explicit non-'active' status refuses.
 *
 * 403 with a reason: the holder of a code is entitled to know why it stopped working
 * (the same reasoning `purseRouter`'s redeem route states for its own refusals), and
 * "revoked" vs "redeemed" tells them whether to ask the owner for a new code or to look
 * in the account they redeemed it into.
 */
export function refuseTerminalPurse(bursa: Bursa | null | undefined): void {
  const status = bursa?.status
  if (!status || status === 'active') return
  throw new TerminalPurseError(
    'purse.revoked',
    status === 'redeemed'
      ? 'This purse was redeemed into an account; its code no longer spends'
      : 'This purse was revoked by its owner',
    403,
  )
}

export interface BursaGateDeps {
  /** Omitted → no purse row can be read, so only the ANON_PURSE gate below applies. */
  bursarium?: Pick<Bursarum, 'findByToken'>
  /** ANON_PURSE_ENABLED (noema-131) — off (v1 default) refuses ownerless/arcanum spends. */
  anonPurseEnabled?: boolean
}

/**
 * Admit a `bursaToken` presented as a credential, or throw. Two independent refusals:
 *
 *   1. TERMINAL PURSE — always, whatever the ANON_PURSE flag says. Revocation that only
 *      held while a feature flag was off would not be revocation.
 *   2. ANON_PURSE gate (noema-131) — with the flag off, only a SOUND owned purse (owner
 *      set, identified funder) spends; an ownerless or unknown bursa is refused 503,
 *      fail-closed, because the arcanum dev key can forge those until the ceremony.
 *
 * An unknown token is not refused by (1): it has no row to be terminal, and the flag gate
 * already fails it closed in the configuration that matters.
 */
export async function admitBursaToken(deps: BursaGateDeps, token: string): Promise<void> {
  const bursa = deps.bursarium ? await deps.bursarium.findByToken(token) : null
  refuseTerminalPurse(bursa)
  if (!deps.anonPurseEnabled && !bursa?.owner) {
    throw new ApiError('purse.disabled', 'anonymous purse coming soon', 503)
  }
}
