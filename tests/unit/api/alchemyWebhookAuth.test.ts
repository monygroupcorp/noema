/**
 * `POST /webhooks/alchemy/:chainId` — who gets through the door.
 *
 * `:chainId` is a caller-controlled path parameter and every guard in the handler is keyed on it:
 * the HMAC signing key is looked up per chain, and so is the vault address the log filter compares
 * against. A chainId the deployment does not serve resolves neither. These cases pin the three
 * guards that close that:
 *
 *   1. the served-chain gate — an unserved chainId is refused 403 before any log is inspected;
 *   2. the signing-key gate — a served chain with no signing key configured is refused 403; a
 *      chain the deployment is wired for must authenticate, and an absent key is not an exemption;
 *   3. the vault filter — a log is skipped unless BOTH its address and the chain's vault address
 *      are present and equal (absence on either side is never a match).
 *
 * Every case asserts on the STORE SPIES, not only the status code: a 403 that still wrote a
 * Depositum, a Testimonium or an arcanum leaf is the exact outcome these guards exist to prevent,
 * and a status-only assertion would not see it.
 *
 * The behavioural suite for this handler (the processing paths, OFAC, revenue, credit) is
 * `tests/unit/crystal/alchemyWebhook.test.ts`; this file covers admission only.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { AbiCoder } from 'ethers'
import { handleAlchemyWebhook } from '../../../src/api/webhooks/alchemyWebhook.js'
import type { AlchemyWebhookDeps, AlchemyWebhookRequest } from '../../../src/api/webhooks/alchemyWebhook.js'
import { permissiveSanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import { fixedPricer } from '../../../src/crystal/AssetPricer.js'
import type { Depositum, Depositorum, Petitionum, Testimonium, Testimoniorum } from '../../../src/types/catena.js'
import type { Signum, Signorum, Reservatio, Transferatio } from '../../../src/types/significandi.js'

// ── Constants (mirror the implementation) ─────────────────────────────────────

const TOPIC_PAYMENT      = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_NFT_RECEIVED = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const TOPIC_ANON_DEPOSIT = '0x879aadcc0b21da25bde4bcf799cb142a02d0135f66a1328fef12c8b78636c58d'

const VAULT           = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
const SERVED_CHAIN    = '1'
/** Not a key of `vaultAddresses` — i.e. a chain this deployment is not wired for. */
const UNSERVED_CHAIN  = '9999'

const PAYER      = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const TX_HASH    = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
const TOKEN      = '0x0000000000000000000000000000000000000000'   // ETH (zero address)
const AMOUNT     = 1_000_000_000_000_000n                          // 0.001 ETH in wei
const COMMITMENT = '0x' + '11'.repeat(32)
const ANIMA_ID   = 'anima-under-test'

// ── Spied stores ──────────────────────────────────────────────────────────────

let idSeq = 0
const nextId = (prefix: string) => `${prefix}-${++idSeq}`

