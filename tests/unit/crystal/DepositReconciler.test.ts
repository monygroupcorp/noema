/**
 * `reconcileVaultDeposits` — the chain heals the webhook.
 *
 * The webhook is a notification: a delivery that never arrives leaves funds in the vault with no
 * `Depositum`. The reconciler reads the vault's logs back over a block window and processes what
 * is missing, through the SAME core the webhook route uses. These cases pin the four properties
 * that make that safe to run on every boot:
 *
 *   1. a deposit with no record is healed — credited exactly once, through the normal rail;
 *   2. a deposit the webhook already credited is re-processed as a NO-OP (no second Depositum,
 *      no second Signum, no second Reditus);
 *   3. only the configured vault's known events are handed to the crediting core at all;
 *   4. the cursor advances, so a second scan of the same window reads and credits nothing;
 *   5. recorded amounts are reconciled against the chain's own deposit events (the tripwire).
 *
 * Every case asserts on the STORE SPIES, not on the returned report alone: a scan that reported
 * one healed deposit but issued two Signa is the exact outcome these guards exist to prevent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AbiCoder } from 'ethers'
import {
  reconcileVaultDeposits,
  memoryScanCursor,
  checkConservation,
  CONFIRMATION_LAG,
  type EthRpc,
  type RpcLog,
  type ScanCursor,
} from '../../../src/crystal/DepositReconciler.js'
import type { AlchemyWebhookDeps, AlchemyLog } from '../../../src/api/webhooks/alchemyWebhook.js'
import { handleAlchemyWebhook } from '../../../src/api/webhooks/alchemyWebhook.js'
import { permissiveSanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import { fixedPricer } from '../../../src/crystal/AssetPricer.js'
import type { Depositum, Depositorum, Petitio, Petitionum, Testimonium, Testimoniorum } from '../../../src/types/catena.js'
import type { Signum, Signorum } from '../../../src/types/significandi.js'
import type { Reditus, ReditusDraft, Redituum } from '../../../src/types/reditus.js'

// ── Constants (mirror the implementation) ─────────────────────────────────────

const TOPIC_PAYMENT      = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_ANON_DEPOSIT = '0x879aadcc0b21da25bde4bcf799cb142a02d0135f66a1328fef12c8b78636c58d'
const TOPIC_UNKNOWN      = '0x' + 'ab'.repeat(32)

const VAULT      = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
const OTHER_ADDR = '0x1234561234561234561234561234561234561234'
const CHAIN_ID   = '1'

const PAYER   = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const TX_HASH = '0x' + '11'.repeat(32)
const TOKEN   = '0x0000000000000000000000000000000000000000'   // ETH sentinel
const AMOUNT  = 1_000_000_000_000_000n                          // 0.001 ETH in wei

/** 0.001 ETH @ $3000 = $3 gross; credit is NET of the default 0.70 funding rate. */
const EXPECTED_GROSS_USD_FMV = 3_000_000n
const EXPECTED_CREDIT_IMPETUS = 6231n

const DEPOSIT_AUCTOR = 'alchemy-webhook'

/**
 * Fixture blocks sit above the chain's vault deployment block — the floor a first-ever scan
 * starts from. A window below it is not a window this reconciler would ever read.
 */
const DEPLOYMENT_BLOCK = 24_595_416
const LOG_BLOCK = DEPLOYMENT_BLOCK + 1_000

let idSeq = 0
const nextId = (p: string) => `${p}-${++idSeq}`

// ── Spied stores ──────────────────────────────────────────────────────────────

