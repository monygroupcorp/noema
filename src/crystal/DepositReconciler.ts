// =============================================================================
// DepositReconciler — the chain is the source of truth for vault deposits
// =============================================================================
//
// The webhook is a NOTIFICATION, not the record. A delivery that never arrives (a mis-pointed
// endpoint, a provider outage, a dropped retry) leaves funds sitting in the vault with no
// `Depositum` row, and the existing retry sweep cannot see them: it re-processes rows that were
// RECORDED, never the chain.
//
// This module closes that. It reads the vault's own logs back over a block window via
// `eth_getLogs`, synthesises the exact log shape the webhook parses, and feeds them through the
// SAME processing core the webhook route uses (`processVaultLogs`). There is no second crediting
// path: same pricing, same OFAC screen, same attribution, same `confirmatum` parking, same revenue
// booking, same tx-hash idempotency short-circuit. A deposit the webhook already credited is
// re-processed here as a no-op.
//
// Bounded trust: the RPC answer is EVIDENCE, not instruction. Only logs whose address is the
// configured vault for the chain and whose topic0 is a known CreditVault event are handed on —
// asserted here in addition to the core's own vault-address filter.
//
// Pricing basis is RECONCILIATION time (operator ruling): a healed deposit is priced by the same
// pricer at the moment it is reconciled, exactly as a late webhook delivery would be. Historical
// receipt-time backfill is deliberately not built.
// =============================================================================

import { AbiCoder } from 'ethers'
import { makeLogger } from '../lib/logger.js'
import {
  processVaultLogs,
  TOPIC_PAYMENT,
  TOPIC_NFT_RECEIVED,
  TOPIC_ANON_DEPOSIT,
  type AlchemyLog,
  type AlchemyWebhookDeps,
} from '../api/webhooks/alchemyWebhook.js'

const log = makeLogger('deposit-reconciler')

// ---------------------------------------------------------------------------
// Chain constants
// ---------------------------------------------------------------------------

/**
 * The block in which the CreditVault proxy came into existence, per chainId — the floor for a
 * first-ever scan (there is no vault log before it). Taken from the deployment receipts in
 * `contracts/broadcast/DeployCreditVault.s.sol/<chainId>/run-latest.json`: the receipt that
 * carries the proxy address, not the implementation CREATE.
 */
export const VAULT_DEPLOYMENT_BLOCK: Record<string, number> = {
  '1': 24_595_416,
  '8453': 42_987_508,
}

/** Alchemy network slug per chainId — mirrors `AssetPricer`'s map (one key, one chain set). */
const NETWORK: Record<string, string> = { '1': 'eth-mainnet', '8453': 'base-mainnet' }

/**
 * Blocks left unscanned behind the head. The reconciler is a healer, not the real-time rail — the
 * webhook already credits within seconds — so it trades latency for finality: a window is scanned
 * only once it is this many blocks deep, and the cursor therefore never advances past a block a
 * reorg could still replace. That is what lets the cursor advance with no rescan overlap, which is
 * in turn what makes "a second scan of the same window processes nothing" exactly true.
 */
export const CONFIRMATION_LAG = 12

/** Upper bound on a single `eth_getLogs` range. Providers cap both the range and the result set. */
export const MAX_CHUNK_BLOCKS = 10_000
/** Floor for the adaptive halving below — under this a range error is a real error, not a size one. */
const MIN_CHUNK_BLOCKS = 100

/** The events the reconciler will hand to the processing core. Anything else is not our business. */
const KNOWN_TOPICS = [TOPIC_PAYMENT, TOPIC_NFT_RECEIVED, TOPIC_ANON_DEPOSIT]

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** One `eth_getLogs` result row, as JSON-RPC returns it. */
export interface RpcLog {
  address: string
  topics: string[]
  data: string
  transactionHash: string
  blockNumber: string
}

/** The chain-read surface the reconciler needs. Injectable so the suite drives it with fixtures. */
export interface EthRpc {
  blockNumber(chainId: string): Promise<number>
  getLogs(chainId: string, filter: { address: string; fromBlock: number; toBlock: number; topics: unknown[] }): Promise<RpcLog[]>
  /** The sender of a transaction — the only place an anonymous deposit's funder is observable. */
  transactionFrom(chainId: string, txHash: string): Promise<string | null>
}

/**
 * Where the scan window resumes from. A tiny OPERATIONAL record (one document per chain), not a
 * money record: losing it costs a re-scan, which is idempotent, and never a credit.
 */
