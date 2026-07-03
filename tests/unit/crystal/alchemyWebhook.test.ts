import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { AbiCoder } from 'ethers'
import { handleAlchemyWebhook } from '../../../src/api/webhooks/alchemyWebhook.js'
import type { AlchemyWebhookDeps, AlchemyWebhookRequest } from '../../../src/api/webhooks/alchemyWebhook.js'
import { permissiveSanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import type { SanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import { fixedPricer, nullPricer, type AssetPricer } from '../../../src/crystal/AssetPricer.js'
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

// ── Constants (same as implementation) ────────────────────────────────────────

const TOPIC_PAYMENT      = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_NFT_RECEIVED = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const TOPIC_ERC1155      = '0x72d4fe4bd1118f3ff78811cc440bf989b6e515157dab466890aaed7c87ffb78c'
const TOPIC_ANON_DEPOSIT = '0x879aadcc0b21da25bde4bcf799cb142a02d0135f66a1328fef12c8b78636c58d'

const VAULT = '0x00000001152d633eb2ac3cf91eac9994aeefC021'.toLowerCase()
const CHAIN_ID = '1'

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
    async settle() {},
  }
}

function makeRedituum() {
  const rows: import('../../../src/types/reditus.js').Reditus[] = []
  return {
    rows,
    async record(draft: import('../../../src/types/reditus.js').ReditusDraft) {
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
    affines: {},
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

function makeReq(body: unknown, chainId = CHAIN_ID, signature?: string): AlchemyWebhookRequest {
  const rawBody = JSON.stringify(body)
  return { body, rawBody, chainId, signature }
}

function sign(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

function makeDeps(overrides: Partial<AlchemyWebhookDeps> = {}): AlchemyWebhookDeps & {
  deposita: ReturnType<typeof makeDeposita>
  signorum: ReturnType<typeof makeSignorum>
  testimonia: ReturnType<typeof makeTestimonia>
  redituum: ReturnType<typeof makeRedituum>
} {
  const deposita = overrides.deposita as ReturnType<typeof makeDeposita> ?? makeDeposita()
  const signorum = overrides.signorum as ReturnType<typeof makeSignorum> ?? makeSignorum()
  const testimonia = overrides.testimonia as ReturnType<typeof makeTestimonia> ?? makeTestimonia()
  const redituum = overrides.redituum as ReturnType<typeof makeRedituum> ?? makeRedituum()
  return {
    deposita,
    signorum,
    redituum,
    petitiones: overrides.petitiones ?? makePetitiones(),
    testimonia,
    animae: overrides.animae ?? makeAnimae(),
    arcanumTree: overrides.arcanumTree ?? makeArcanumTree(),
    sanctions: overrides.sanctions ?? permissiveSanctionsScreen,
    signingKeys: overrides.signingKeys ?? {},
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

// 5. No signing key configured → skips validation (dev mode)
test('no signing key configured: skips validation, processes normally', async () => {
  const deps = makeDeps({ signingKeys: {} })
  const body = makeWebhookBody([makePaymentLog()])
  const result = await handleAlchemyWebhook(makeReq(body, CHAIN_ID, undefined), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
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
  assert.equal(arcanumTree.leaves.get(COMMITMENT), AMOUNT)
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
