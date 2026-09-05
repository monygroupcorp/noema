import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { AbiCoder } from 'ethers'
import { handleAlchemyWebhook } from '../../../src/api/webhooks/alchemyWebhook.js'
import type { AlchemyWebhookDeps, AlchemyWebhookRequest } from '../../../src/api/webhooks/alchemyWebhook.js'
import { permissiveSanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import type { SanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import { fixedPricer, nullPricer, type AssetPricer } from '../../../src/crystal/AssetPricer.js'
import { makeResolveWalletAnima } from '../../../src/crystal/resolveWalletAnima.js'
import type { PersonaStore } from '../../../src/types/persona.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import type { Depositum, Depositorum, Petitio, Petitionum, Testimonium, Testimoniorum } from '../../../src/types/catena.js'

// Local fake screen — blocks the given addresses (case-insensitive). Keeps this public
// webhook test self-contained; the real Set-backed OFAC screen is private (ADR-0012 §49).
const blockingScreen = (addresses: string[]): SanctionsScreen => {
  const blocked = new Set(addresses.map((a) => a.trim().toLowerCase()))
  return { async screen(a: string) { return blocked.has(a.trim().toLowerCase()) ? { ok: false, reason: `address ${a} is on the OFAC SDN blocklist` } : { ok: true } } }
}
import type { Signum, Signorum } from '../../../src/types/significandi.js'
import type { Anima, AnimaStore } from '../../../src/types/anima.js'
import type { Reditus, ReditusDraft, Redituum } from '../../../src/types/reditus.js'

// ── Constants (same as implementation) ────────────────────────────────────────

const TOPIC_PAYMENT      = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_NFT_RECEIVED = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const TOPIC_ERC1155      = '0x72d4fe4bd1118f3ff78811cc440bf989b6e515157dab466890aaed7c87ffb78c'
const TOPIC_ANON_DEPOSIT = '0x879aadcc0b21da25bde4bcf799cb142a02d0135f66a1328fef12c8b78636c58d'

const VAULT = '0x00000001152d633eb2ac3cf91eac9994aeefC021'.toLowerCase()
const CHAIN_ID = '1'

/**
 * The signing key the default deps configure for `CHAIN_ID`, and the key `makeReq` signs with.
 *
 * The handler admits a request to a served chain only when it carries a valid HMAC over the raw
 * body, so every behavioural case below describes the AUTHENTICATED path: `makeDeps` configures
 * this key and `makeReq` signs with it. A case that wants a different outcome out of the auth
 * block overrides one side or the other — a different key, an explicit bad signature, or no key
 * configured at all.
 */
const SIGNING_KEY = 'alchemy-test-signing-key'

// ── Mock factories ─────────────────────────────────────────────────────────────

let idSeq = 0
function nextId(prefix: string) { return `${prefix}-${++idSeq}` }

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
      if (filter?.animaId) all = all.filter(d => d.animaId === filter.animaId)
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
      const updated = { ...d, ...patch }
      store.set(id, updated)
      return updated
    },
  }
}

function makeSignorum(): Signorum & { issued: Signum[] } {
  const issued: Signum[] = []
  return {
    issued,
    async balance() { return 0n },
    async issue(input) {
      const s: Signum = { ...input, id: nextId('sig'), status: 'valid', natum: new Date() }
      issued.push(s)
      return s
    },
    async lock() {},
    async release() {},
    async history() { return [] },
    async earningTotals() { return [] },
    async listEarnings() { return { entries: [] } },
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
      if (!draft.fmvSource || draft.fmvSource.trim() === '') throw new Error('Reditus fail-closed: fmvSource')
      if (draft.depositumId !== undefined) {
        const existing = rows.find(r => r.depositumId === draft.depositumId)
        if (existing) return existing   // idempotent, mirrors MemoryRedituum
      }
      const r = { id: nextId('red'), natum: draft.natum ?? new Date(), usdFmv: draft.usdFmv, fmvSource: draft.fmvSource, origo: draft.origo, ...(draft.depositumId !== undefined ? { depositumId: draft.depositumId } : {}) }
      rows.push(r)
      return r
    },
    async trailingUsdRevenue() { return rows.reduce((s, r) => s + r.usdFmv, 0n) },
    async findByChargeRef() { throw new Error('not implemented') },
    async reverse() { throw new Error('not implemented') },
  }
}

function makePetitiones(initial?: Petitio): Petitionum {
  const store = new Map<string, Petitio>()
  if (initial) store.set(initial.id, initial)

  return {
    async find(id) { return store.get(id) ?? null },
    async findExpectans(animaId) {
      for (const p of store.values()) {
        if (p.animaId === animaId && p.status === 'expectans') return p
      }
      return null
    },
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
    async findByPossessor(possessor, contractus) {
      return store.find(t => t.possessor === possessor && t.contractus === contractus) ?? null
    },
    async listByAnima(animaId) { return store.filter(t => t.animaId === animaId) },
    async create(input) {
      const t: Testimonium = { ...input, id: nextId('tes'), natum: new Date() }
      store.push(t)
      return t
    },
    async update(id, patch) {
      const t = store.find(t => t.id === id)
      if (!t) throw new Error(`Testimonium ${id} not found`)
      Object.assign(t, patch)
      return t
    },
  }
}

