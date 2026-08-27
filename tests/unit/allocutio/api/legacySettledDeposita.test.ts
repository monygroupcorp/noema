// The house asset becoming priceable is what makes this suite necessary. Until now the deposits
// the earlier plane already settled were held back by a MISSING price basis, and every guard on
// the crediting path keys on that absence. Once the asset prices, the absence goes away and the
// only thing standing between those deposits and a second credit is the settled state itself.
//
// So the suite pins two seams together:
//   1. a deposit recorded as settled on the earlier plane is never credited by this one — through
//      the shared processing core (webhook + RPC reconciler) and through the retry sweep;
//   2. the coin-listing price source is an exact-address allowlist that fails to PARKED, never to
//      a zero valuation.
//
// It lives beside the other deposit suites here because this directory runs in the hermetic gate,
// which is what the money paths are gated on.
//
// All fixtures are invented. No production identifiers, addresses, hashes or amounts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AbiCoder } from 'ethers'
import {
  processVaultLogs,
  sweepConfirmatumDeposita,
  isSettledDepositum,
  type AlchemyLog,
  type AlchemyWebhookDeps,
} from '../../../../src/api/webhooks/alchemyWebhook.js'
import { AlchemyPricer, COINGECKO_ASSETS, nullPricer } from '../../../../src/crystal/AssetPricer.js'
import type { FetchLike } from '../../../../src/arcanum/ethPrice.js'
import type { Depositum, Depositorum, Petitionum } from '../../../../src/types/catena.js'
import type { Signum, Signorum } from '../../../../src/types/significandi.js'
import type { Reditus, ReditusDraft, Redituum } from '../../../../src/types/reditus.js'
import {
  decideRecord,
  writable,
  usdToMicroString,
  countToString,
  readExpect,
  coinListedAddresses,
  type LegacyCreditRow,
} from '../../../../scripts/migrations/2026_08_record_legacy_settled_deposita.js'

// ── The asset under test, taken from the configuration itself ─────────────────

const CHAIN_ID = '1'
const LISTED_ADDRESS = Object.keys(COINGECKO_ASSETS[CHAIN_ID])[0]
const LISTED = COINGECKO_ASSETS[CHAIN_ID][LISTED_ADDRESS]

const VAULT = '0x1111111111111111111111111111111111111111'
const PAYER = '0x2222222222222222222222222222222222222222'
const TX_HASH = '0x' + 'ab'.repeat(32)
const OTHER_TOKEN = '0x3333333333333333333333333333333333333333'
const TOPIC_PAYMENT = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'

// ── Fakes ─────────────────────────────────────────────────────────────────────

let seq = 0
const nextId = (p: string) => `${p}-${++seq}`

/** `unfiltered: true` models a store that ignores the status filter — the sweep must not depend on it. */
function makeDeposita(seed: Depositum[] = [], opts: { unfiltered?: boolean } = {}) {
  const store = new Map<string, Depositum>(seed.map(d => [d.id, d]))
  const created: Depositum[] = []
  return {
    store,
    created,
    async find(id: string) { return store.get(id) ?? null },
    async findByHash(hash: string, chainId: number | string) {
      for (const d of store.values()) if (d.transactioHash === hash && String(d.chainId) === String(chainId)) return d
      return null
    },
    async list(filter?: Partial<Pick<Depositum, 'status' | 'animaId'>>) {
      const all = [...store.values()]
      if (opts.unfiltered) return all
      return filter?.status ? all.filter(d => d.status === filter.status) : all
    },
    async create(input: Omit<Depositum, 'id' | 'natum'>) {
      const d: Depositum = { ...input, id: nextId('dep'), natum: new Date() }
      store.set(d.id, d)
      created.push(d)
      return d
    },
    async update(id: string, patch: Partial<Depositum>) {
      const d = store.get(id)
      if (!d) throw new Error(`Depositum ${id} not found`)
      const updated = { ...d, ...patch }
      store.set(id, updated)
      return updated
    },
  } satisfies Depositorum & { store: Map<string, Depositum>; created: Depositum[] }
}