function makeDeposita() {
  const created: Depositum[] = []
  const store = new Map<string, Depositum>()
  const deposita: Depositorum & { created: Depositum[] } = {
    created,
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
      created.push(d)
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
  return deposita
}

function makeTestimonia() {
  const created: Testimonium[] = []
  const testimonia: Testimoniorum & { created: Testimonium[] } = {
    created,
    async find(id) { return created.find(t => t.id === id) ?? null },
    async findByPossessor(possessor, contractus) {
      return created.find(t => t.possessor === possessor && t.contractus === contractus) ?? null
    },
    async listByAnima(animaId) { return created.filter(t => t.animaId === animaId) },
    async create(input) {
      const t: Testimonium = { ...input, id: nextId('tes'), natum: new Date() }
      created.push(t)
      return t
    },
    async update(id, patch) {
      const t = created.find(t => t.id === id)
      if (!t) throw new Error(`Testimonium ${id} not found`)
      Object.assign(t, patch)
      return t
    },
  }
  return testimonia
}

function makeArcanumTree() {
  const inserted: Array<{ commitment: string; valor: bigint }> = []
  return {
    inserted,
    async insert(commitment: string, valor: bigint) {
      inserted.push({ commitment, valor })
      return { leafIndex: inserted.length - 1, proof: { pathElements: [], pathIndices: [], root: '0x0' } as never }
    },
    async getProof() { throw new Error('not used') },
    async getRoot() { return '0x0' },
    async findLeaf(commitment: string) {
      const hit = inserted.find(l => l.commitment === commitment)
      return hit ? ({ commitment, valor: hit.valor } as never) : null
    },
    async size() { return inserted.length },
  }
}

function makeSignorum() {
  const issued: Signum[] = []
  const signorum: Signorum & { issued: Signum[] } = {
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
    // Admission-only suite: the handler never reaches these. They are present so the
    // double satisfies Signorum, and they throw rather than return a plausible value —
    // a silent default here would let a future call pass unnoticed.
    async sessionBudget(): Promise<bigint> { throw new Error('not used') },
    async reserve(): Promise<Reservatio> { throw new Error('not used') },
    async findByTestis(): Promise<Signum | null> { throw new Error('not used') },
    async ownsAny(): Promise<boolean> { throw new Error('not used') },
    async transfer(): Promise<Transferatio> { throw new Error('not used') },
    async createMany(): Promise<Signum[]> { throw new Error('not used') },
  }
  return signorum
}

function makeRedituum() {
  const rows: import('../../../src/types/reditus.js').Reditus[] = []
  return {
    rows,
    async record(draft: import('../../../src/types/reditus.js').ReditusDraft) {
      if (draft.depositumId !== undefined) {
        const existing = rows.find(r => r.depositumId === draft.depositumId)
        if (existing) return existing
      }
      const r = {
        id: nextId('red'),
        natum: draft.natum ?? new Date(),
        usdFmv: draft.usdFmv,
        fmvSource: draft.fmvSource,
        origo: draft.origo,
        ...(draft.depositumId !== undefined ? { depositumId: draft.depositumId } : {}),
      }
      rows.push(r)
      return r
    },
    async trailingUsdRevenue() { return rows.reduce((s, r) => s + r.usdFmv, 0n) },
  }
}

const petitiones: Petitionum = {
  async find() { return null },
  async findExpectans() { return null },
  async create() { throw new Error('not used') },
  async update() { throw new Error('not used') },
  async expireStale() { return 0 },
}

type SpiedDeps = AlchemyWebhookDeps & {
  deposita: ReturnType<typeof makeDeposita>
  testimonia: ReturnType<typeof makeTestimonia>
  arcanumTree: ReturnType<typeof makeArcanumTree>
  signorum: ReturnType<typeof makeSignorum>
}

/**
 * Deps wired the way production wires them: `vaultAddresses` carries exactly the served chains.
 * `resolveWalletAnima` always resolves, so the NFT path would reach `testimonia.create` — the
 * unserved-chain NFT case fails loudly if the door lets it through, rather than passing because
 * some unrelated lookup came back empty.
 */
function makeDeps(overrides: Partial<AlchemyWebhookDeps> = {}): SpiedDeps {
  const deposita = makeDeposita()
  const testimonia = makeTestimonia()
  const arcanumTree = makeArcanumTree()
  const signorum = makeSignorum()
  return {
    deposita,
    signorum,
    redituum: makeRedituum(),
    petitiones,
    testimonia,
    resolveWalletAnima: async () => ANIMA_ID,
    arcanumTree,
    sanctions: permissiveSanctionsScreen,
    signingKeys: {},
    vaultAddresses: { [SERVED_CHAIN]: VAULT },
    pricer: fixedPricer(3000, 18),
    ...overrides,
  } as SpiedDeps
}

/** Nothing was written to any store the handlers can reach. */
function assertNothingWritten(deps: SpiedDeps) {
  assert.deepEqual(deps.deposita.created, [], 'no Depositum may be written')
  assert.deepEqual(deps.testimonia.created, [], 'no Testimonium may be written')
  assert.deepEqual(deps.arcanumTree.inserted, [], 'no arcanum leaf may be inserted')
  assert.deepEqual(deps.signorum.issued, [], 'no Signum may be issued')
}

// ── Log fixtures ──────────────────────────────────────────────────────────────

const coder = AbiCoder.defaultAbiCoder()

/** Zero-pad an address into a 32-byte topic slot. */
const encodeTopic = (addr: string) => '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0')