function makeDeposita(): Depositorum & { store: Map<string, Depositum> } {
  const store = new Map<string, Depositum>()
  return {
    store,
    async find(id) { return store.get(id) ?? null },
    async findByHash(transactioHash, chainId) {
      for (const d of store.values()) {
        if (d.transactioHash === transactioHash && String(d.chainId) === String(chainId)) return d
      }
      return null
    },
    async list(filter) {
      let all = [...store.values()]
      if (filter?.status) all = all.filter(d => d.status === filter.status)
      return all
    },
    async create(input) {
      const d: Depositum = { ...input, id: nextId('dep'), natum: new Date() }
      store.set(d.id, d)
      return d
    },
    async update(id, patch) {
      const d = store.get(id)
      if (!d) throw new Error(`Depositum ${id} not found`)
      Object.assign(d, patch)
      return d
    },
  }
}

/**
 * Mirrors the production durable guard: a unique PARTIAL index on (testis) where
 * auctor = the deposit auctor, so a second issue for the same transaction throws a
 * duplicate-key error rather than minting twice.
 */
function makeSignorum(): Signorum & { issued: Signum[] } {
  const issued: Signum[] = []
  return {
    issued,
    async balance() { return 0n },
    async issue(input) {
      if (input.auctor === DEPOSIT_AUCTOR && input.testis !== undefined
        && issued.some(s => s.auctor === DEPOSIT_AUCTOR && s.testis === input.testis)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      }
      const s: Signum = { ...input, id: nextId('sig'), status: 'valid', natum: new Date() }
      issued.push(s)
      return s
    },
    async lock() {},
    async release() {},
    async history({ animaId }: { animaId: string }) { return issued.filter(s => s.animaId === animaId) },
    async settle() {},
    async sessionBudget() { throw new Error('not implemented') },
    async reserve() { throw new Error('not implemented') },
    async findByTestis() { throw new Error('not implemented') },
    async ownsAny() { throw new Error('not implemented') },
    async transfer() { throw new Error('not implemented') },
    async createMany() { throw new Error('not implemented') },
  }
}

function makeRedituum(): Redituum & { rows: Reditus[] } {
  const rows: Reditus[] = []
  return {
    rows,
    async record(draft: ReditusDraft) {
      if (typeof draft.usdFmv !== 'bigint' || draft.usdFmv <= 0n) throw new Error('Reditus fail-closed: usdFmv')
      if (draft.depositumId !== undefined) {
        const existing = rows.find(r => r.depositumId === draft.depositumId)
        if (existing) return existing   // idempotent, mirrors MemoryRedituum
      }
      const r: Reditus = {
        id: nextId('red'), natum: new Date(), usdFmv: draft.usdFmv, fmvSource: draft.fmvSource, origo: draft.origo,
        ...(draft.depositumId !== undefined ? { depositumId: draft.depositumId } : {}),
      }
      rows.push(r)
      return r
    },
    async trailingUsdRevenue() { return rows.reduce((s, r) => s + r.usdFmv, 0n) },
    async findByChargeRef() { throw new Error('not implemented') },
    async reverse() { throw new Error('not implemented') },
  }
}

function makePetitiones(): Petitionum {
  const store = new Map<string, Petitio>()
  return {
    async find(id) { return store.get(id) ?? null },
    async findExpectans() { return null },
    async create(input) {
      const p: Petitio = { ...input, id: nextId('pet'), natum: new Date() }
      store.set(p.id, p)
      return p
    },
    async update(id, patch) {
      const p = store.get(id)
      if (!p) throw new Error(`Petitio ${id} not found`)
      const updated = { ...p, ...patch }
      store.set(id, updated)
      return updated
    },
    async expireStale() { return 0 },
  }
}

function makeTestimonia(): Testimoniorum & { store: Testimonium[] } {
  const store: Testimonium[] = []
  return {
    store,
    async find(id) { return store.find(t => t.id === id) ?? null },
    async findByPossessor() { return null },
    async listByAnima(animaId) { return store.filter(t => t.animaId === animaId) },
    async create(input) {
      const t: Testimonium = { ...input, id: nextId('tes'), natum: new Date() }
      store.push(t)
      return t
    },
    async update(id, patch) {
      const t = store.find(x => x.id === id)
      if (!t) throw new Error(`Testimonium ${id} not found`)
      Object.assign(t, patch)
      return t
    },
  }
}