function makeSignorum() {
  const issued: Signum[] = []
  const fail = () => { throw new Error('not used') }
  return {
    issued,
    async balance() { return 0n },
    async issue(input: Parameters<Signorum['issue']>[0]) {
      const s = { ...input, id: nextId('sig'), status: 'valid', natum: new Date() } as Signum
      issued.push(s)
      return s
    },
    async lock() {}, async release() {}, async history() { return [] }, async settle() {},
    async sessionBudget() { return fail() }, async reserve() { return fail() },
    async findByTestis() { return fail() }, async ownsAny() { return fail() },
    async transfer() { return fail() }, async createMany() { return fail() },
  } as unknown as Signorum & { issued: Signum[] }
}

function makeRedituum() {
  const rows: Reditus[] = []
  return {
    rows,
    async record(draft: ReditusDraft) {
      const hit = draft.depositumId !== undefined ? rows.find(r => r.depositumId === draft.depositumId) : undefined
      if (hit) return hit
      const r = { id: nextId('red'), natum: new Date(), usdFmv: draft.usdFmv, fmvSource: draft.fmvSource, origo: draft.origo, ...(draft.depositumId !== undefined ? { depositumId: draft.depositumId } : {}) } as Reditus
      rows.push(r)
      return r
    },
    async trailingUsdRevenue() { return rows.reduce((s, r) => s + r.usdFmv, 0n) },
    async findByChargeRef() { throw new Error('not used') },
    async reverse() { throw new Error('not used') },
  } as unknown as Redituum & { rows: Reditus[] }
}

const petitiones = {
  async find() { return null },
  async findExpectans() { return null },
  async create() { throw new Error('not used') },
  async update() { throw new Error('not used') },
  async expireStale() { return 0 },
} as unknown as Petitionum

function makeDeps(deposita: ReturnType<typeof makeDeposita>, over: Partial<AlchemyWebhookDeps> = {}) {
  return {
    deposita,
    signorum: makeSignorum(),
    redituum: makeRedituum(),
    petitiones,
    testimonia: { async create() { throw new Error('not used') } },
    resolveWalletAnima: async () => 'anima-1',
    arcanumTree: { async findLeaf() { return null }, async insert() { return { leafIndex: 0 } } },
    sanctions: { async screen() { return { ok: true as const } } },
    signingKeys: {},
    vaultAddresses: { [CHAIN_ID]: VAULT },
    pricer: nullPricer,
    ...over,
  } as unknown as AlchemyWebhookDeps & {
    signorum: Signorum & { issued: Signum[] }
    redituum: Redituum & { rows: Reditus[] }
  }
}

const coder = AbiCoder.defaultAbiCoder()
const topicAddr = (a: string) => '0x' + a.toLowerCase().replace('0x', '').padStart(64, '0')

function paymentLog(token: string, amount: bigint, txHash = TX_HASH): AlchemyLog {
  return {
    account: { address: VAULT },
    topics: [TOPIC_PAYMENT, topicAddr(PAYER), topicAddr('0x' + '0'.repeat(40))],
    data: coder.encode(['address', 'uint256', 'uint256', 'uint256'], [token, amount, 0n, 0n]),
    transaction: { hash: txHash },
  }
}

/** The shape the completion migration leaves behind: settled, with a COMPLETE receipt-time basis. */
function settledDeposit(): Depositum {
  return {
    id: 'dep-settled',
    chainId: CHAIN_ID,
    transactioHash: TX_HASH,
    ab: PAYER,
    ad: VAULT,
    valor: 400_000_000_000n,
    token: LISTED_ADDRESS,
    usdFmv: 10_000_000n,
    confirmationes: 1,
    status: 'praesolutum',
    praesolutio: { ledgerRef: 'legacy-row-1', punctaCredita: '20000', grossUsdFmv: '10000000', recordatum: new Date() },
    natum: new Date('2026-01-01T00:00:00Z'),
  }
}

// ── 1. A deposit settled on the earlier plane is never credited by this one ────

