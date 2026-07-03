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

export interface OwnedPurseDeps {
  signorum: Pick<Signorum, 'reserve' | 'settle' | 'release' | 'issue'>
  bursarium: Pick<Bursarum, 'create' | 'findByToken' | 'debit' | 'setStatus'>
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