function makeAnimae(byWallet?: Map<string, Anima>): AnimaStore {
  const walletMap = byWallet ?? new Map()
  const idMap = new Map<string, Anima>()
  for (const a of walletMap.values()) idMap.set(a.id, a)
  return {
    async create(input) {
      const a: Anima = { ...input, id: nextId('ani'), natum: new Date(), mutatum: new Date() }
      idMap.set(a.id, a)
      if (a.custos) walletMap.set(a.custos.toLowerCase(), a)
      return a
    },
    async find(id) { return idMap.get(id) ?? null },
    async findByCustos(custos) { return walletMap.get(custos.toLowerCase()) ?? null },
    async update(id, patch) {
      const a = idMap.get(id)
      if (!a) throw new Error(`Anima ${id} not found`)
      Object.assign(a, patch, { mutatum: new Date() })
      return a
    },
  }
}

function makeArcanumTree() {
  const leaves = new Map<string, bigint>()
  return {
    leaves,
    async insert(commitment: string, valor: bigint) {
      leaves.set(commitment, valor)
      return { leafIndex: leaves.size - 1, proof: { pathElements: [], pathIndices: [], root: '0x0' } as never }
    },
    async getProof() { throw new Error('not used') },
    async getRoot() { return '0x0' },
    async findLeaf(commitment: string) {
      return leaves.has(commitment) ? ({ commitment, valor: leaves.get(commitment)! } as never) : null
    },
    async size() { return leaves.size },
  }
}

function makeAnima(custos: string): Anima {
  return {
    id: nextId('ani'),
    nomen: 'Test User',
    custos: custos.toLowerCase(),
    natum: new Date(),
    mutatum: new Date(),
  }
}

// ── ABI encoding helpers ───────────────────────────────────────────────────────

const coder = AbiCoder.defaultAbiCoder()

/** Encode a Payment event data field (non-indexed params) */
function encodePaymentData(token: string, amount: bigint, protocolAmount: bigint, referralAmount: bigint): string {
  return coder.encode(['address', 'uint256', 'uint256', 'uint256'], [token, amount, protocolAmount, referralAmount])
}

/** Encode a topic slot (address padded to 32 bytes) */
function encodeTopic(addr: string): string {
  // zero-pad address to 32 bytes
  const clean = addr.toLowerCase().replace('0x', '').padStart(64, '0')
  return '0x' + clean
}

/** Encode an NFT data field (address token, uint256 tokenId) */
function encodeNftData(token: string, tokenId: bigint): string {
  return coder.encode(['address', 'uint256'], [token, tokenId])
}

// ── Fixture builders ───────────────────────────────────────────────────────────

const PAYER   = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
const TOKEN   = '0x0000000000000000000000000000000000000000'  // ETH (zero addr)
const AMOUNT  = 1_000_000_000_000_000n  // 0.001 ETH in wei

function makePaymentLog(overrides: {
  address?: string
  payer?: string
  amount?: bigint
  txHash?: string
} = {}) {
  const addr = (overrides.address ?? VAULT)
  const payer = (overrides.payer ?? PAYER).toLowerCase()
  const amount = overrides.amount ?? AMOUNT
  return {
    account: { address: addr },
    topics: [
      TOPIC_PAYMENT,
      encodeTopic(payer),
      encodeTopic('0x0000000000000000000000000000000000000000'),  // referralKey bytes32
    ],
    data: encodePaymentData(TOKEN, amount, 0n, 0n),
    transaction: { hash: overrides.txHash ?? TX_HASH },
  }
}

function makeNftLog(overrides: {
  operator?: string
  from?: string
  token?: string
  tokenId?: bigint
} = {}) {
  const operator = (overrides.operator ?? '0x1111111111111111111111111111111111111111').toLowerCase()
  const from = (overrides.from ?? PAYER).toLowerCase()
  const token = overrides.token ?? '0x2222222222222222222222222222222222222222'
  const tokenId = overrides.tokenId ?? 42n
  return {
    account: { address: VAULT },
    topics: [
      TOPIC_NFT_RECEIVED,
      encodeTopic(operator),
      encodeTopic(from),
    ],
    data: encodeNftData(token, tokenId),
    transaction: { hash: TX_HASH },
  }
}

const COMMITMENT = '0x' + '11'.repeat(32)  // bytes32 Poseidon commitment

// from: string → that sender; from: null → no tx.from at all (query didn't select it)
function makeAnonDepositLog(overrides: { from?: string | null; commitment?: string; amount?: bigint } = {}) {
  const from = overrides.from === undefined ? PAYER : overrides.from
  return {
    account: { address: VAULT },
    topics: [TOPIC_ANON_DEPOSIT, overrides.commitment ?? COMMITMENT],
    data: coder.encode(['address', 'uint256'], [TOKEN, overrides.amount ?? AMOUNT]),
    transaction: from === null ? { hash: TX_HASH } : { hash: TX_HASH, from },
  }
}

