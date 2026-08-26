// =============================================================================
// ownedPurse — mint / reclaim a shareable owned Bursa, funded from a Signum balance.
// =============================================================================
//
// The "delegation" reduction (crystal-first): a delegation IS an owned Bursa purse
// funded from a balance. Minting spends `credits` from the funder's Signum (reserve →
// settle) and stamps a Bursa with `owner` (the dashboard link). Reclaiming drains the
// purse's leftover credits back to the owner's Signum. The bearer token is the invite
// code; runs spend it through the existing `/v1/runs` `x-bursa-token` path — no new
// credential, no new run path.

import { randomUUID } from 'node:crypto'
import type { Signorum } from '../types/significandi.js'
import type { Bursa, Bursarum } from '../types/bursa.js'
import { InsufficientBursaCreditsError } from '../types/bursa.js'

export interface OwnedPurseDeps {
  signorum: Pick<Signorum, 'reserve' | 'settle' | 'release' | 'issue'>
  bursarium: Pick<Bursarum, 'create' | 'findByToken' | 'debit' | 'credit' | 'setStatus' | 'claimForRedemption' | 'releaseRedemptionClaim'>
}

export type MintResult = { ok: true; bursa: Bursa } | { ok: false; available: bigint }

/**
 * Mint an owned purse: spend `credits` from `fundFrom`'s Signum, stamp a Bursa owned by
 * `owner`. All-or-nothing on the funder's balance. `fundFrom` defaults to `owner` (a user
 * funding their own purse); for an agent delegation it is the AGENT's anima (funded from
 * the sponsor-fed balance) while `owner` is the human owner who gets the dashboard.
 */
export async function mintOwnedPurse(
  deps: OwnedPurseDeps,
  input: { owner: { animaId: string }; credits: bigint; label?: string; fundFrom?: { animaId: string } },
): Promise<MintResult> {
  if (input.credits <= 0n) return { ok: false, available: 0n }
  const fundFrom = input.fundFrom ?? input.owner
  const spendCtx = `purse-mint:${randomUUID()}`

  // Reserve exactly `credits` from the funder — atomic, fails closed if short.
  const r = await deps.signorum.reserve(fundFrom, input.credits, spendCtx)
  if (!r.ok) return { ok: false, available: r.available }

  // Mint the purse; if that fails, release the reservation (no money moved).
  let bursa: Bursa
  try {
    bursa = await deps.bursarium.create(input.credits, { owner: input.owner, ...(input.label !== undefined ? { label: input.label } : {}) })
  } catch (err) {
    await deps.signorum.release(r.signaIds)
    throw err
  }
  // Commit the spend — the funder is debited exactly `credits`.
  await deps.signorum.settle(r.signaIds, input.credits, spendCtx)
  return { ok: true, bursa }
}

/**
 * Reclaim a purse's leftover credits back to the owner's Signum (drain → refund). Only the
 * owner may reclaim, and only an OWNED purse — an anon purse has no owner, so this is
 * structurally never applied to it (privacy: no de-anonymisation). Returns the amount
 * refunded (0 if nothing was left). Pass `revoke:true` to also mark it revoked.
 */
export async function reclaimOwnedPurse(
  deps: OwnedPurseDeps,
  input: { token: string; owner: { animaId: string }; revoke?: boolean },
): Promise<{ ok: boolean; refunded: bigint }> {
  const bursa = await deps.bursarium.findByToken(input.token)
  if (!bursa || bursa.owner?.animaId !== input.owner.animaId) return { ok: false, refunded: 0n }
  const remaining = bursa.credits
  if (remaining > 0n) {
    await deps.bursarium.debit(input.token, remaining)                 // drain to zero
    await deps.signorum.issue({ animaId: input.owner.animaId, forma: 'minted', valor: remaining, auctor: 'purse-reclaim', contextId: input.token })
  }
  if (input.revoke) await deps.bursarium.setStatus(input.token, 'revoked')
  return { ok: true, refunded: remaining }
}