export interface ScanCursor {
  get(chainId: string): Promise<number | null>
  set(chainId: string, block: number): Promise<void>
}

/** In-memory cursor — tests and any deployment without the collection wired. */
export function memoryScanCursor(seed: Record<string, number> = {}): ScanCursor {
  const state = new Map<string, number>(Object.entries(seed))
  return {
    async get(chainId) { return state.get(chainId) ?? null },
    async set(chainId, block) { state.set(chainId, block) },
  }
}

export interface DepositReconcilerDeps {
  /** The webhook's own dependency bundle — the reconciler adds no store of its own. */
  webhook: AlchemyWebhookDeps
  rpc: EthRpc
  cursor: ScanCursor
}

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

/**
 * Event conservation over the scanned range, per asset: what the chain's own deposit events say
 * arrived, against what we have recorded for those transactions. Pure event arithmetic — vault
 * OUTFLOWS cannot move it, which is why it is the primary check.
 */
export interface ConservationDelta {
  token: string
  chainTotal: string
  recordedTotal: string
}

export interface ConservationResult {
  ok: boolean
  /** Payment transactions compared. */
  checked: number
  /** Per-asset totals that did not agree. Empty when `ok`. */
  deltas: ConservationDelta[]
  /** Transaction hashes carrying more than one Payment log — see `checkConservation`. */
  collapsed: string[]
}

export interface ReconcileReport {
  chainId: string
  fromBlock: number
  toBlock: number
  chunks: number
  logsSeen: number
  processed: number
  skipped: number
  conservation: ConservationResult
}

// ---------------------------------------------------------------------------
// Alchemy JSON-RPC implementation
// ---------------------------------------------------------------------------

type JsonRpcFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** Raised when a provider refuses a range as too wide / too large to return. */
export class RangeTooLargeError extends Error {}

const RANGE_ERROR_MARKERS = ['range', 'too large', 'too many results', 'limit exceeded', 'response size']

/**
 * The production RPC. The Alchemy key already configured for pricing also serves JSON-RPC, and the
 * provider URL is derived per chain from the same network map the pricer uses — one key, one chain
 * set, no new configuration surface.
 */