function makeErc1155Log() {
  return {
    account: { address: VAULT },
    topics: [TOPIC_ERC1155],
    data: '0x',
    transaction: { hash: TX_HASH },
  }
}

function makeWebhookBody(logs: unknown[]) {
  return {
    webhookId: 'wh_test',
    id: 'evt_test',
    createdAt: new Date().toISOString(),
    type: 'GRAPHQL',
    event: {
      data: {
        block: {
          number: 99999,
          logs,
        },
      },
    },
  }
}

/**
 * Build a request that is SIGNED by default with `SIGNING_KEY` — the key the default deps
 * configure — so a case exercises the processing paths behind the auth block rather than a
 * skipped check. Pass `signature` explicitly to describe a specific auth outcome; a case that
 * needs an unsigned request builds the object literally, so its intent is visible at the call.
 */
function makeReq(body: unknown, chainId = CHAIN_ID, signature?: string): AlchemyWebhookRequest {
  const rawBody = JSON.stringify(body)
  return { body, rawBody, chainId, signature: signature ?? sign(SIGNING_KEY, rawBody) }
}

function sign(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

// No web personae in these fakes — the resolver falls back to the legacy custos seam (`makeAnimae`),
// which is how every case here binds a wallet to an anima. The Persona-first path is covered by the
// hermetic depositAttribution suite + the Mongo depositSweepConcurrent suite.
const emptyPersonae: Pick<PersonaStore, 'findByExternus'> = { async findByExternus() { return null } }

function makeDeps(overrides: Partial<AlchemyWebhookDeps> & { animae?: AnimaStore } = {}): AlchemyWebhookDeps & {
  deposita: ReturnType<typeof makeDeposita>
  signorum: ReturnType<typeof makeSignorum>
  testimonia: ReturnType<typeof makeTestimonia>
  redituum: ReturnType<typeof makeRedituum>
} {
  const deposita = overrides.deposita as ReturnType<typeof makeDeposita> ?? makeDeposita()
  const signorum = overrides.signorum as ReturnType<typeof makeSignorum> ?? makeSignorum()
  const testimonia = overrides.testimonia as ReturnType<typeof makeTestimonia> ?? makeTestimonia()
  const redituum = overrides.redituum as ReturnType<typeof makeRedituum> ?? makeRedituum()
  const resolveWalletAnima = overrides.resolveWalletAnima
    ?? makeResolveWalletAnima({ personae: emptyPersonae, animae: overrides.animae ?? makeAnimae() })
  return {
    deposita,
    signorum,
    redituum,
    petitiones: overrides.petitiones ?? makePetitiones(),
    testimonia,
    resolveWalletAnima,
    arcanumTree: overrides.arcanumTree ?? makeArcanumTree(),
    sanctions: overrides.sanctions ?? permissiveSanctionsScreen,
    signingKeys: overrides.signingKeys ?? { [CHAIN_ID]: SIGNING_KEY },
    vaultAddresses: overrides.vaultAddresses ?? { [CHAIN_ID]: VAULT },
    // Default pricer: $3000/ETH at 18 decimals → 0.001 ETH = $3 gross.
    pricer: overrides.pricer ?? fixedPricer(3000, 18),
  }
}

// 0.001 ETH @ $3000 = $3 gross = 3_000_000 micro-USD (revenue). Credit is NET: × 0.70 default
// funding = $2.10 = 2_100_000 µUSD ÷ 337 µUSD/impetus = 6231 impetus.
const EXPECTED_GROSS_USD_FMV = 3_000_000n
const EXPECTED_CREDIT_IMPETUS = 6231n

// ── Tests ──────────────────────────────────────────────────────────────────────

// 1. Valid payment log, anima found → creates Depositum, issues Signum, marks processatum
test('payment log with known anima: creates Depositum, issues Signum, marks processatum', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deps = makeDeps({ animae })

  const body = makeWebhookBody([makePaymentLog()])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.processed, 1)
  assert.equal(result.body.skipped, 0)

  // Depositum created
  const deposita = [...deps.deposita.store.values()]
  assert.equal(deposita.length, 1)
  assert.equal(deposita[0].status, 'processatum')
  assert.equal(deposita[0].ab, PAYER.toLowerCase())
  assert.equal(deposita[0].animaId, anima.id)

  // Signum issued — valor is NET impetus credits (after 0.70 funding), NOT the raw wei amount
  assert.equal(deps.signorum.issued.length, 1)
  assert.equal(deps.signorum.issued[0].forma, 'eth')
  assert.equal(deps.signorum.issued[0].animaId, anima.id)
  assert.equal(deps.signorum.issued[0].valor, EXPECTED_CREDIT_IMPETUS)

  // signumId linked back to depositum
  assert.equal(deposita[0].signumId, deps.signorum.issued[0].id)
})