/**
 * `address` omitted entirely reproduces the shape that defeats an equality-only vault filter:
 * `entry.account?.address` is `undefined`, and on a chain with no vault address configured so is
 * the other side of the comparison.
 */
type LogOverrides = { address?: string | null }

function accountOf(o: LogOverrides) {
  const addr = o.address === undefined ? VAULT : o.address
  return addr === null ? {} : { account: { address: addr } }
}

function paymentLog(o: LogOverrides = {}) {
  return {
    ...accountOf(o),
    topics: [
      TOPIC_PAYMENT,
      encodeTopic(PAYER),
      encodeTopic('0x0000000000000000000000000000000000000000'),
    ],
    data: coder.encode(['address', 'uint256', 'uint256', 'uint256'], [TOKEN, AMOUNT, 0n, 0n]),
    transaction: { hash: TX_HASH },
  }
}

function nftLog(o: LogOverrides = {}) {
  return {
    ...accountOf(o),
    topics: [
      TOPIC_NFT_RECEIVED,
      encodeTopic('0x1111111111111111111111111111111111111111'),
      encodeTopic(PAYER),
    ],
    data: coder.encode(['address', 'uint256'], ['0x2222222222222222222222222222222222222222', 42n]),
    transaction: { hash: TX_HASH },
  }
}

function anonDepositLog(o: LogOverrides = {}) {
  return {
    ...accountOf(o),
    topics: [TOPIC_ANON_DEPOSIT, COMMITMENT],
    data: coder.encode(['address', 'uint256'], [TOKEN, AMOUNT]),
    transaction: { hash: TX_HASH, from: PAYER },
  }
}

function webhookBody(logs: unknown[]) {
  return {
    webhookId: 'wh_test',
    id: 'evt_test',
    createdAt: '2026-01-01T00:00:00.000Z',
    type: 'GRAPHQL',
    event: { data: { block: { number: 99999, logs } } },
  }
}

function req(body: unknown, chainId: string, signature?: string): AlchemyWebhookRequest {
  return { body, rawBody: JSON.stringify(body), chainId, signature }
}

const sign = (secret: string, rawBody: string) =>
  crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

// ── The door: an unserved chainId ─────────────────────────────────────────────
//
// Each case sends the log with `account.address` omitted — the shape an equality-only vault
// filter admits — so the request is refused by the served-chain gate rather than by a downstream
// address comparison that happens to hold.

test('unserved chainId: payment log is refused 403 and writes no Depositum', async () => {
  const deps = makeDeps()
  const result = await handleAlchemyWebhook(req(webhookBody([paymentLog({ address: null })]), UNSERVED_CHAIN), deps)

  assert.equal(result.status, 403)
  assert.equal(result.body.success, false)
  assert.equal(result.body.processed, 0)
  assertNothingWritten(deps)
})

test('unserved chainId: NFT log is refused 403 and writes no Testimonium', async () => {
  const deps = makeDeps()
  const result = await handleAlchemyWebhook(req(webhookBody([nftLog({ address: null })]), UNSERVED_CHAIN), deps)

  assert.equal(result.status, 403)
  assert.equal(result.body.success, false)
  assertNothingWritten(deps)
})

test('unserved chainId: anonymous-deposit log is refused 403 and inserts no arcanum leaf', async () => {
  const deps = makeDeps()
  const result = await handleAlchemyWebhook(req(webhookBody([anonDepositLog({ address: null })]), UNSERVED_CHAIN), deps)

  assert.equal(result.status, 403)
  assert.equal(result.body.success, false)
  assertNothingWritten(deps)
})

test('unserved chainId: refused on the chainId alone, even with a well-formed vault-addressed log', async () => {
  const deps = makeDeps()
  const result = await handleAlchemyWebhook(req(webhookBody([paymentLog()]), UNSERVED_CHAIN), deps)

  assert.equal(result.status, 403)
  assertNothingWritten(deps)
})