/** Why a redemption was refused. Every reason leaves both balances exactly as they were. */
export type RedeemRefusal =
  | 'not_found'        // no purse with that token
  | 'not_redeemable'   // an anon purse, or a purse already in a terminal non-redeemed state
  | 'redeemed'         // already redeemed — including losing the claim race
  | 'owner_reclaims'   // the caller owns this purse; their path is reclaim

export type RedeemResult = { ok: true; credited: bigint } | { ok: false; reason: RedeemRefusal }

/**
 * Drain the whole remaining balance of a claimed purse, tolerating a bearer spend that lands
 * between the claim and the debit. `debit` is all-or-nothing against a stated amount, so a
 * concurrent spend makes the first attempt short; the typed error carries what is actually
 * left, and that is what the next attempt asks for. Returns the amount actually removed —
 * the ONLY number the caller may issue, which is what keeps the system total unchanged.
 */
async function drainRemaining(deps: OwnedPurseDeps, token: string, claimed: bigint): Promise<bigint> {
  const MAX_ATTEMPTS = 10
  let remaining = claimed
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (remaining <= 0n) return 0n
    try {
      await deps.bursarium.debit(token, remaining)
      return remaining
    } catch (err) {
      if (!(err instanceof InsufficientBursaCreditsError)) throw err
      remaining = err.credits   // a bearer spend landed first — drain what it left
    }
  }
  throw new Error('Purse redemption could not drain the purse under concurrent spend')
}

/**
 * Redeem an owned purse into the REDEEMER's Signum balance: the whole remaining balance, once.
 *
 * The rail behind an invite code — the owner mints a purse from their balance and hands the
 * token to someone; that person redeems it into an account of their own, and from then on
 * holds ordinary credits rather than a bearer token.
 *
 * Order of operations, and why:
 *   1. Read + refuse. An ANON purse is never redeemable (an anon purse has no owner, and a
 *      redemption would bind it to an anima — the one thing its charter forbids). The OWNER is
 *      refused too: their path is reclaim, so the ledger keeps "the credits changed hands"
 *      distinct from "the credits went home".
 *   2. CLAIM. One conditional update flips 'active' → 'redeemed'. Exactly one caller wins;
 *      every other caller — including a second attempt with the same token, and including a
 *      purse with nothing left in it — is refused. This is what makes redemption one-shot.
 *   3. Drain, then issue EXACTLY what was drained. Credits are conserved by construction:
 *      the purse loses precisely what the redeemer gains.
 *   4. Compensate. Any failure after the claim restores the drained credits and releases the
 *      claim, so a partial redemption never strands credits in a terminal purse.
 *
 * No redeemer identity is recorded on the purse (see `Bursa.redeemedAt`).
 */
export async function redeemOwnedPurse(
  deps: OwnedPurseDeps,
  input: { token: string; redeemer: { animaId: string }; now?: () => Date },
): Promise<RedeemResult> {
  const bursa = await deps.bursarium.findByToken(input.token)
  if (!bursa) return { ok: false, reason: 'not_found' }
  if (!bursa.owner) return { ok: false, reason: 'not_redeemable' }
  if (bursa.owner.animaId === input.redeemer.animaId) return { ok: false, reason: 'owner_reclaims' }
  const status = bursa.status ?? 'active'
  if (status !== 'active') return { ok: false, reason: status === 'redeemed' ? 'redeemed' : 'not_redeemable' }

  const claimed = await deps.bursarium.claimForRedemption(input.token, (input.now ?? (() => new Date()))())
  if (!claimed) return { ok: false, reason: 'redeemed' }   // lost the race, or no longer active

  let drained = 0n
  try {
    drained = await drainRemaining(deps, input.token, claimed.credits)
    if (drained > 0n) {
      await deps.signorum.issue({
        animaId: input.redeemer.animaId, forma: 'minted', valor: drained,
        auctor: 'purse-redeem', contextId: input.token,
      })
    }
  } catch (err) {
    if (drained > 0n) await deps.bursarium.credit(input.token, drained)
    await deps.bursarium.releaseRedemptionClaim(input.token)
    throw err
  }
  return { ok: true, credited: drained }
}
