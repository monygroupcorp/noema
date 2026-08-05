// =============================================================================
// distributeOwnerReward — the agent-owner rev-share skim for x402 runs (ADR-0011 §5).
// =============================================================================
//
// When an external agent pays (x402) to run a Noema agent's spell, the Noema
// agent's OWNER takes a rev-share. On crystal this is native `reward` signa, not a
// bespoke ledger: skim `revShareBps` of the gross impetus and issue it to the
// owner's `Anima`, resolved (or minted) by `custos` = the on-chain owner address.
//
// The find-or-create-by-custos is the elegant part: if the owner has no account
// yet, the rewards accrue on an Anima keyed by their wallet, and the day they link
// that wallet (magic-amount) the SAME Anima — rewards and all — becomes theirs. No
// separate "unclaimed" ledger (the legacy split_ledger) is needed.

import type { AnimaStore } from '../types/anima.js'
import type { Signorum } from '../types/significandi.js'

/** Legacy `DEFAULT_AGENT_OWNER_REV_SHARE_BPS` (5%). */
export const DEFAULT_OWNER_REV_SHARE_BPS = 500

export interface OwnerRewardDeps {
  animae: Pick<AnimaStore, 'findByCustos' | 'create'>
  signorum: Pick<Signorum, 'issue'>
}

export interface OwnerRewardInput {
  /** The on-chain owner wallet (lowercased). */
  ownerAddress: string
  /** Full x402 gross for the run, in impetus points. */
  grossImpetus: bigint
  /** Basis points to the owner (default 500 = 5%). */
  revShareBps?: number
  /** Provenance for the reward signum. */
  agentId: string
}

export type OwnerRewardOutcome =
  | { status: 'credited'; points: bigint; ownerAnimaId: string }
  | { status: 'skipped'; points: bigint }

/** Skim the owner rev-share and credit it as `reward` signa to the owner's Anima. */
export async function distributeOwnerReward(deps: OwnerRewardDeps, input: OwnerRewardInput): Promise<OwnerRewardOutcome> {
  const bps = BigInt(input.revShareBps ?? DEFAULT_OWNER_REV_SHARE_BPS)
  const points = (input.grossImpetus * bps) / 10000n
  if (points <= 0n) return { status: 'skipped', points: 0n }

  const owner = input.ownerAddress.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(owner)) return { status: 'skipped', points: 0n }

  // Resolve (or mint) the owner's Anima by custos. A rare concurrent double-create is
  // tolerable (owner reward is best-effort, non-fatal); it reconciles at wallet-link.
  let anima = await deps.animae.findByCustos(owner)
  if (!anima) anima = await deps.animae.create({ nomen: `owner:${owner}`, custos: owner })

  await deps.signorum.issue({
    animaId: anima.id,
    forma: 'reward',
    valor: points,
    auctor: 'agent_owner',
    contextId: input.agentId,
  })
  return { status: 'credited', points, ownerAnimaId: anima.id }
}