function makeArcanumTree(): AlchemyWebhookDeps['arcanumTree'] & { leaves: Map<string, bigint> } {
  const leaves = new Map<string, bigint>()
  return {
    leaves,
    async insert(commitment: string, valor: bigint) {
      leaves.set(commitment, valor)
      return { leafIndex: leaves.size - 1, proof: {} as never }
    },
    async findLeaf(commitment: string) {
      return leaves.has(commitment) ? ({ commitment, valor: leaves.get(commitment)! } as never) : null
    },
    async size() { return leaves.size },
    async getProof() { throw new Error('not implemented') },
    async getRoot() { throw new Error('not implemented') },
  }
}

const ANIMA_ID = 'anima-under-test'

function makeWebhookDeps(overrides: Partial<AlchemyWebhookDeps> = {}): AlchemyWebhookDeps & {
  deposita: ReturnType<typeof makeDeposita>
  signorum: ReturnType<typeof makeSignorum>
  redituum: ReturnType<typeof makeRedituum>
  arcanumTree: ReturnType<typeof makeArcanumTree>
} {
  const deposita = (overrides.deposita as ReturnType<typeof makeDeposita>) ?? makeDeposita()
  const signorum = (overrides.signorum as ReturnType<typeof makeSignorum>) ?? makeSignorum()
  const redituum = (overrides.redituum as ReturnType<typeof makeRedituum>) ?? makeRedituum()
  const arcanumTree = (overrides.arcanumTree as ReturnType<typeof makeArcanumTree>) ?? makeArcanumTree()
  return {
    deposita,
    signorum,
    redituum,
    arcanumTree,
    petitiones: overrides.petitiones ?? makePetitiones(),
    testimonia: overrides.testimonia ?? makeTestimonia(),
    resolveWalletAnima: overrides.resolveWalletAnima
      ?? (async (wallet: string) => (wallet.toLowerCase() === PAYER.toLowerCase() ? ANIMA_ID : null)),
    sanctions: overrides.sanctions ?? permissiveSanctionsScreen,
    signingKeys: overrides.signingKeys ?? { [CHAIN_ID]: 'signing-key-under-test' },
    vaultAddresses: overrides.vaultAddresses ?? { [CHAIN_ID]: VAULT },
    pricer: overrides.pricer ?? fixedPricer(3000, 18),   // $3000/ETH at 18 decimals
  }
}

// ── Chain fixtures ────────────────────────────────────────────────────────────

const coder = AbiCoder.defaultAbiCoder()

const padTopic = (addr: string) => '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0')

function paymentRpcLog(overrides: { address?: string; txHash?: string; amount?: bigint; blockNumber?: number } = {}): RpcLog {
  return {
    address: overrides.address ?? VAULT,
    topics: [TOPIC_PAYMENT, padTopic(PAYER), padTopic('0x0000000000000000000000000000000000000000')],
    data: coder.encode(['address', 'uint256', 'uint256', 'uint256'], [TOKEN, overrides.amount ?? AMOUNT, 0n, 0n]),
    transactionHash: overrides.txHash ?? TX_HASH,
    blockNumber: '0x' + (overrides.blockNumber ?? LOG_BLOCK).toString(16),
  }
}

function anonRpcLog(commitment: string): RpcLog {
  return {
    address: VAULT,
    topics: [TOPIC_ANON_DEPOSIT, commitment],
    data: coder.encode(['address', 'uint256'], [TOKEN, AMOUNT]),
    transactionHash: '0x' + '22'.repeat(32),
    blockNumber: '0x' + LOG_BLOCK.toString(16),
  }
}

/** The webhook's own log shape, for the "already delivered" half of the idempotency case. */
function paymentWebhookLog(): AlchemyLog {
  const l = paymentRpcLog()
  return { account: { address: l.address }, topics: l.topics, data: l.data, transaction: { hash: l.transactionHash } }
}