test('unserved chainId: an inherited Object property is not a served chain', async () => {
  // `:chainId` is caller-controlled, so a key that exists on Object.prototype ('constructor',
  // 'toString') must not read as a configured chain.
  const deps = makeDeps()
  for (const chainId of ['constructor', 'toString', '__proto__']) {
    const result = await handleAlchemyWebhook(req(webhookBody([paymentLog({ address: null })]), chainId), deps)
    assert.equal(result.status, 403, `chainId '${chainId}' must be refused`)
  }
  assertNothingWritten(deps)
})

// ── The served path is unchanged ──────────────────────────────────────────────

test('served chainId with a valid signature: processes the payment log as before', async () => {
  const secret = 'alchemy-secret-42'
  const deps = makeDeps({ signingKeys: { [SERVED_CHAIN]: secret } })
  const body = webhookBody([paymentLog()])
  const rawBody = JSON.stringify(body)
  const result = await handleAlchemyWebhook(
    { body, rawBody, chainId: SERVED_CHAIN, signature: sign(secret, rawBody) },
    deps,
  )

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(result.body.processed, 1)
  assert.equal(result.body.skipped, 0)
  assert.equal(deps.deposita.created.length, 1)
  assert.equal(deps.deposita.created[0].ab, PAYER.toLowerCase())
})

test('served chainId with a bad signature: 401, and nothing is written', async () => {
  const deps = makeDeps({ signingKeys: { [SERVED_CHAIN]: 'alchemy-secret-42' } })
  const result = await handleAlchemyWebhook(
    req(webhookBody([paymentLog()]), SERVED_CHAIN, 'not-the-signature'),
    deps,
  )

  assert.equal(result.status, 401)
  assert.equal(result.body.success, false)
  assertNothingWritten(deps)
})

// ── The signing-key gate: a served chain with no key configured ───────────────
//
// `signingKeys` is env-conditional — an entry exists only when the chain's signing-key variable
// resolves — while `vaultAddresses` is built unconditionally, so a chain can be served with no
// key present. The handler must refuse that request rather than process it as trusted: every
// payload reaching this endpoint credits balances, books revenue and inserts arcanum leaves
// purely on what the body claims.

test('served chainId with no signing key configured: refused 403, and nothing is written', async () => {
  const deps = makeDeps({ signingKeys: {} })
  const result = await handleAlchemyWebhook(
    req(webhookBody([paymentLog(), nftLog(), anonDepositLog()]), SERVED_CHAIN),
    deps,
  )

  assert.equal(result.status, 403)
  assert.equal(result.body.success, false)
  assert.equal(result.body.processed, 0)
  assertNothingWritten(deps)
})

test('served chainId with no signing key configured: a validly-signed request is refused too', async () => {
  // The refusal is on the deployment's own configuration, not on what the caller presents — a
  // caller who signs with a key we do not hold gets the same 403.
  const deps = makeDeps({ signingKeys: {} })
  const body = webhookBody([paymentLog()])
  const rawBody = JSON.stringify(body)
  const result = await handleAlchemyWebhook(
    { body, rawBody, chainId: SERVED_CHAIN, signature: sign('alchemy-secret-42', rawBody) },
    deps,
  )

  assert.equal(result.status, 403)
  assertNothingWritten(deps)
})

// ── The vault filter: absence is never a match ────────────────────────────────

test('served chainId, signed, log with no account.address: skipped, not processed', async () => {
  const secret = 'alchemy-secret-42'
  const deps = makeDeps({ signingKeys: { [SERVED_CHAIN]: secret } })
  const body = webhookBody([paymentLog({ address: null })])
  const rawBody = JSON.stringify(body)
  const result = await handleAlchemyWebhook(
    { body, rawBody, chainId: SERVED_CHAIN, signature: sign(secret, rawBody) },
    deps,
  )

  assert.equal(result.status, 200)
  assert.equal(result.body.processed, 0)
  assert.equal(result.body.skipped, 1)
  assertNothingWritten(deps)
})