test('NON-VACUITY GATE 1 — a settled deposit re-delivered to the processing core is never credited', async () => {
  // Post-migration shape on purpose: the basis is PRESENT, so the missing-basis guards that used
  // to hold this row no longer apply and the settled state is the only thing that does.
  const deposita = makeDeposita([settledDeposit()])
  const deps = makeDeps(deposita, { pricer: { async usdFmv() { return 20_000_000n } } })

  const counts = await processVaultLogs([paymentLog(LISTED_ADDRESS, 400_000_000_000n)], CHAIN_ID, deps)

  assert.equal(counts.processed, 0, 'a settled deposit must not be processed again')
  assert.deepEqual(deposita.created, [], 'no second Depositum for the same transaction')
  assert.deepEqual(deps.signorum.issued, [], 'no Signum — the funder was already credited')
  assert.deepEqual(deps.redituum.rows, [], 'no second revenue row')
  assert.equal(deposita.store.get('dep-settled')!.status, 'praesolutum', 'the row is unchanged')
})

test('NON-VACUITY GATE 1 — the retry sweep never credits a settled deposit', async () => {
  // The store here does NOT honour the status filter, which is the point: the sweep asserts the
  // settled state itself rather than trusting the query that produced its list.
  const deposita = makeDeposita([settledDeposit()], { unfiltered: true })
  const deps = makeDeps(deposita)

  const result = await sweepConfirmatumDeposita(deps)

  assert.equal(result.swept, 0)
  assert.equal(result.skipped, 1)
  assert.deepEqual(deps.signorum.issued, [])
  assert.deepEqual(deps.redituum.rows, [])
})

test('a genuinely parked deposit is still credited — the settled check is not a blanket stop', async () => {
  const parked: Depositum = { ...settledDeposit(), id: 'dep-parked', status: 'confirmatum' }
  const deposita = makeDeposita([parked], { unfiltered: true })
  const deps = makeDeps(deposita)

  const result = await sweepConfirmatumDeposita(deps)

  assert.equal(result.swept, 1)
  assert.equal(deps.signorum.issued.length, 1)
  assert.equal(deposita.store.get('dep-parked')!.status, 'processatum')
})

test('isSettledDepositum: both terminal credited states, and nothing else', () => {
  assert.equal(isSettledDepositum('processatum'), true)
  assert.equal(isSettledDepositum('praesolutum'), true)
  for (const s of ['confirmatum', 'detectum', 'fractum'] as const) assert.equal(isSettledDepositum(s), false)
})

// ── 2. Coin-listing pricing: an allowlist that fails to parked ────────────────

/**
 * A fetch that answers CoinGecko with `coinPrice` and answers every Alchemy endpoint with NO
 * price. An unknown token is therefore unpriceable UNLESS the coin listing is consulted for it —
 * which is exactly what the address allowlist must prevent.
 */
function fakeFetch(opts: { coinPrice?: number | null; coinStatus?: number; throws?: boolean } = {}): FetchLike {
  return async (url: string) => {
    if (opts.throws) throw new Error('network down')
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url.includes('coingecko')) {
      if (opts.coinStatus && opts.coinStatus >= 400) return { ok: false, status: opts.coinStatus, json: async () => ({}) }
      const price = opts.coinPrice
      return ok(price == null ? {} : { [LISTED.coinId]: { usd: price } })
    }
    if (url.includes('by-address')) return ok({ data: [{ address: OTHER_TOKEN, prices: [] }] })
    return ok({ result: {} })   // token metadata: no decimals for an asset the feed cannot see
  }
}

test('the listed asset prices from its coin listing, at the configured decimals', async () => {
  const pricer = new AlchemyPricer('key', fakeFetch({ coinPrice: 0.000025 }))
  // 400,000 whole tokens at 6 decimals × $0.000025 = $10 = 10_000_000 micro-USD.
  assert.equal(await pricer.usdFmv(CHAIN_ID, LISTED_ADDRESS, 400_000_000_000n), 10_000_000n)
})

test('a sub-cent price survives the multiply — the basis is not rounded to whole micro-USD', async () => {
  // The price is 37.5 micro-USD per token. Rounding it to whole micro-USD before multiplying
  // would book $15.20 on this amount instead of $15.00; the pico-USD intermediate keeps it exact.
  const pricer = new AlchemyPricer('key', fakeFetch({ coinPrice: 0.0000375 }))
  assert.equal(await pricer.usdFmv(CHAIN_ID, LISTED_ADDRESS, 400_000_000_000n), 15_000_000n)
})