interface FakeRpc extends EthRpc {
  getLogsCalls: Array<{ fromBlock: number; toBlock: number }>
  txCalls: string[]
}

function makeRpc(opts: { head: number; logs: RpcLog[]; from?: string }): FakeRpc {
  const getLogsCalls: Array<{ fromBlock: number; toBlock: number }> = []
  const txCalls: string[] = []
  return {
    getLogsCalls,
    txCalls,
    async blockNumber() { return opts.head },
    async getLogs(_chainId, filter) {
      getLogsCalls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock })
      return opts.logs.filter(l => {
        const b = Number(BigInt(l.blockNumber))
        return b >= filter.fromBlock && b <= filter.toBlock
      })
    },
    async transactionFrom(_chainId, txHash) { txCalls.push(txHash); return opts.from ?? null },
  }
}

/** A window whose head is far enough ahead that `CONFIRMATION_LAG` cannot swallow it. */
const HEAD = LOG_BLOCK + 1_000 + CONFIRMATION_LAG

function seededCursor(lastScanned: number): ScanCursor {
  return memoryScanCursor({ [CHAIN_ID]: lastScanned })
}

// ── 1. A missed deposit is healed ─────────────────────────────────────────────

test('a deposit with no record is healed: one Depositum, one Signum, one Reditus', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  assert.equal(report.processed, 1)
  assert.equal(report.logsSeen, 1)

  const deposita = [...webhook.deposita.store.values()]
  assert.equal(deposita.length, 1)
  assert.equal(deposita[0].status, 'processatum')
  assert.equal(deposita[0].animaId, ANIMA_ID)
  assert.equal(deposita[0].valor, AMOUNT)

  assert.equal(webhook.signorum.issued.length, 1)
  assert.equal(webhook.signorum.issued[0].valor, EXPECTED_CREDIT_IMPETUS)
  assert.equal(webhook.signorum.issued[0].testis, TX_HASH)

  assert.equal(webhook.redituum.rows.length, 1)
  assert.equal(webhook.redituum.rows[0].usdFmv, EXPECTED_GROSS_USD_FMV)

  assert.equal(report.conservation.ok, true)
  assert.equal(report.conservation.checked, 1)
})

test('an unlinked payer is parked confirmatum, not credited — the normal rail, unchanged', async () => {
  const webhook = makeWebhookDeps({ resolveWalletAnima: async () => null })
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  const deposita = [...webhook.deposita.store.values()]
  assert.equal(deposita.length, 1)
  assert.equal(deposita[0].status, 'confirmatum')
  assert.equal(webhook.signorum.issued.length, 0)
  assert.equal(webhook.redituum.rows.length, 1)   // revenue is recognized at receipt regardless
})

// ── 2. Idempotency: the webhook already credited it ───────────────────────────

test('a deposit the webhook already credited is NOT credited a second time', async () => {
  const webhook = makeWebhookDeps()

  // The webhook delivered and credited this deposit first.
  const body = { type: 'GRAPHQL', event: { data: { block: { number: LOG_BLOCK, logs: [paymentWebhookLog()] } } } }
  const rawBody = JSON.stringify(body)
  const { createHmac } = await import('node:crypto')
  const signature = createHmac('sha256', 'signing-key-under-test').update(rawBody).digest('hex')
  const first = await handleAlchemyWebhook({ body, rawBody, signature, chainId: CHAIN_ID }, webhook)
  assert.equal(first.status, 200)
  assert.equal(webhook.signorum.issued.length, 1)

  // The reconciler now re-reads the same log from the chain.
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  assert.equal(report.processed, 0)
  assert.equal(report.skipped, 1)
  assert.equal([...webhook.deposita.store.values()].length, 1, 'no second Depositum')
  assert.equal(webhook.signorum.issued.length, 1, 'no second Signum')
  assert.equal(webhook.redituum.rows.length, 1, 'no second Reditus')
  assert.equal(report.conservation.ok, true)
})

