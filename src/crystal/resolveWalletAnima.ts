// =============================================================================
// resolveWalletAnima — the ONE wallet↔account seam for deposit attribution
// =============================================================================
//
// P0 root cause (noema-027, docs/handoff/2026-07-10-deposit-attribution-seam.md): the Alchemy
// deposit path resolved "which account owns wallet X" through `animae.custos`, but the auth rail
// binds a proven wallet as a `web` PERSONA (`personae`, genus:'web', externusId:<lowercased
// address>) — nothing writes `animae.custos` for users anymore. So every deposit from a linked
// wallet missed and parked `confirmatum`, uncredited, silently.
//
// This is the single resolver both webhook paths (payment + NFT-received) call. It reads the
// authoritative Persona seam FIRST, then falls back to the legacy `animae.custos` seam — because
// `accruePayeePayout.ts` / `ownerReward.ts` still mint reward-only animae keyed by custos, so the
// seam is not yet dead (its removal is a tracked follow-up, NOT this item). Crystal-first: exactly
// two seams consulted in priority order, never a third.
//
// (genus:'web', externusId) is UNIQUE in `personae` (ensureIndexes), so there is at most one web
// persona per address — an unambiguous, authoritative binding.
// =============================================================================

import type { PersonaStore } from '../types/persona.js'
import type { AnimaStore } from '../types/anima.js'

export interface WalletAnimaResolverDeps {
  personae: Pick<PersonaStore, 'findByExternus'>
  /** Legacy fallback seam — reward-only animae still keyed by custos (accruePayeePayout/ownerReward). */
  animae: Pick<AnimaStore, 'findByCustos'>
}

/**
 * Resolve a payer/sender wallet to the animaId that owns it, or `null` when no account is linked.
 * The address is lowercased to match how the auth rail stores `externusId` (normalizeAddress → lower).
 */
export type ResolveWalletAnima = (wallet: string) => Promise<string | null>

export function makeResolveWalletAnima(deps: WalletAnimaResolverDeps): ResolveWalletAnima {
  return async (wallet: string): Promise<string | null> => {
    const externusId = wallet.toLowerCase()

    // 1. Authoritative: an ACTIVE web persona whose externusId is this address.
    const persona = await deps.personae.findByExternus('web', externusId)
    if (persona && persona.status === 'active' && persona.activeAnimaId) {
      return persona.activeAnimaId
    }

    // 2. Fallback: the legacy custos seam (still written by reward accrual paths).
    const anima = await deps.animae.findByCustos(externusId)
    return anima?.id ?? null
  }
}