export function alchemyRpc(apiKey: string, fetchFn: JsonRpcFetch = fetch as unknown as JsonRpcFetch): EthRpc {
  async function call(chainId: string, method: string, params: unknown[]): Promise<unknown> {
    const network = NETWORK[chainId]
    if (!network) throw new Error(`deposit-reconciler: no RPC network for chain ${chainId}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetchFn(`https://${network}.g.alchemy.com/v2/${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`${method} HTTP ${res.status}`)
      const json = await res.json() as { result?: unknown; error?: { message?: string } }
      if (json.error) {
        const message = json.error.message ?? 'rpc error'
        if (RANGE_ERROR_MARKERS.some(m => message.toLowerCase().includes(m))) throw new RangeTooLargeError(message)
        throw new Error(`${method}: ${message}`)
      }
      return json.result
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async blockNumber(chainId) {
      const result = await call(chainId, 'eth_blockNumber', [])
      return Number(BigInt(String(result)))
    },
    async getLogs(chainId, filter) {
      const result = await call(chainId, 'eth_getLogs', [{
        address: filter.address,
        fromBlock: '0x' + filter.fromBlock.toString(16),
        toBlock: '0x' + filter.toBlock.toString(16),
        topics: filter.topics,
      }])
      return (result as RpcLog[] | null) ?? []
    },
    async transactionFrom(chainId, txHash) {
      const result = await call(chainId, 'eth_getTransactionByHash', [txHash]) as { from?: string } | null
      return result?.from ?? null
    },
  }
}

// ---------------------------------------------------------------------------
// Conservation tripwire
// ---------------------------------------------------------------------------

/**
 * The accounting identity, checked against tracked state after every window: for every Payment
 * event the chain reports in the range, we must hold a `Depositum` whose recorded amount equals it.
 *
 * Scope, stated precisely:
 *   • PAYMENT events only. Anonymous deposits write an arcanum leaf and no `Depositum` by design,
 *     so including them would make a correct system report a permanent deficit. NFT/ERC-1155
 *     receipts carry no fungible amount at all.
 *   • Per ASSET. Summing amounts across tokens compares wei to token base units, which is not a
 *     quantity; each token address is reconciled against itself.
 *   • Recorded means recorded, not credited: an OFAC-quarantined (`fractum`) row and an
 *     unattributed `confirmatum` row both count. This checks that we SAW the money, which is the
 *     failure the reconciler exists to catch.
 *
 * A transaction carrying more than one Payment log collapses in the store (`findByHash` keys on
 * (txHash, chainId)), so its recorded amount cannot equal the sum of its events. Those hashes are
 * reported separately rather than being silently folded into a token delta.
 */
export async function checkConservation(
  logs: AlchemyLog[],
  chainId: string,
  deposita: AlchemyWebhookDeps['deposita'],
): Promise<ConservationResult> {
  const coder = AbiCoder.defaultAbiCoder()
  /** txHash → decoded Payment events in it. */
  const byTx = new Map<string, Array<{ token: string; amount: bigint }>>()

  for (const entry of logs) {
    if (entry.topics?.[0] !== TOPIC_PAYMENT) continue
    let token: string
    let amount: bigint
    try {
      const [t, a] = coder.decode(['address', 'uint256', 'uint256', 'uint256'], entry.data) as unknown as [string, bigint, bigint, bigint]
      token = t.toLowerCase()
      amount = BigInt(a)
    } catch {
      continue   // undecodable payload — the processing core skips it too, nothing to reconcile
    }
    const list = byTx.get(entry.transaction.hash) ?? []
    list.push({ token, amount })
    byTx.set(entry.transaction.hash, list)
  }

  const chainTotals = new Map<string, bigint>()
  const recordedTotals = new Map<string, bigint>()
  const collapsed: string[] = []
  const add = (m: Map<string, bigint>, token: string, v: bigint) => m.set(token, (m.get(token) ?? 0n) + v)

  for (const [txHash, events] of byTx) {
    if (events.length > 1) { collapsed.push(txHash); continue }
    const event = events[0]
    add(chainTotals, event.token, event.amount)
    const recorded = await deposita.findByHash(txHash, chainId)
    if (recorded) add(recordedTotals, (recorded.token ?? event.token).toLowerCase(), recorded.valor)
  }

  const deltas: ConservationDelta[] = []
  for (const token of new Set([...chainTotals.keys(), ...recordedTotals.keys()])) {
    const chainTotal = chainTotals.get(token) ?? 0n
    const recordedTotal = recordedTotals.get(token) ?? 0n
    if (chainTotal !== recordedTotal) {
      deltas.push({ token, chainTotal: chainTotal.toString(), recordedTotal: recordedTotal.toString() })
    }
  }

  return { ok: deltas.length === 0 && collapsed.length === 0, checked: byTx.size, deltas, collapsed }
}

// A SECOND, coarser tripwire was specified — vault balance against recorded inflows minus known
// outflows — and is deliberately NOT implemented. `CreditVault.withdrawProtocol` (and the NFT /
// ERC-1155 withdrawals) emit no event, so outflows are not enumerable from the chain's logs and the
// subtrahend is unknowable; the check could only be written as an inequality against a constant
// nobody can derive, and an inequality that drifts with every withdrawal produces exactly the false
// alarms that train an operator to ignore the primary check. The event-conservation identity above
// is exact and is unaffected by outflows, so it carries the tripwire on its own. Making the balance
// comparison meaningful is a contract change (an event on withdrawal), not a backend one.

// ---------------------------------------------------------------------------
// The reconciler
// ---------------------------------------------------------------------------

/** Synthesise the webhook's log shape from an RPC log. `from` is filled only where it is needed. */
function toAlchemyLog(rpcLog: RpcLog, from?: string): AlchemyLog {
  return {
    account: { address: rpcLog.address },
    topics: rpcLog.topics,
    data: rpcLog.data,
    transaction: { hash: rpcLog.transactionHash, ...(from ? { from } : {}) },
  }
}

/**
 * Scan a block window for vault deposits and process anything the webhook did not.
 *
 * Window: `fromBlock` defaults to the persisted cursor + 1 (or the chain's deployment block on a
 * first-ever scan); `toBlock` defaults to the head minus `CONFIRMATION_LAG`. An explicit window
 * from the operator route is honoured as given and does NOT move the cursor backwards.
 *
 * The window is walked in chunks. The cursor advances only after a chunk has fully processed, so an
 * interrupted scan resumes where it stopped and never skips a range it did not finish.
 */
export async function reconcileVaultDeposits(
  deps: DepositReconcilerDeps,
  args: { chainId: string; fromBlock?: number; toBlock?: number },
): Promise<ReconcileReport> {
  const { chainId } = args
  const vaultAddress = deps.webhook.vaultAddresses[chainId]
  if (!vaultAddress) throw new Error(`deposit-reconciler: chain ${chainId} is not served`)

  const explicitWindow = args.fromBlock !== undefined || args.toBlock !== undefined

  const head = await deps.rpc.blockNumber(chainId)
  const safeHead = Math.max(0, head - CONFIRMATION_LAG)
  const cursor = await deps.cursor.get(chainId)
  const deploymentBlock = VAULT_DEPLOYMENT_BLOCK[chainId] ?? 0
  const fromBlock = args.fromBlock ?? Math.max(deploymentBlock, cursor === null ? deploymentBlock : cursor + 1)
  const toBlock = args.toBlock ?? safeHead

  const report: ReconcileReport = {
    chainId, fromBlock, toBlock, chunks: 0, logsSeen: 0, processed: 0, skipped: 0,
    conservation: { ok: true, checked: 0, deltas: [], collapsed: [] },
  }
  if (toBlock < fromBlock) return report   // nothing final enough to scan yet

  let chunkSize = MAX_CHUNK_BLOCKS
  let start = fromBlock
  while (start <= toBlock) {
    const end = Math.min(start + chunkSize - 1, toBlock)

    let rpcLogs: RpcLog[]
    try {
      rpcLogs = await deps.rpc.getLogs(chainId, {
        address: vaultAddress,
        fromBlock: start,
        toBlock: end,
        topics: [KNOWN_TOPICS],
      })
    } catch (err) {
      if (err instanceof RangeTooLargeError && chunkSize > MIN_CHUNK_BLOCKS) {
        chunkSize = Math.max(MIN_CHUNK_BLOCKS, Math.floor(chunkSize / 2))
        log.warn('deposit reconcile: provider refused the range, narrowing', { chainId, start, end, chunkSize })
        continue
      }
      throw err
    }

    // Bounded trust: the RPC answer is evidence, not instruction. Re-assert both filters here —
    // the vault address for this chain and a known CreditVault topic — before anything is handed
    // to the crediting core, whatever the provider chose to return for our filter.
    const wanted = rpcLogs.filter(l =>
      typeof l.address === 'string' &&
      l.address.toLowerCase() === vaultAddress.toLowerCase() &&
      KNOWN_TOPICS.includes(l.topics?.[0]))

    const entries: AlchemyLog[] = []
    for (const rpcLog of wanted) {
      // The anonymous-deposit path OFAC-screens the enclosing transaction's sender and fails closed
      // without it; `eth_getLogs` does not carry it, so fetch it for those logs only.
      const from = rpcLog.topics[0] === TOPIC_ANON_DEPOSIT
        ? await deps.rpc.transactionFrom(chainId, rpcLog.transactionHash) ?? undefined
        : undefined
      entries.push(toAlchemyLog(rpcLog, from))
    }

    const counts = await processVaultLogs(entries, chainId, deps.webhook)
    report.chunks++
    report.logsSeen += entries.length
    report.processed += counts.processed
    report.skipped += counts.skipped

    // Conservation over the chunk, against tracked state. On a mismatch the window is re-processed
    // once — the common cause is a transient store failure mid-chunk, and every path here is
    // idempotent — then re-checked.
    let conservation = await checkConservation(entries, chainId, deps.webhook.deposita)
    if (!conservation.ok) {
      log.warn('deposit reconcile: conservation mismatch — re-running the window', {
        chainId, fromBlock: start, toBlock: end, deltas: conservation.deltas, collapsed: conservation.collapsed,
      })
      const retry = await processVaultLogs(entries, chainId, deps.webhook)
      report.processed += retry.processed
      report.skipped += retry.skipped
      conservation = await checkConservation(entries, chainId, deps.webhook.deposita)
      if (!conservation.ok) {
        // Named loudly, with the exact range, and the cursor still advances: a permanent divergence
        // must not wedge the scan short of every later block. The range printed here is what the
        // operator route replays once the cause is understood.
        log.error('deposit reconcile: CONSERVATION MISMATCH — recorded deposits do not equal chain deposit events', {
          chainId, fromBlock: start, toBlock: end, deltas: conservation.deltas, collapsed: conservation.collapsed,
        })
      }
    }
    report.conservation.checked += conservation.checked
    report.conservation.deltas.push(...conservation.deltas)
    report.conservation.collapsed.push(...conservation.collapsed)
    report.conservation.ok = report.conservation.ok && conservation.ok

    // Advance only now that the chunk is fully processed — and only for a cursor-driven scan. An
    // operator replaying an old window must not move the frontier backwards.
    if (!explicitWindow) await deps.cursor.set(chainId, end)
    start = end + 1
  }

  return report
}

/**
 * Chains with a scan in flight in THIS process. A pass that finds one skips that chain rather than
 * stacking a second scan on it. This is about provider load and log sanity, NOT correctness: the
 * rail is idempotent either way (the tx-hash short-circuit makes a re-processed log a no-op, and
 * the cursor only advances behind a fully processed chunk), so two overlapping scans would still
 * credit exactly once — they would simply pay twice for the same `eth_getLogs` pages and interleave
 * two sets of report lines.
 */
const scansInFlight = new Set<string>()

/**
 * One cursor-driven pass over the served chains, one report line per chain: the range scanned, what
 * was healed, and the conservation verdict. No explicit window is ever passed, so the cursor
 * advances and a long historical range finishes itself pass by pass.
 *
 * A pass that aborts part-way (the per-call RPC timeout during a wide backfill) needs no recovery
 * here: the cursor kept the progress of every chunk that completed and the next pass resumes from
 * it. There is no retry inside a pass.
 */
export async function runReconcileScan(deps: DepositReconcilerDeps, chainIds: string[]): Promise<void> {
  for (const chainId of chainIds) {
    if (scansInFlight.has(chainId)) {
      log.info('deposit reconcile: a scan is already in flight for this chain — skipping', { chainId })
      continue
    }
    scansInFlight.add(chainId)
    try {
      const report = await reconcileVaultDeposits(deps, { chainId })
      log.info('deposit reconcile complete', {
        chainId,
        fromBlock: report.fromBlock,
        toBlock: report.toBlock,
        logsSeen: report.logsSeen,
        healed: report.processed,
        skipped: report.skipped,
        conservation: report.conservation.ok ? 'ok' : 'MISMATCH',
        checked: report.conservation.checked,
      })
    } catch (err) {
      log.warn('deposit reconcile failed', { chainId, error: String(err) })
    } finally {
      scansInFlight.delete(chainId)
    }
  }
}

/**
 * Boot-time catch-up, fire-and-forget. Every deploy runs one, which is the shape of the outages
 * that have actually happened (a webhook silently not delivering until someone notices).
 */
export async function runBootReconcile(deps: DepositReconcilerDeps, chainIds: string[]): Promise<void> {
  return runReconcileScan(deps, chainIds)
}

// ---------------------------------------------------------------------------
// The patrol timer
// ---------------------------------------------------------------------------

/** Period between patrol passes when `DEPOSIT_RECONCILE_INTERVAL_MS` is unset. */
export const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Resolve the patrol period from the environment. Unset (or empty) → the default above. `0`, a
 * negative value, or anything that is not a number → `0`, which the caller reads as "no timer":
 * the boot scan and the operator route then carry reconciliation between them.
 */
export function resolveReconcileIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_RECONCILE_INTERVAL_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

/**
 * Start the patrol: every `intervalMs`, one cursor-driven pass over the served chains. The boot
 * scan covers the gap a restart opens; this covers the gap BETWEEN deploys, where a missed webhook
 * delivery would otherwise wait for the next boot to be healed.
 *
 * `intervalMs <= 0` disables the timer and returns `null` after saying so once. The handle is
 * `unref`'d so the patrol never holds the process open.
 */
export function startReconcileTimer(
  deps: DepositReconcilerDeps,
  chainIds: string[],
  intervalMs: number,
): NodeJS.Timeout | null {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    log.warn('deposit reconcile timer disabled (DEPOSIT_RECONCILE_INTERVAL_MS is 0 or not a positive number) — reconciliation runs on boot and on the operator route only')
    return null
  }
  const timer = setInterval(() => {
    void runReconcileScan(deps, chainIds).catch(err => log.warn('deposit reconcile tick failed', { error: String(err) }))
  }, intervalMs)
  timer.unref?.()
  log.info('deposit reconcile timer started', { intervalMs, chainIds })
  return timer
}