test('re-running the reconciler over the same window credits nothing further', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  const deps = { webhook, rpc, cursor: memoryScanCursor() }

  await reconcileVaultDeposits(deps, { chainId: CHAIN_ID, fromBlock: LOG_BLOCK - 100, toBlock: LOG_BLOCK + 100 })
  await reconcileVaultDeposits(deps, { chainId: CHAIN_ID, fromBlock: LOG_BLOCK - 100, toBlock: LOG_BLOCK + 100 })

  assert.equal([...webhook.deposita.store.values()].length, 1)
  assert.equal(webhook.signorum.issued.length, 1)
  assert.equal(webhook.redituum.rows.length, 1)
})

// ── 3. Bounded trust: address + topic ─────────────────────────────────────────

test('a log from a non-vault contract is never handed to the crediting core', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog({ address: OTHER_ADDR })] })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  assert.equal(report.logsSeen, 0, 'the reconciler drops it before the core sees it')
  assert.equal(report.processed, 0)
  assert.equal([...webhook.deposita.store.values()].length, 0)
  assert.equal(webhook.signorum.issued.length, 0)
  assert.equal(webhook.redituum.rows.length, 0)
})

test('a log carrying an unknown topic is never handed to the crediting core', async () => {
  const webhook = makeWebhookDeps()
  const stray: RpcLog = { ...paymentRpcLog(), topics: [TOPIC_UNKNOWN] }
  const rpc = makeRpc({ head: HEAD, logs: [stray] })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  assert.equal(report.logsSeen, 0)
  assert.equal([...webhook.deposita.store.values()].length, 0)
  assert.equal(webhook.signorum.issued.length, 0)
})

test('an anonymous deposit gets its funder from the transaction, so the leaf is admitted', async () => {
  const webhook = makeWebhookDeps()
  const commitment = '0x' + '33'.repeat(32)
  const rpc = makeRpc({ head: HEAD, logs: [anonRpcLog(commitment)], from: PAYER })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  assert.equal(report.processed, 1)
  assert.deepEqual(rpc.txCalls, ['0x' + '22'.repeat(32)])
  // The leaf carries impetus, not the raw wei amount — the same figure the identified path
  // credits for this deposit. valor is hashed into the leaf and the spend proof certifies it,
  // so the conversion happens once, here at issuance, and never again at redemption.
  assert.equal(webhook.arcanumTree.leaves.get(commitment), EXPECTED_CREDIT_IMPETUS)
  assert.notEqual(webhook.arcanumTree.leaves.get(commitment), AMOUNT)
  assert.equal(webhook.signorum.issued.length, 0, 'an anonymous note issues no Signum')
})

// ── 4. Cursor advancement ─────────────────────────────────────────────────────

test('a second scan re-reads nothing and re-credits nothing: the cursor advanced', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  const cursor = memoryScanCursor({ [CHAIN_ID]: LOG_BLOCK - 1 })
  const deps = { webhook, rpc, cursor }

  const first = await reconcileVaultDeposits(deps, { chainId: CHAIN_ID })
  assert.equal(first.fromBlock, LOG_BLOCK)
  assert.equal(first.toBlock, HEAD - CONFIRMATION_LAG)
  assert.equal(first.processed, 1)
  assert.equal(await cursor.get(CHAIN_ID), HEAD - CONFIRMATION_LAG)

  const callsAfterFirst = rpc.getLogsCalls.length
  const second = await reconcileVaultDeposits(deps, { chainId: CHAIN_ID })

  assert.equal(second.fromBlock, HEAD - CONFIRMATION_LAG + 1)
  assert.equal(second.chunks, 0, 'nothing left to scan')
  assert.equal(second.logsSeen, 0)
  assert.equal(rpc.getLogsCalls.length, callsAfterFirst, 'the window is not re-read')
  assert.equal([...webhook.deposita.store.values()].length, 1)
  assert.equal(webhook.signorum.issued.length, 1)
})