test('NON-VACUITY GATE 2 — an unlisted token still parks unpriced, never falls back to the listing', async () => {
  const pricer = new AlchemyPricer('key', fakeFetch({ coinPrice: 0.000025 }))
  assert.equal(await pricer.usdFmv(CHAIN_ID, OTHER_TOKEN, 400_000_000_000n), null)
})

test('NON-VACUITY GATE 2 — the allowlist is per chain: the same address on another chain is unlisted', async () => {
  const pricer = new AlchemyPricer('key', fakeFetch({ coinPrice: 0.000025 }))
  assert.equal(await pricer.usdFmv('8453', LISTED_ADDRESS, 400_000_000_000n), null)
})

test('NON-VACUITY GATE 3 — the price source unreachable: the deposit parks, never a zero valuation', async () => {
  const pricer = new AlchemyPricer('key', fakeFetch({ throws: true }))
  assert.equal(await pricer.usdFmv(CHAIN_ID, LISTED_ADDRESS, 400_000_000_000n), null)
})

test('NON-VACUITY GATE 3 — the price source erroring, and answering without a price, both park', async () => {
  const erroring = new AlchemyPricer('key', fakeFetch({ coinStatus: 503 }))
  assert.equal(await erroring.usdFmv(CHAIN_ID, LISTED_ADDRESS, 400_000_000_000n), null)

  const priceless = new AlchemyPricer('key', fakeFetch({ coinPrice: null }))
  assert.equal(await priceless.usdFmv(CHAIN_ID, LISTED_ADDRESS, 400_000_000_000n), null)

  const zero = new AlchemyPricer('key', fakeFetch({ coinPrice: 0 }))
  assert.equal(await zero.usdFmv(CHAIN_ID, LISTED_ADDRESS, 400_000_000_000n), null)
})

test('a dust amount too small to register one micro-USD parks rather than booking zero', async () => {
  const pricer = new AlchemyPricer('key', fakeFetch({ coinPrice: 0.000025 }))
  assert.equal(await pricer.usdFmv(CHAIN_ID, LISTED_ADDRESS, 1n), null)
})

test('an unpriced deposit of the listed asset is parked, not booked and not credited', async () => {
  const deposita = makeDeposita()
  const deps = makeDeps(deposita, { pricer: new AlchemyPricer('key', fakeFetch({ throws: true })) })

  await processVaultLogs([paymentLog(LISTED_ADDRESS, 400_000_000_000n)], CHAIN_ID, deps)

  assert.equal(deposita.created.length, 1)
  assert.equal(deposita.created[0].status, 'confirmatum')
  assert.equal(deposita.created[0].usdFmv, undefined, 'no basis is frozen onto an unpriced row')
  assert.deepEqual(deps.redituum.rows, [])
  assert.deepEqual(deps.signorum.issued, [])
})

// ── 3. The completion migration's decision core ───────────────────────────────

const PARKED = { transactioHash: TX_HASH, status: 'confirmatum', token: LISTED_ADDRESS }
const SETTLEMENT: LegacyCreditRow = {
  _id: 'legacy-row-1',
  deposit_tx_hash: TX_HASH,
  status: 'CONFIRMED',
  points_credited: 20000,
  gross_deposit_usd: 10,
  adjusted_gross_deposit_usd: 10,
  user_credited_usd: 7,
  funding_rate_applied: 0.7,
}
const AT = new Date('2026-08-27T00:00:00Z')

test('migration: a parked row with a CONFIRMED settlement is completed to the terminal state', () => {
  const decision = decideRecord(PARKED, SETTLEMENT, AT)
  assert.equal(decision.kind, 'record')
  assert.deepEqual(decision.kind === 'record' ? decision.set : null, {
    status: 'praesolutum',
    usdFmv: '10000000',
    praesolutio: {
      ledgerRef: 'legacy-row-1',
      punctaCredita: '20000',
      grossUsdFmv: '10000000',
      adjustedGrossUsdFmv: '10000000',
      creditedUsd: '7000000',
      fundingRate: 0.7,
      recordatum: AT,
    },
  })
})

