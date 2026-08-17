// Bursa — a credit purse spent by a bearer token.
//
// A Bursa is minted either by spending a ZK note (ArcanumProof) once — the ANON
// purse, `owner` absent, unlinkable — or by an identified account converting some of
// its own Signum balance into a shareable purse — the OWNED purse, `owner` set.
//
// PRIVACY: the bearer token is the only credential PRESENTED ON A RUN, so whoever
// SPENDS a purse is always anonymous (the actum never carries an animaId). `owner` is
// the opt-in FUNDER link: absent → the platform cannot link the purse to anyone
// (today's anon bursa); present → the creator gets a dashboard over their own purse
// (they see the balance drain, never who spent it). Reclaim/revoke apply ONLY to owned
// purses — an anon purse has no owner to disperse to, so it is never de-anonymised.

export interface Bursa {
  id: string      // UUID = bearer token presented on each run
  credits: bigint // remaining impetus credits
  createdAt: Date
  /** The identified CREATOR, when this is a shareable owned purse. Absent = anon purse.
   *  This is the funder link (opt-in); it never touches the anon run path. */
  owner?: { animaId: string }
  /** Owner's label for the purse (e.g. "discord mods"). Owned purses only. */
  label?: string
  /** Lifecycle for owned purses — 'revoked' purses are drained on revoke. Absent = active. */
  status?: 'active' | 'revoked'
}

export interface BursaCreateOpts {
  owner?: { animaId: string }
  label?: string
}

/**
 * Thrown by `Bursarum.debit` when a purse cannot cover the amount asked of it.
 *
 * A typed domain error so a caller can tell "the purse is short" apart from "the
 * server failed": the API layer maps this to `402 economy.insufficient_signa`
 * instead of the generic 500. `credits` and `required` are carried as FIELDS — the
 * mapper reads them as data rather than parsing them back out of the message.
 *
 * UNITS: purse credits. This is a SIBLING of the identified path's
 * `InsufficientFundsError` (impetus points), deliberately a distinct class so the
 * two denominations are never conflated in a numeric comparison. Both surface the
 * same API code; only the API layer, which emits strings, sees them together.
 *
 * Layering: lives with the `Bursarum` contract it belongs to and carries no API
 * error vocabulary; translation to an `ApiError` happens at the allocutio boundary.
 */
export class InsufficientBursaCreditsError extends Error {
  constructor(readonly credits: bigint, readonly required: bigint) {
    super(`Insufficient bursa credits: ${credits} credits, need ${required}`)
    this.name = 'InsufficientBursaCreditsError'
  }
}

export interface Bursarum {
  create(credits: bigint, opts?: BursaCreateOpts): Promise<Bursa>
  findByToken(token: string): Promise<Bursa | null>
  /** Atomically debit `amount` credits. Throws `InsufficientBursaCreditsError` if the purse is short. */
  debit(token: string, amount: bigint): Promise<Bursa>
  /** Restore `amount` credits — used to compensate a debit when actum creation fails. */
  credit(token: string, amount: bigint): Promise<void>
  /** The creator's dashboard — every OWNED purse they minted, newest first. */
  listByOwner(animaId: string): Promise<Bursa[]>
  /** Mark an owned purse revoked (after draining it). */
  setStatus(token: string, status: NonNullable<Bursa['status']>): Promise<void>
}
