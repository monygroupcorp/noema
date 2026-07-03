// =============================================================================
// SubsidySweeper — the generalized faucet drip worker (ADR-0011 §2).
// =============================================================================
//
// Walks every active `Sponsio` and drips its `grant` to the beneficiary once per
// cycle, via the ledger `transfer` (sponsor Anima → beneficiary Anima). Replaces
// the legacy `agentFaucetWorker`/`FaucetService` and generalizes them: the sweeper
// is indifferent to whether the sponsor is a person, a collective, or a treasury.
//
// Guards, in order (all fail-closed):
//   • capTotal — a pledge that has dripped its lifetime cap flips to `exhausted`.
//   • balanceCap — clamp/skip so an idle beneficiary isn't topped past the ceiling.
//   • cycle idempotency — CAS-claim `lastDripCycle` so a drip fires once per cycle
//     even under concurrent sweeps or an over-frequent schedule.
//   • sponsor balance — `transfer` fails closed if the pool can't cover; the cycle
//     claim is RELEASED so a later sweep retries once the sponsor is funded.

import type { Signorum } from '../types/significandi.js'
import type { SponsioStore } from '../types/sponsio.js'
import { cycleKey } from './subsidyCycle.js'

export interface SubsidySweepDeps {
  sponsiones: SponsioStore
  signorum: Pick<Signorum, 'transfer' | 'balance'>
}

export interface SweepResult {
  dripped: number
  skipped: number
  failed: number
  exhausted: number
  totalPoints: bigint
}

/** One drip pass over all active pledges. `now` is injectable for deterministic tests. */
export async function runSubsidySweep(deps: SubsidySweepDeps, now: Date = new Date()): Promise<SweepResult> {
  const active = await deps.sponsiones.listActive()
  const r: SweepResult = { dripped: 0, skipped: 0, failed: 0, exhausted: 0, totalPoints: 0n }

  for (const s of active) {
    const cycle = cycleKey(s.subsidia.cadence, now)
    let grant = s.subsidia.grant

    // 1. Lifetime cap.
    if (s.capTotal !== undefined) {
      const remaining = s.capTotal - s.drippedTotal
      if (remaining <= 0n) { await deps.sponsiones.setStatus(s.id, 'exhausted'); r.exhausted++; continue }
      if (grant > remaining) grant = remaining
    }

    // 2. Beneficiary balance ceiling — clamp to the room, skip if already full.
    if (s.subsidia.balanceCap !== undefined) {
      const bal = await deps.signorum.balance(s.beneficiarius)
      const room = s.subsidia.balanceCap - bal
      if (room <= 0n) { r.skipped++; continue }
      if (grant > room) grant = room
    }

    if (grant <= 0n) { r.skipped++; continue }

    // 3. Cycle idempotency — claim the slot (CAS). Loser skips.
    const claimed = await deps.sponsiones.claimCycle(s.id, cycle)
    if (!claimed) { r.skipped++; continue }

    // 4. Drip. Fail-closed: release the claim so a funded retry works next sweep.
    const moved = await deps.signorum.transfer(s.sponsor, s.beneficiarius, grant, { auctor: `subsidy:${s.id}`, contextId: s.id })
    if (!moved.ok) {
      await deps.sponsiones.releaseCycle(s.id, cycle)
      r.failed++
      continue
    }

    await deps.sponsiones.recordDrip(s.id, grant)
    r.dripped++
    r.totalPoints += grant
  }

  return r
}

/**
 * Start the sweeper on an interval. The cadence lives in each pledge's cycle key,
 * so the sweep frequency only bounds latency — an hourly sweep still drips a weekly
 * pledge exactly once per ISO week. Returns a stop() handle.
 */
export function startSubsidySweeper(
  deps: SubsidySweepDeps,
  opts: { intervalMs?: number; onError?: (err: unknown) => void; now?: () => Date } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60 * 60 * 1000 // hourly
  const tick = (): void => {
    runSubsidySweep(deps, (opts.now ?? (() => new Date()))()).catch(err => opts.onError?.(err))
  }
  const handle = setInterval(tick, intervalMs)
  if (typeof handle.unref === 'function') handle.unref()
  return { stop: () => clearInterval(handle) }
}