test('migration: the write is a record, never a balance — no points or signum field is set', () => {
  const decision = decideRecord(PARKED, SETTLEMENT, AT)
  const keys = decision.kind === 'record' ? Object.keys(decision.set) : []
  assert.deepEqual(keys.sort(), ['praesolutio', 'status', 'usdFmv'])
  assert.equal(keys.includes('signumId'), false)
  assert.equal(keys.includes('animaId'), false)
})

test('migration: no settlement found → SKIPPED, never guessed at', () => {
  assert.equal(decideRecord(PARKED, null, AT).kind, 'skip')
})

test('migration: a settlement that is not CONFIRMED is not proof of payment', () => {
  for (const status of ['PENDING', 'FAILED', undefined]) {
    assert.equal(decideRecord(PARKED, { ...SETTLEMENT, status }, AT).kind, 'skip', `status ${String(status)}`)
  }
})

test('migration: an incomplete settlement is skipped — half a record is not a record', () => {
  assert.equal(decideRecord(PARKED, { ...SETTLEMENT, gross_deposit_usd: undefined }, AT).kind, 'skip')
  assert.equal(decideRecord(PARKED, { ...SETTLEMENT, points_credited: undefined }, AT).kind, 'skip')
  assert.equal(decideRecord(PARKED, { ...SETTLEMENT, gross_deposit_usd: 0 }, AT).kind, 'skip')
})

test('migration: an optional pricing field the settlement lacks is stored ABSENT, never invented', () => {
  const decision = decideRecord(PARKED, { ...SETTLEMENT, user_credited_usd: undefined, funding_rate_applied: undefined }, AT)
  assert.equal(decision.kind, 'record')
  const praesolutio = decision.kind === 'record' ? decision.set.praesolutio as Record<string, unknown> : {}
  assert.equal('creditedUsd' in praesolutio, false)
  assert.equal('fundingRate' in praesolutio, false)
})

test('migration: a row that is not parked, or already carries a basis, is left alone', () => {
  for (const status of ['processatum', 'praesolutum', 'fractum', 'detectum']) {
    assert.equal(decideRecord({ ...PARKED, status }, SETTLEMENT, AT).kind, 'skip', status)
  }
  assert.equal(decideRecord({ ...PARKED, usdFmv: '1' }, SETTLEMENT, AT).kind, 'skip')
  assert.equal(decideRecord({ ...PARKED, token: undefined }, SETTLEMENT, AT).kind, 'skip')
})

test('migration: the write set is one collection — a balance collection is refused a handle', () => {
  const db = { collection: (name: string) => ({ name }) as never }
  assert.equal((writable(db, 'deposita') as unknown as { name: string }).name, 'deposita')
  for (const forbidden of ['signa', 'reditus', 'animae', 'credit_ledger']) {
    assert.throws(() => writable(db, forbidden), /refusing a writable handle/, forbidden)
  }
})

test('migration: USD converts to micro-USD decimal-exactly, and rejects anything unusable', () => {
  assert.equal(usdToMicroString(12.5), '12500000')
  assert.equal(usdToMicroString('0.000029'), '29')
  assert.equal(usdToMicroString(0), undefined)
  assert.equal(usdToMicroString(-1), undefined)
  assert.equal(usdToMicroString(undefined), undefined)
  assert.equal(usdToMicroString('not a number'), undefined)
  assert.equal(countToString(20000), '20000')
  assert.equal(countToString(0), '0')
  assert.equal(countToString(-1), undefined)
  assert.equal(countToString(undefined), undefined)
})

test('migration: --expect must be a whole non-negative count, or the run refuses', () => {
  assert.equal(readExpect(['--db', 'x']), undefined)
  assert.equal(readExpect(['--expect', '25']), 25)
  assert.equal(readExpect(['--expect', '0']), 0)
  for (const bad of ['-1', 'many', '2.5', undefined]) {
    assert.throws(() => readExpect(bad === undefined ? ['--expect'] : ['--expect', bad]), /--expect/)
  }
})

test('migration: the candidate assets are exactly the configured coin listings, lowercased', () => {
  const configured = Object.values(COINGECKO_ASSETS).flatMap(m => Object.keys(m))
  assert.deepEqual(coinListedAddresses().sort(), configured.map(a => a.toLowerCase()).sort())
  assert.equal(coinListedAddresses().includes(OTHER_TOKEN), false)
})