test('the cursor never advances past the confirmation lag', async () => {
  const webhook = makeWebhookDeps()
  const head = LOG_BLOCK + 50
  const rpc = makeRpc({ head, logs: [] })
  const cursor = memoryScanCursor({ [CHAIN_ID]: LOG_BLOCK })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor }, { chainId: CHAIN_ID })

  assert.equal(report.toBlock, head - CONFIRMATION_LAG)
  assert.equal(await cursor.get(CHAIN_ID), head - CONFIRMATION_LAG)
})

test('an operator-supplied window does not move the cursor backwards', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  const cursor = memoryScanCursor({ [CHAIN_ID]: LOG_BLOCK + 50_000 })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor }, { chainId: CHAIN_ID, fromBlock: LOG_BLOCK - 100, toBlock: LOG_BLOCK + 100 })

  assert.equal(report.processed, 1)
  assert.equal(await cursor.get(CHAIN_ID), LOG_BLOCK + 50_000, 'the frontier is unchanged by a replay')
})

test('a first-ever scan starts at the chain deployment block, not at zero', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: DEPLOYMENT_BLOCK + 5_000, logs: [] })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: memoryScanCursor() }, { chainId: CHAIN_ID })

  assert.equal(report.fromBlock, DEPLOYMENT_BLOCK)
  assert.equal(rpc.getLogsCalls[0].fromBlock, DEPLOYMENT_BLOCK)
})

// ── 5. Conservation tripwire ──────────────────────────────────────────────────

test('conservation: recorded deposits equal the chain deposit events', async () => {
  const webhook = makeWebhookDeps()
  const rpc = makeRpc({ head: HEAD, logs: [paymentRpcLog()] })
  const report = await reconcileVaultDeposits({ webhook, rpc, cursor: seededCursor(LOG_BLOCK - 1) }, { chainId: CHAIN_ID })

  assert.equal(report.conservation.ok, true)
  assert.equal(report.conservation.deltas.length, 0)
  assert.equal(report.conservation.checked, 1)
})

test('conservation: a recorded amount that disagrees with the chain is reported as a delta', async () => {
  const webhook = makeWebhookDeps()
  // A row already exists for this transaction carrying LESS than the chain says arrived.
  await webhook.deposita.create({
    chainId: CHAIN_ID, transactioHash: TX_HASH, ab: PAYER, ad: VAULT,
    valor: AMOUNT / 2n, token: TOKEN, usdFmv: EXPECTED_GROSS_USD_FMV, confirmationes: 1, status: 'processatum',
  })

  const entries: AlchemyLog[] = [paymentWebhookLog()]
  const result = await checkConservation(entries, CHAIN_ID, webhook.deposita)

  assert.equal(result.ok, false)
  assert.equal(result.checked, 1)
  assert.deepEqual(result.deltas, [{
    token: TOKEN,
    chainTotal: AMOUNT.toString(),
    recordedTotal: (AMOUNT / 2n).toString(),
  }])
})

test('conservation: a chain deposit event with no record at all is a delta', async () => {
  const webhook = makeWebhookDeps()
  const result = await checkConservation([paymentWebhookLog()], CHAIN_ID, webhook.deposita)

  assert.equal(result.ok, false)
  assert.deepEqual(result.deltas, [{ token: TOKEN, chainTotal: AMOUNT.toString(), recordedTotal: '0' }])
})

test('conservation: anonymous deposits are out of scope — they write no Depositum by design', async () => {
  const webhook = makeWebhookDeps()
  const anon = anonRpcLog('0x' + '44'.repeat(32))
  const entry: AlchemyLog = {
    account: { address: anon.address }, topics: anon.topics, data: anon.data,
    transaction: { hash: anon.transactionHash, from: PAYER },
  }
  const result = await checkConservation([entry], CHAIN_ID, webhook.deposita)

  assert.equal(result.ok, true)
  assert.equal(result.checked, 0)
})