// 2. Payment log, no anima found → creates Depositum in confirmatum, no Signum
test('payment log with unknown wallet: creates Depositum in confirmatum, no Signum issued', async () => {
  const deps = makeDeps()  // no animae

  const body = makeWebhookBody([makePaymentLog()])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 1)

  const deposita = [...deps.deposita.store.values()]
  assert.equal(deposita.length, 1)
  assert.equal(deposita[0].status, 'confirmatum')
  assert.equal(deposita[0].animaId, undefined)

  assert.equal(deps.signorum.issued.length, 0)
})

// 3. Idempotency: already processatum → skipped, no duplicate Signum
test('payment log already processatum: skipped, no duplicate Signum', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deposita = makeDeposita()

  // Pre-seed a processatum depositum for same txHash
  await deposita.create({
    chainId: CHAIN_ID,
    transactioHash: TX_HASH,
    ab: PAYER.toLowerCase(),
    ad: VAULT,
    valor: AMOUNT,
    confirmationes: 1,
    status: 'processatum',
    animaId: anima.id,
    signumId: 'sig-pre-existing',
  })

  const deps = makeDeps({ deposita, animae })
  const body = makeWebhookBody([makePaymentLog()])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(result.body.skipped, 1)
  assert.equal(deps.signorum.issued.length, 0)
})

// 4. Invalid HMAC → returns 401
test('invalid HMAC signature returns 401', async () => {
  const deps = makeDeps({ signingKeys: { [CHAIN_ID]: 'my-secret' } })
  const body = makeWebhookBody([])
  const result = await handleAlchemyWebhook(makeReq(body, CHAIN_ID, 'bad-signature'), deps)

  assert.equal(result.status, 401)
  assert.equal(result.body.success, false)
  assert.match(result.body.message ?? '', /invalid signature/i)
})

// 5. Served chain with no signing key configured → fail closed (403), nothing written.
// The served-chain gate has already admitted this chainId, so the request is one the deployment
// is wired for; the absent key is a refusal, not an exemption. The payload carries a well-formed
// payment log AND an anonymous-deposit log, both addressed to the vault, so the assertions below
// see anything the processing paths would have written had the request been admitted.
test('no signing key configured for a served chain: refused 403, nothing written', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const arcanumTree = makeArcanumTree()
  const deps = makeDeps({ animae, arcanumTree, signingKeys: {} })

  const body = makeWebhookBody([makePaymentLog(), makeAnonDepositLog({ from: PAYER })])
  const rawBody = JSON.stringify(body)
  const result = await handleAlchemyWebhook({ body, rawBody, chainId: CHAIN_ID }, deps)

  assert.equal(result.status, 403)
  assert.equal(result.body.success, false)
  assert.equal(result.body.processed, 0)
  assert.equal([...deps.deposita.store.values()].length, 0, 'no Depositum may be written')
  assert.equal(deps.signorum.issued.length, 0, 'no Signum may be issued')
  assert.equal(deps.redituum.rows.length, 0, 'no revenue may be booked')
  assert.equal(arcanumTree.leaves.size, 0, 'no arcanum leaf may be inserted')
})

// 6. Malformed payload (missing logs) → returns 400
test('malformed payload returns 400', async () => {
  const deps = makeDeps()
  const badBody = { type: 'GRAPHQL', event: { data: { block: {} } } }  // no logs
  const result = await handleAlchemyWebhook(makeReq(badBody), deps)

  assert.equal(result.status, 400)
  assert.equal(result.body.success, false)
})

// 6b. wrong type → 400
test('non-GRAPHQL type returns 400', async () => {
  const deps = makeDeps()
  const badBody = { type: 'ADDRESS_ACTIVITY', event: {} }
  const result = await handleAlchemyWebhook(makeReq(badBody), deps)

  assert.equal(result.status, 400)
  assert.equal(result.body.success, false)
})

