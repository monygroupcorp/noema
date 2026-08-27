/**
 * The deposit reconciler on a timer — the healer patrols between deploys, not only at boot.
 *
 * `runBootReconcile` heals the gap a restart opens. On its own that leaves the gap BETWEEN
 * deploys: a missed webhook delivery waits for the next boot. `startReconcileTimer` closes it by
 * running the same pass on an interval. These cases pin the two properties that make an interval
 * safe to point at the crediting rail:
 *
 *   1. a tick fires a CURSOR-DRIVEN scan — no explicit window, so the cursor advances and a long
 *      historical range finishes itself tick by tick;
 *   2. a tick that arrives while a scan is still running SKIPS that chain — passes never stack.
 *
 * Both assert on the RPC/cursor spies rather than on a return value: a timer that reported a tick
 * but read no window, or one that stacked a second `eth_getLogs` walk onto a running scan, is
 * exactly what these guards exist to catch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startReconcileTimer,
  runReconcileScan,
  resolveReconcileIntervalMs,
  memoryScanCursor,
  DEFAULT_RECONCILE_INTERVAL_MS,
  CONFIRMATION_LAG,
  VAULT_DEPLOYMENT_BLOCK,
  type DepositReconcilerDeps,
  type EthRpc,
} from '../../../../src/crystal/DepositReconciler.js'
import type { AlchemyWebhookDeps } from '../../../../src/api/webhooks/alchemyWebhook.js'

const CHAIN_ID = '1'
const VAULT = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
const DEPLOYMENT_BLOCK = VAULT_DEPLOYMENT_BLOCK[CHAIN_ID]!

/** A head far enough above the deployment floor that one final, log-free window exists behind it. */
const HEAD = DEPLOYMENT_BLOCK + CONFIRMATION_LAG + 100

interface RpcSpy extends EthRpc {
  headCalls: number
  windows: Array<{ fromBlock: number; toBlock: number }>
}

function makeRpc(gate?: Promise<void>): RpcSpy {
  const spy: RpcSpy = {
    headCalls: 0,
    windows: [],
    async blockNumber() {
      spy.headCalls++
      if (gate) await gate
      return HEAD
    },
    async getLogs(_chainId, filter) {
      spy.windows.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock })
      return []
    },
    async transactionFrom() { return null },
  }
  return spy
}

/**
 * The webhook bundle reduced to what an empty window touches: the vault address per chain. No log
 * survives to reach a store, so nothing else is exercised and nothing else is stubbed.
 */
const webhook = { vaultAddresses: { [CHAIN_ID]: VAULT } } as unknown as AlchemyWebhookDeps

function makeDeps(rpc: EthRpc, seed?: Record<string, number>): DepositReconcilerDeps {
  return { webhook, rpc, cursor: memoryScanCursor(seed) }
}

// ── Interval resolution ───────────────────────────────────────────────────────

test('the interval falls back to the default when unset, and 0 / a non-number disables the timer', () => {
  assert.equal(resolveReconcileIntervalMs(undefined), DEFAULT_RECONCILE_INTERVAL_MS)
  assert.equal(resolveReconcileIntervalMs(''), DEFAULT_RECONCILE_INTERVAL_MS)
  assert.equal(resolveReconcileIntervalMs('60000'), 60_000)
  assert.equal(resolveReconcileIntervalMs('0'), 0)
  assert.equal(resolveReconcileIntervalMs('-1'), 0)
  assert.equal(resolveReconcileIntervalMs('soon'), 0)
})

test('a disabled interval starts no timer', () => {
  assert.equal(startReconcileTimer(makeDeps(makeRpc()), [CHAIN_ID], 0), null)
})

// ── 1. The timer fires a cursor-driven scan (no explicit window) ──────────────

test('the timer fires a cursor-driven scan (no explicit window)', async () => {
  const rpc = makeRpc()
  // Seeded cursor: a cursor-driven scan resumes at cursor + 1. A window passed explicitly would
  // not, which is what makes this window assertion the discriminator.
  const resumeFrom = DEPLOYMENT_BLOCK + 3
  const deps = makeDeps(rpc, { [CHAIN_ID]: resumeFrom })

  const timer = startReconcileTimer(deps, [CHAIN_ID], 10)
  assert.notEqual(timer, null)
  try {
    await waitFor(() => rpc.windows.length >= 1)
  } finally {
    clearInterval(timer!)
  }

  assert.deepEqual(rpc.windows[0], { fromBlock: resumeFrom + 1, toBlock: HEAD - CONFIRMATION_LAG })
  // And the pass moved the frontier, which only a cursor-driven scan does.
  assert.equal(await deps.cursor.get(CHAIN_ID), HEAD - CONFIRMATION_LAG)
})

// ── 2. A tick during a running scan skips, it does not stack ─────────────────

test('a tick while a scan is still running SKIPS, does not stack', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const rpc = makeRpc(gate)
  const deps = makeDeps(rpc)

  const first = runReconcileScan(deps, [CHAIN_ID])   // parks on the gate, mid-scan
  await Promise.resolve()
  assert.equal(rpc.headCalls, 1, 'the first scan is in flight')

  const overlapping = runReconcileScan(deps, [CHAIN_ID])   // the tick arriving on top of it
  await Promise.resolve()
  assert.equal(rpc.headCalls, 1, 'the overlapping tick started no second scan')
  assert.equal(rpc.windows.length, 0, 'and read no window of its own')
  await overlapping                                        // it returned rather than parking

  release()
  await first
  assert.equal(rpc.windows.length, 1, 'the parked scan completed exactly one window')

  // Once nothing is in flight, the next pass runs normally — the guard gates overlap, not the rail.
  await runReconcileScan(deps, [CHAIN_ID])
  assert.equal(rpc.headCalls, 2)
})

/** Poll until `done`, or fail the test rather than hang the suite. */
async function waitFor(done: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the reconcile tick')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
