// =============================================================================
// OctraWatcher — polling ingestion for the OCT funding rail
// =============================================================================
//
// Octra gives us no webhook and no event log, so we POLL. Per tick the watcher
// reconciles each pending deposit intent by its single-use address (gap-free —
// ≤1 funding tx per address), and for each NEW, CONFIRMED, AUTHENTIC tx it calls
// the SAME arcanumTree.insert(commitment, valor) the EVM blind path uses.
//
// It deliberately does NOT use ArcanumIssuer.issue() — that requires an animaId
// and debits identified signa, and would always throw for an OCT deposit. The
// EVM blind path also bypasses the issuer and inserts directly.
//
// Shaped after src/api/webhooks/alchemyWebhook.ts: a deps bag, a recipient-
// address filter (vs the vault-address filter), a per-tx handler returning a
// processed/skipped boolean, idempotency before any state change. The new parts
// are the timer, the authenticated confirmation gate, the durable `remansum`
// terminal state, and the per-deposit valor circuit-breaker (in the pricer).
// =============================================================================

import type { ArcanumTreeStore } from '../arcanum/ArcanumTree.js'
import type { OctraClient, OctraDepositorum, OctraTx, OctraRemansumReason, OctraDeposit } from '../types/octra.js'
import type { OctraPricer } from '../octra/octraPricing.js'
import { parseCommitment } from '../octra/commitment.js'
import { isDuplicateKey } from './MongoOctraDeposit.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:octra-watcher')

export interface OctraWatcherDeps {
  arcanumTree: ArcanumTreeStore
  deposita: OctraDepositorum
  client: OctraClient
  pricer: OctraPricer
  /** OUR conservative confirmation depth — not a protocol guarantee. */
  confirmEpochs: number
  /** Wall-clock for testability. Defaults to Date.now. */
  now?: () => number
}

/** Start the poll loop. Returns a stop function. No-op safe to call once. */
export function startOctraWatcher(deps: OctraWatcherDeps, intervalMs = 15_000): () => void {
  const now = deps.now ?? (() => Date.now())

  const poll = async (): Promise<void> => {
    try {
      const headEpoch = await deps.client.fetchHeadEpoch() // authenticated head — NOT max(page)
      for (const dep of await deps.deposita.pending()) {
        const tx = await deps.client.fetchInbound(dep.depositAddr) // ≤1 funding tx per address
        if (tx) await handleOctraTx(tx, dep, headEpoch, deps, now)
      }
    } catch (err) {
      log.warn('octra poll failed', { error: String(err) })
    }
  }

  const timer = setInterval(() => { void poll() }, intervalMs)
  if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
  log.info('octra watcher started', { intervalMs, confirmEpochs: deps.confirmEpochs })
  return () => clearInterval(timer)
}

/** Returns true iff the tx reached a terminal state this pass. Exported for tests. */
export async function handleOctraTx(
  tx: OctraTx,
  dep: OctraDeposit,
  headEpoch: number,
  deps: OctraWatcherDeps,
  now: () => number,
): Promise<boolean> {
  // a. recipient must be this intent's single-use address
  if (tx.to !== dep.depositAddr) return false

  // b. confirmation: left staging AND deep enough (depth is OURS; head authenticated)
  if (tx.epoch === null) return false
  if (headEpoch - tx.epoch < deps.confirmEpochs) return false

  // c. authenticity (OctraClient already did sig/hash + quorum). Atomic tx claim.
  if (!(await deps.deposita.claimTx(tx.hash))) return true

  // d. recover commitment from the intent (canonical single-use-address binding)
  const commitment = dep.commitment ?? parseCommitment(tx.message)
  if (!commitment) return terminal(tx, dep, 'remansum', 'bad-message', deps)

  // e. commitment-in-tree is the AUTHORITATIVE idempotency guard
  if (await deps.arcanumTree.findLeaf(commitment)) return terminalSuccess(tx, dep, deps)

  // f. price — pinned at confirmation. null ⇒ leave confirmatum, retry later (never guess)
  const priced = await deps.pricer.priceToValor(tx.amount, now())
  if (priced === null) {
    await markConfirmedAwaitingPrice(tx, dep, deps)
    return false
  }
  if (priced.valor <= 0n) return terminal(tx, dep, 'remansum', 'dust', deps)

  // g. THE ONE WRITE — same tree, same insert as the EVM blind path.
  try {
    await deps.arcanumTree.insert(commitment, priced.valor)
  } catch (err) {
    if (!isDuplicateKey(err)) throw err
    // unique violation on arcanum_leaves.commitment ⇒ already processed (race)
  }

  dep.status = 'processatum'
  dep.txHash = tx.hash
  dep.epoch = tx.epoch
  dep.commitment = commitment
  dep.amountMicro = tx.amount.toString()
  dep.valor = priced.valor.toString()
  dep.octUsdRate = priced.octUsdRate
  dep.fundingRate = priced.fundingRate
  await deps.deposita.save(dep)
  log.info('octra commitment inserted', { hash: tx.hash, valor: priced.valor.toString() })
  return true
}

async function terminal(
  tx: OctraTx,
  dep: OctraDeposit,
  status: 'remansum',
  reason: OctraRemansumReason,
  deps: OctraWatcherDeps,
): Promise<boolean> {
  dep.status = status
  dep.reason = reason
  dep.txHash = tx.hash
  dep.epoch = tx.epoch ?? undefined
  dep.amountMicro = tx.amount.toString()
  await deps.deposita.save(dep)
  log.warn('octra deposit un-mintable', { hash: tx.hash, reason })
  return true
}

async function terminalSuccess(tx: OctraTx, dep: OctraDeposit, deps: OctraWatcherDeps): Promise<boolean> {
  dep.status = 'processatum'
  dep.txHash = tx.hash
  await deps.deposita.save(dep)
  return true
}

async function markConfirmedAwaitingPrice(tx: OctraTx, dep: OctraDeposit, deps: OctraWatcherDeps): Promise<void> {
  dep.status = 'confirmatum'
  dep.txHash = tx.hash
  dep.epoch = tx.epoch ?? undefined
  dep.amountMicro = tx.amount.toString()
  await deps.deposita.save(dep)
  log.warn('octra deposit confirmed but price unavailable — will retry', { hash: tx.hash })
}