// 7. Log address doesn't match vault → skipped
test('log from wrong address is skipped', async () => {
  const deps = makeDeps()
  const body = makeWebhookBody([makePaymentLog({ address: '0x9999999999999999999999999999999999999999' })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(result.body.skipped, 1)
  assert.equal([...deps.deposita.store.values()].length, 0)
})

// 8. NFT deposit, anima found → creates Testimonium
test('NFT log with known anima: creates Testimonium', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const testimonia = makeTestimonia()
  const deps = makeDeps({ animae, testimonia })

  const nftToken = '0x2222222222222222222222222222222222222222'
  const tokenId = 42n
  const body = makeWebhookBody([makeNftLog({ from: PAYER, token: nftToken, tokenId })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 1)

  assert.equal(testimonia.store.length, 1)
  assert.equal(testimonia.store[0].animaId, anima.id)
  assert.equal(testimonia.store[0].contractus, nftToken)
  assert.equal(testimonia.store[0].tokenId, tokenId.toString())
  assert.equal(testimonia.store[0].possessor, PAYER.toLowerCase())
  assert.equal(testimonia.store[0].genus, 'balanceOf')
  assert.equal(testimonia.store[0].status, 'confirmatum')
})

// 9. NFT deposit, no anima → no Testimonium created, no error
test('NFT log with unknown wallet: no Testimonium created, no error', async () => {
  const deps = makeDeps()
  const body = makeWebhookBody([makeNftLog()])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(result.body.skipped, 1)
  assert.equal(deps.testimonia.store.length, 0)
})

// 10. Magic-amount match: payment amount equals petitio.valuta → petitio confirmed
test('magic-amount match: petitio confirmed and walletAddress set', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))

  const petitio: Petitio = {
    id: 'pet-magic-1',
    animaId: anima.id,
    chainId: CHAIN_ID,
    valuta: AMOUNT,
    ad: VAULT,
    status: 'expectans',
    natum: new Date(),
    expirat: new Date(Date.now() + 3_600_000),
  }
  const petitiones = makePetitiones(petitio)
  const deps = makeDeps({ animae, petitiones })

  const body = makeWebhookBody([makePaymentLog({ amount: AMOUNT })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 1)

  const updated = await petitiones.find(petitio.id)
  assert.equal(updated?.status, 'confirmata')
  assert.equal(updated?.walletAddress, PAYER.toLowerCase())
  assert.ok(updated?.depositumId)
})

// 11. Magic-amount no match: payment amount differs → petitio unchanged
test('magic-amount no match: petitio status unchanged', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))

  const petitio: Petitio = {
    id: 'pet-magic-2',
    animaId: anima.id,
    chainId: CHAIN_ID,
    valuta: AMOUNT + 1n,  // different amount
    ad: VAULT,
    status: 'expectans',
    natum: new Date(),
    expirat: new Date(Date.now() + 3_600_000),
  }
  const petitiones = makePetitiones(petitio)
  const deps = makeDeps({ animae, petitiones })

  const body = makeWebhookBody([makePaymentLog({ amount: AMOUNT })])
  await handleAlchemyWebhook(makeReq(body), deps)

  const unchanged = await petitiones.find(petitio.id)
  assert.equal(unchanged?.status, 'expectans')
  assert.equal(unchanged?.walletAddress, undefined)
})

// 12. ERC1155 log → processed=0, skipped=1
test('ERC1155 log: skipped, no side effects', async () => {
  const deps = makeDeps()
  const body = makeWebhookBody([makeErc1155Log()])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(result.body.skipped, 1)
})

// 13. Valid HMAC → accepted and processed
test('valid HMAC signature is accepted and request processed', async () => {
  const secret = 'alchemy-secret-42'
  const deps = makeDeps({ signingKeys: { [CHAIN_ID]: secret } })
  const body = makeWebhookBody([makePaymentLog()])
  const rawBody = JSON.stringify(body)
  const signature = sign(secret, rawBody)
  const result = await handleAlchemyWebhook({ body, rawBody, chainId: CHAIN_ID, signature }, deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
})

// 14. Multiple logs in one block — mix of payment + NFT
test('multiple logs in block processed independently', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const testimonia = makeTestimonia()
  const deps = makeDeps({ animae, testimonia })

  const paymentLog = makePaymentLog({ txHash: '0x' + 'aa'.repeat(32) })
  const nftLog = makeNftLog({ from: PAYER })
  const body = makeWebhookBody([paymentLog, nftLog])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 2)
  assert.equal(result.body.skipped, 0)
  assert.equal([...deps.deposita.store.values()].length, 1)
  assert.equal(deps.signorum.issued.length, 1)
  assert.equal(testimonia.store.length, 1)
})

// ── OFAC sanctions screening ─────────────────────────────────────────────────

const SANCTIONED = '0x5555555555555555555555555555555555555555'

// 16. Blocked payer → Depositum quarantined (fractum), NO Signum, even with known anima
test('OFAC: blocked payer is quarantined (fractum), no Signum issued', async () => {
  const anima = makeAnima(SANCTIONED)
  const animae = makeAnimae(new Map([[SANCTIONED.toLowerCase(), anima]]))
  const deps = makeDeps({ animae, sanctions: blockingScreen([SANCTIONED]) })

  const body = makeWebhookBody([makePaymentLog({ payer: SANCTIONED })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 1)  // processed-as-quarantined

  const deposita = [...deps.deposita.store.values()]
  assert.equal(deposita.length, 1)
  assert.equal(deposita[0].status, 'fractum')
  assert.equal(deposita[0].ab, SANCTIONED.toLowerCase())
  assert.equal(deps.signorum.issued.length, 0)  // critically: no credit extended
})

// 17. Non-blocked payer still flows normally under an active blocklist
test('OFAC: clean payer flows normally under an active blocklist', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deps = makeDeps({ animae, sanctions: blockingScreen([SANCTIONED]) })

  const body = makeWebhookBody([makePaymentLog({ payer: PAYER })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal([...deps.deposita.store.values()][0].status, 'processatum')
  assert.equal(deps.signorum.issued.length, 1)
})

// 18. Blocked anonymous-deposit funder → leaf NOT inserted
test('OFAC: blocked anonymous deposit funder is refused (no leaf)', async () => {
  const arcanumTree = makeArcanumTree()
  const deps = makeDeps({ arcanumTree, sanctions: blockingScreen([SANCTIONED]) })

  const body = makeWebhookBody([makeAnonDepositLog({ from: SANCTIONED })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(arcanumTree.leaves.size, 0)
})

// 19. Anonymous deposit with no tx.from → fail-CLOSED (no leaf), even with empty blocklist
test('OFAC: anonymous deposit missing tx.from fails closed (no leaf)', async () => {
  const arcanumTree = makeArcanumTree()
  const deps = makeDeps({ arcanumTree, sanctions: blockingScreen([]) })

  const body = makeWebhookBody([makeAnonDepositLog({ from: null })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(arcanumTree.leaves.size, 0)  // refused: unscreenable
})

// 20. Clean anonymous deposit funder → leaf inserted
test('OFAC: clean anonymous deposit funder is admitted (leaf inserted)', async () => {
  const arcanumTree = makeArcanumTree()
  const deps = makeDeps({ arcanumTree, sanctions: blockingScreen([SANCTIONED]) })

  const body = makeWebhookBody([makeAnonDepositLog({ from: PAYER })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 1)
  assert.equal(arcanumTree.leaves.size, 1)
  assert.equal(arcanumTree.leaves.get(COMMITMENT), EXPECTED_CREDIT_IMPETUS)
})

// 20a. The blind path values a deposit exactly as the identified path does. `ArcanumLeaf.valor`
// is impetus points and is hashed into the leaf, so the spend proof certifies whatever is written
// here — a leaf carrying the raw wei amount would redeem for its wei count.
test('anonymous deposit writes its leaf in impetus, at the same rate as the identified path', async () => {
  const arcanumTree = makeArcanumTree()
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deps = makeDeps({ arcanumTree, animae })

  // Same asset, same amount, one delivery carrying both an identified and a blind deposit.
  const body = makeWebhookBody([makePaymentLog({ payer: PAYER }), makeAnonDepositLog({ from: PAYER })])
  await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(deps.signorum.issued[0].valor, EXPECTED_CREDIT_IMPETUS)
  assert.equal(arcanumTree.leaves.get(COMMITMENT), EXPECTED_CREDIT_IMPETUS)
  assert.notEqual(arcanumTree.leaves.get(COMMITMENT), AMOUNT)  // not the raw wei amount
})

// 20b. Unpriceable asset → no leaf. The valor is fixed at insert and never revisited, so a note
// whose value we cannot determine must not enter the tree. Nothing is written, so a redelivery
// re-attempts cleanly once the oracle is back.
test('anonymous deposit that cannot be priced admits no leaf and books no revenue', async () => {
  const arcanumTree = makeArcanumTree()
  const deps = makeDeps({ arcanumTree, pricer: nullPricer })

  const result = await handleAlchemyWebhook(makeReq(makeWebhookBody([makeAnonDepositLog({ from: PAYER })])), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(arcanumTree.leaves.size, 0)
  assert.equal(deps.redituum.rows.length, 0)
})

// 20c. Sub-impetus dust → no leaf. A valor-0 leaf is unspendable (the verifier requires
// valor > 0) and would make the redelivery guard swallow the deposit permanently.
test('anonymous deposit below one impetus admits no leaf', async () => {
  const arcanumTree = makeArcanumTree()
  // $3000/ETH: 1000 wei is $3e-12 — far below one impetus ($0.000337).
  const deps = makeDeps({ arcanumTree })

  const result = await handleAlchemyWebhook(makeReq(makeWebhookBody([makeAnonDepositLog({ from: PAYER, amount: 1_000n })])), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(arcanumTree.leaves.size, 0)
})

// 21. Blocked NFT sender → no Testimonium
test('OFAC: blocked NFT sender creates no Testimonium', async () => {
  const anima = makeAnima(SANCTIONED)
  const animae = makeAnimae(new Map([[SANCTIONED.toLowerCase(), anima]]))
  const testimonia = makeTestimonia()
  const deps = makeDeps({ animae, testimonia, sanctions: blockingScreen([SANCTIONED]) })

  const body = makeWebhookBody([makeNftLog({ from: SANCTIONED })])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(testimonia.store.length, 0)
})

// ── USD revenue booking + buy-points conversion (ADR-0013 §2/§4/§7) ───────────

// 22. Known-anima deposit books GROSS revenue + credits NET impetus, linked to the Depositum
test('revenue+credit: known-anima deposit books gross FMV and credits net impetus', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deps = makeDeps({ animae })

  await handleAlchemyWebhook(makeReq(makeWebhookBody([makePaymentLog()])), deps)

  // revenue = GROSS FMV
  assert.equal(deps.redituum.rows.length, 1)
  assert.equal(deps.redituum.rows[0].usdFmv, EXPECTED_GROSS_USD_FMV)
  assert.equal(deps.redituum.rows[0].origo, 'crypto')
  const depositum = [...deps.deposita.store.values()][0]
  assert.equal(deps.redituum.rows[0].depositumId, depositum.id)
  // credit = NET impetus (gross − funding haircut), NOT gross and NOT raw wei
  assert.equal(deps.signorum.issued[0].valor, EXPECTED_CREDIT_IMPETUS)
})

// 23. Revenue is recognized at RECEIPT — booked even when no Anima is linked yet (§4)
test('revenue: unknown-wallet deposit still books revenue (recognized at receipt, before linkage)', async () => {
  const deps = makeDeps()  // no animae → deposit stays confirmatum, no Signum
  await handleAlchemyWebhook(makeReq(makeWebhookBody([makePaymentLog()])), deps)

  assert.equal(deps.signorum.issued.length, 0)          // not credited yet
  assert.equal(deps.redituum.rows.length, 1)            // but revenue IS recognized
  assert.equal(deps.redituum.rows[0].usdFmv, EXPECTED_GROSS_USD_FMV)
})

// 24. OFAC-quarantined (fractum) deposit books NO revenue — no value recognized on refused funds
test('revenue: OFAC-blocked deposit books no revenue', async () => {
  const anima = makeAnima(SANCTIONED)
  const animae = makeAnimae(new Map([[SANCTIONED.toLowerCase(), anima]]))
  const deps = makeDeps({ animae, sanctions: blockingScreen([SANCTIONED]) })

  await handleAlchemyWebhook(makeReq(makeWebhookBody([makePaymentLog({ payer: SANCTIONED })])), deps)

  assert.equal([...deps.deposita.store.values()][0].status, 'fractum')
  assert.equal(deps.redituum.rows.length, 0)
})

// 25. Re-delivery of an uncredited (confirmatum) deposit: no duplicate Depositum, no double revenue
test('revenue: webhook re-delivery does not duplicate the Depositum or double-count revenue', async () => {
  const deps = makeDeps()  // unknown wallet → confirmatum, uncredited
  const body = makeWebhookBody([makePaymentLog()])

  await handleAlchemyWebhook(makeReq(body), deps)
  await handleAlchemyWebhook(makeReq(body), deps)   // Alchemy re-delivers the same block

  assert.equal([...deps.deposita.store.values()].length, 1)   // reused, not duplicated
  assert.equal(deps.redituum.rows.length, 1)                  // idempotent on depositumId
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS_USD_FMV)
})

// 26. Unpriceable deposit (no oracle): NOT credited and NOT booked — parked confirmatum, loud (no silent zero)
test('revenue+credit: an unpriceable deposit is parked (no credit, no revenue), not credited at zero', async () => {
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deps = makeDeps({ animae, pricer: nullPricer })

  const result = await handleAlchemyWebhook(makeReq(makeWebhookBody([makePaymentLog()])), deps)

  assert.equal(result.body.processed, 1)
  assert.equal(deps.signorum.issued.length, 0)          // NOT credited — cannot value it
  assert.equal([...deps.deposita.store.values()][0].status, 'confirmatum')  // parked for retry
  assert.equal(deps.redituum.rows.length, 0)            // no revenue booked (loud, not a silent $0)
})

// 27. Anonymous deposit books revenue in aggregate (§7), with no depositumId
test('revenue: clean anonymous deposit books revenue with no identity (§7)', async () => {
  const arcanumTree = makeArcanumTree()
  const deps = makeDeps({ arcanumTree })

  await handleAlchemyWebhook(makeReq(makeWebhookBody([makeAnonDepositLog({ from: PAYER })])), deps)

  assert.equal(arcanumTree.leaves.size, 1)
  assert.equal(deps.redituum.rows.length, 1)
  assert.equal(deps.redituum.rows[0].usdFmv, EXPECTED_GROSS_USD_FMV)
  assert.equal(deps.redituum.rows[0].depositumId, undefined)   // anon: no Depositum
})

// 28. Per-asset funding override: a favored asset converts at PAR (1.0) — gross == net credit rate
test('credit: a favored asset (funding override = 1.0) credits the full FMV, not the 0.7 haircut', async () => {
  const FAVORED = '0x524cab2ec69124574082676e6f654a18df49a048'  // MiladyStation — override 10000 bps
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  // Price this token at $3000/unit, 18 decimals, same amount → $3 gross; par funding → 3_000_000/337.
  const deps = makeDeps({ animae, pricer: fixedPricer(3000, 18) })

  const log = { ...makePaymentLog(), data: encodePaymentData(FAVORED, AMOUNT, 0n, 0n) }
  await handleAlchemyWebhook(makeReq(makeWebhookBody([log])), deps)

  assert.equal(deps.redituum.rows[0].usdFmv, 3_000_000n)          // gross unchanged
  assert.equal(deps.signorum.issued[0].valor, 3_000_000n / 337n)  // 8902 — full value, no 0.7 haircut
})

// 29. LOAD-BEARING: a deposit quote agrees with what the webhook actually credits (same pricer).
test('quote == credit: depositQuote.pointsQuoted equals the webhook-credited impetus for the same input', async () => {
  const pricer = fixedPricer(3000, 18)
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))
  const deps = makeDeps({ animae, pricer })

  // What the webhook actually credits:
  await handleAlchemyWebhook(makeReq(makeWebhookBody([makePaymentLog()])), deps)
  const credited = deps.signorum.issued[0].valor.toString()

  // What the quote endpoint promises for the same {chainId, token, amount}, via the SAME pricer:
  const api = new CrystalApi({ pricer, depositAddress: VAULT } as unknown as CrystalApiDeps)
  const q = await api.depositQuote({ chainId: CHAIN_ID, token: TOKEN, amount: AMOUNT.toString() })

  assert.equal(q.pointsQuoted, credited)   // if these ever diverge, users get a different number than promised
  assert.equal(q.pointsQuoted, '6231')
})

// 30. VALUE CONSERVATION (review finding, webhook retry path): the create-succeeded-but-book-failed
// row must, on Alchemy re-delivery at a DRIFTED spot price, book revenue from the SAME persisted
// receipt basis the credit uses — never re-priced at spot. AssetPricer prices at SPOT, so if the
// webhook booked from the fresh price it would recognize revenue at the retry-window spot (X2) while
// the credit mints impetus from the persisted receipt FMV (X1): recognized USD diverging from the
// credit basis by the drift. Mirrors the sweep's re-book (which books from depositum.usdFmv).
test('revenue+credit: book-failed row re-delivered at a drifted spot books from the receipt basis, matching the credit', async () => {
  // Payer IS linked → the retry credits. Depositum is created BEFORE bookRevenue (no transaction),
  // so a transient redituum failure on the first delivery leaves a priced Depositum with no Reditus.
  const anima = makeAnima(PAYER)
  const animae = makeAnimae(new Map([[PAYER.toLowerCase(), anima]]))

  // Spot drifts UP over the retry window: receipt-time $3000/ETH, retry-time $4000/ETH.
  let priceCalls = 0
  const receiptP = fixedPricer(3000, 18)
  const retryP = fixedPricer(4000, 18)
  const driftPricer: AssetPricer = {
    async usdFmv(chainId, token, amountRaw) {
      priceCalls += 1
      return (priceCalls === 1 ? receiptP : retryP).usdFmv(chainId, token, amountRaw)
    },
  }

  // Redituum store fails transiently on the FIRST record() call (the book-failed row), then heals.
  const redituum = makeRedituum()
  const realRecord = redituum.record
  let recordCalls = 0
  redituum.record = async (draft) => {
    recordCalls += 1
    if (recordCalls === 1) throw new Error('redituum store transient failure')
    return realRecord(draft)
  }

  const deps = makeDeps({ animae, pricer: driftPricer, redituum })
  const body = makeWebhookBody([makePaymentLog()])

  // Delivery 1: Depositum created at receipt FMV ($3), bookRevenue throws → 500. Priced row, no Reditus.
  const first = await handleAlchemyWebhook(makeReq(body), deps)
  assert.equal(first.status, 500)
  const parked = [...deps.deposita.store.values()]
  assert.equal(parked.length, 1)
  assert.equal(parked[0].status, 'confirmatum')
  assert.equal(parked[0].usdFmv, 3_000_000n)   // receipt basis frozen on the row
  assert.equal(deps.redituum.rows.length, 0)   // book failed — no revenue row yet
  assert.equal(deps.signorum.issued.length, 0) // not credited (book runs before credit)

  // Delivery 2: Alchemy retries at the drifted spot ($4). Books + credits.
  const second = await handleAlchemyWebhook(makeReq(body), deps)
  assert.equal(second.status, 200)

  // The invariant: recognized revenue == the credit basis, BOTH the receipt FMV ($3) — NOT the
  // drifted spot ($4). Old code booked 4_000_000n here while crediting from 3_000_000n.
  assert.equal([...deps.deposita.store.values()].length, 1)  // reused the parked row
  assert.equal(deps.redituum.rows.length, 1)
  assert.equal(deps.redituum.rows[0].usdFmv, EXPECTED_GROSS_USD_FMV)  // 3_000_000n — receipt, not spot
  assert.equal(deps.signorum.issued.length, 1)
  assert.equal(deps.signorum.issued[0].valor, EXPECTED_CREDIT_IMPETUS)  // credit from the same $3 basis
})

// 15. Throws internally → returns 500
test('internal error returns 500', async () => {
  const deposita = makeDeposita()
  deposita.create = async () => { throw new Error('DB exploded') }
  const deps = makeDeps({ deposita })

  const body = makeWebhookBody([makePaymentLog()])
  const result = await handleAlchemyWebhook(makeReq(body), deps)

  assert.equal(result.status, 500)
  assert.equal(result.body.success, false)
  assert.match(result.body.message ?? '', /DB exploded/)
})
