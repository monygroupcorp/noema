// =============================================================================
// depositAttribution — the P0 deposit-crediting seam, hermetically (noema-027)
// =============================================================================
//
// Proves the Persona-first attribution seam + the retry sweep with REAL money stores
// (MemorySignorum + MemoryRedituum) and fake on-chain stores. Sequential idempotency only —
// the money-critical TWO-instance race (sweep vs re-delivery → exactly one signum) needs the
// Mongo unique-partial index and lives in tests/unit/crystal/depositSweepConcurrent.test.ts.
//
// Matrix (per the noema-027 verify block):
//   - a linked (Persona) payer credits within ONE webhook delivery;
//   - an unlinked payer parks `confirmatum`, books revenue at receipt, issues NO credit;
//   - re-delivery after linking credits EXACTLY once (no double signum, no double revenue);
//   - the sweep heals a parked deposit after linking, EXACTLY once;
//   - the NFT path resolves through the same seam;
//   - the sweep skips a legacy parked row that lacks the persisted receipt-time basis.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AbiCoder } from 'ethers'

import { handleAlchemyWebhook, sweepConfirmatumDeposita } from '../../../../src/api/webhooks/alchemyWebhook.js'
import type { AlchemyWebhookDeps, AlchemyWebhookRequest } from '../../../../src/api/webhooks/alchemyWebhook.js'
import { makeResolveWalletAnima } from '../../../../src/crystal/resolveWalletAnima.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { MemoryRedituum } from '../../../../src/ledger/MemoryRedituum.js'
import { permissiveSanctionsScreen } from '../../../../src/compliance/SanctionsScreen.js'
import { fixedPricer } from '../../../../src/crystal/AssetPricer.js'
import type { Depositum, Depositorum, Petitio, Petitionum, Testimonium, Testimoniorum } from '../../../../src/types/catena.js'
import type { Persona, PersonaStore } from '../../../../src/types/persona.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const TOPIC_PAYMENT      = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_NFT_RECEIVED = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const VAULT   = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
const CHAIN_ID = '1'
const PAYER   = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
const TOKEN   = '0x0000000000000000000000000000000000000000'   // ETH sentinel (zero addr)
const AMOUNT  = 1_000_000_000_000_000n                          // 0.001 ETH
const ANIMA   = 'anima-linked-1'
// 0.001 ETH @ $3000 = $3 gross = 3_000_000 µUSD; net credit = ×0.70 ÷337 = 6231 impetus.
const EXPECTED_GROSS = 3_000_000n
const EXPECTED_IMPETUS = 6231n

const coder = AbiCoder.defaultAbiCoder()
let idSeq = 0
const nextId = (p: string) => `${p}-${++idSeq}`

function encodeTopic(addr: string) { return '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0') }

function paymentLog(over: { payer?: string; token?: string; amount?: bigint; txHash?: string } = {}) {
  return {
    account: { address: VAULT },
    topics: [TOPIC_PAYMENT, encodeTopic(over.payer ?? PAYER), encodeTopic(TOKEN)],
    data: coder.encode(['address', 'uint256', 'uint256', 'uint256'], [over.token ?? TOKEN, over.amount ?? AMOUNT, 0n, 0n]),
    transaction: { hash: over.txHash ?? TX_HASH },
  }
}
function nftLog(over: { from?: string; token?: string; tokenId?: bigint } = {}) {
  return {
    account: { address: VAULT },
    topics: [TOPIC_NFT_RECEIVED, encodeTopic('0x1111111111111111111111111111111111111111'), encodeTopic(over.from ?? PAYER)],
    data: coder.encode(['address', 'uint256'], [over.token ?? '0x2222222222222222222222222222222222222222', over.tokenId ?? 7n]),
    transaction: { hash: TX_HASH },
  }
}
function req(logs: unknown[]): AlchemyWebhookRequest {
  const body = { type: 'GRAPHQL', event: { data: { block: { number: 1, logs } } } }
  return { body, rawBody: JSON.stringify(body), chainId: CHAIN_ID }
}

// ── Fake on-chain stores ─────────────────────────────────────────────────────
function makeDeposita(): Depositorum & { store: Map<string, Depositum> } {
  const store = new Map<string, Depositum>()
  return {
    store,
    async find(id) { return store.get(id) ?? null },
    async findByHash(h, c) { for (const d of store.values()) if (d.transactioHash === h && String(d.chainId) === String(c)) return d; return null },
    async list(f) { let a = [...store.values()]; if (f?.status) a = a.filter(d => d.status === f.status); if (f?.animaId) a = a.filter(d => d.animaId === f.animaId); return a },
    async create(input) { const d: Depositum = { ...input, id: nextId('dep'), natum: new Date() }; store.set(d.id, d); return d },
    async update(id, patch) { const d = store.get(id); if (!d) throw new Error('no dep'); const u = { ...d, ...patch }; store.set(id, u); return u },
  }
}
function makePetitiones(initial?: Petitio): Petitionum & { store: Map<string, Petitio> } {
  const store = new Map<string, Petitio>()
  if (initial) store.set(initial.id, initial)
  return {
    store,
    async find(id) { return store.get(id) ?? null },
    async findExpectans(animaId) { for (const p of store.values()) if (p.animaId === animaId && p.status === 'expectans') return p; return null },
    async create(input) { const p: Petitio = { ...input, id: nextId('pet'), natum: new Date() }; store.set(p.id, p); return p },
    async update(id, patch) { const p = store.get(id); if (!p) throw new Error('no pet'); const u = { ...p, ...patch }; store.set(id, u); return u },
    async expireStale() { return 0 },
  }
}
function makeTestimonia(): Testimoniorum & { store: Testimonium[] } {
  const store: Testimonium[] = []
  return {
    store,
    async find(id) { return store.find(t => t.id === id) ?? null },
    async findByPossessor(p, c) { return store.find(t => t.possessor === p && t.contractus === c) ?? null },
    async listByAnima(a) { return store.filter(t => t.animaId === a) },
    async create(input) { const t: Testimonium = { ...input, id: nextId('tes'), natum: new Date() }; store.push(t); return t },
    async update(id, patch) { const t = store.find(t => t.id === id); if (!t) throw new Error('no tes'); Object.assign(t, patch); return t },
  }
}
const arcanumTree = { async insert() { return { leafIndex: 0, proof: {} as never } }, async getProof() { throw new Error('x') }, async getRoot() { return '0x0' }, async findLeaf() { return null }, async size() { return 0 } }

// A fake personae store keyed by (genus, externusId), plus a helper to link a web wallet.
function makePersonae() {
  const store = new Map<string, Persona>()
  const key = (g: string, e: string) => `${g}:${e.toLowerCase()}`
  const personae: Pick<PersonaStore, 'findByExternus'> = { async findByExternus(g, e) { return store.get(key(g, e)) ?? null } }
  const link = (addr: string, animaId: string, status: Persona['status'] = 'active') => {
    store.set(key('web', addr), { id: nextId('per'), activeAnimaId: animaId, animaIds: [animaId], genus: 'web', externusId: addr.toLowerCase(), status, natum: new Date(), visum: new Date() })
  }
  return { personae, link }
}
const noCustos = { async findByCustos() { return null } }

function makeDeps(personae: Pick<PersonaStore, 'findByExternus'>, over: Partial<AlchemyWebhookDeps> = {}) {
  const deposita = (over.deposita as ReturnType<typeof makeDeposita>) ?? makeDeposita()
  const signorum = (over.signorum as MemorySignorum) ?? new MemorySignorum()
  const redituum = (over.redituum as MemoryRedituum) ?? new MemoryRedituum()
  const petitiones = (over.petitiones as ReturnType<typeof makePetitiones>) ?? makePetitiones()
  const testimonia = (over.testimonia as ReturnType<typeof makeTestimonia>) ?? makeTestimonia()
  const deps: AlchemyWebhookDeps = {
    deposita, signorum, redituum, petitiones, testimonia,
    resolveWalletAnima: makeResolveWalletAnima({ personae, animae: noCustos }),
    arcanumTree: arcanumTree as unknown as AlchemyWebhookDeps['arcanumTree'],
    sanctions: permissiveSanctionsScreen,
    signingKeys: {},
    vaultAddresses: { [CHAIN_ID]: VAULT },
    pricer: (over.pricer as AlchemyWebhookDeps['pricer']) ?? fixedPricer(3000, 18),
  }
  return { deps, deposita, signorum, redituum, petitiones, testimonia }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('linked payer (Persona): credits within ONE webhook delivery', async () => {
  const { personae, link } = makePersonae()
  link(PAYER, ANIMA)
  const { deps, deposita, signorum } = makeDeps(personae)

  const r = await handleAlchemyWebhook(req([paymentLog()]), deps)
  assert.equal(r.status, 200)

  const dep = [...deposita.store.values()][0]
  assert.equal(dep.status, 'processatum')
  assert.equal(dep.animaId, ANIMA)
  assert.equal(dep.token, TOKEN)
  assert.equal(dep.usdFmv, EXPECTED_GROSS)          // receipt-time basis frozen on the row
  assert.equal(await signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)
})

test('unlinked payer: parks confirmatum, books revenue at receipt, issues NO credit', async () => {
  const { personae } = makePersonae()   // nobody linked
  const { deps, deposita, signorum, redituum } = makeDeps(personae)

  await handleAlchemyWebhook(req([paymentLog()]), deps)

  const dep = [...deposita.store.values()][0]
  assert.equal(dep.status, 'confirmatum')
  assert.equal(dep.animaId, undefined)
  assert.equal(dep.token, TOKEN)                     // basis persisted so the sweep can heal it
  assert.equal(dep.usdFmv, EXPECTED_GROSS)
  assert.equal(await signorum.balance({ animaId: ANIMA }), 0n)
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)   // revenue at receipt
})

test('re-delivery after linking: credits EXACTLY once (no double signum, no double revenue)', async () => {
  const { personae, link } = makePersonae()
  const { deps, deposita, signorum, redituum } = makeDeps(personae)

  await handleAlchemyWebhook(req([paymentLog()]), deps)     // unlinked → parked
  assert.equal([...deposita.store.values()][0].status, 'confirmatum')

  link(PAYER, ANIMA)                                        // wallet links
  await handleAlchemyWebhook(req([paymentLog()]), deps)     // re-delivery → credits
  await handleAlchemyWebhook(req([paymentLog()]), deps)     // another re-delivery → processatum short-circuit

  assert.equal([...deposita.store.values()].length, 1)
  assert.equal((await signorum.history({ animaId: ANIMA })).length, 1)         // exactly one signum
  assert.equal(await signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)  // revenue once
})

test('re-delivery at a CHANGED price credits at the receipt-time (booked) FMV, not the re-delivery FMV', async () => {
  // Value-conservation guard (Captain amendment B): revenue is booked once, at receipt-time FMV, and
  // bookRevenue is idempotent on depositumId — so the credit must use the PERSISTED receipt basis. If
  // the webhook re-priced on re-delivery, a price move would mint impetus that diverges from the
  // already-booked revenue (excess/unbacked mint when the price rose).
  let spot = 3000                                             // receipt-time price
  const mutablePricer = { async usdFmv(_c: unknown, _t: unknown, amountRaw: bigint) {
    const micro = (amountRaw * BigInt(Math.round(spot * 1_000_000))) / 10n ** 18n
    return micro > 0n ? micro : null
  } }
  const { personae, link } = makePersonae()
  const { deps, deposita, signorum, redituum } = makeDeps(personae, { pricer: mutablePricer as unknown as AlchemyWebhookDeps['pricer'] })

  await handleAlchemyWebhook(req([paymentLog()]), deps)       // unlinked → parked at $3000 FMV
  const parked = [...deposita.store.values()][0]
  assert.equal(parked.status, 'confirmatum')
  assert.equal(parked.usdFmv, EXPECTED_GROSS)                 // receipt basis frozen

  link(PAYER, ANIMA)
  spot = 6000                                                 // ETH doubles before the re-delivery
  await handleAlchemyWebhook(req([paymentLog()]), deps)       // re-delivery → credits

  // Credit basis = receipt-time FMV ($3000), NOT the re-delivery FMV ($6000). Impetus and revenue
  // both stay at the receipt-time figures.
  assert.equal(await signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)
  assert.equal([...deposita.store.values()][0].usdFmv, EXPECTED_GROSS)
})

test('sweep heals a parked deposit after linking, EXACTLY once', async () => {
  const { personae, link } = makePersonae()
  const { deps, deposita, signorum } = makeDeps(personae)

  await handleAlchemyWebhook(req([paymentLog()]), deps)     // unlinked → parked
  assert.equal((await sweepConfirmatumDeposita(deps)).swept, 0)   // still unlinked → nothing swept

  link(PAYER, ANIMA)
  assert.deepEqual(await sweepConfirmatumDeposita(deps), { swept: 1, skipped: 0 })   // heals
  assert.deepEqual(await sweepConfirmatumDeposita(deps), { swept: 0, skipped: 0 })   // now processatum

  assert.equal([...deposita.store.values()][0].status, 'processatum')
  assert.equal((await signorum.history({ animaId: ANIMA })).length, 1)
  assert.equal(await signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)
})

test('sweep RE-BOOKS a create-succeeded-but-book-failed row, then credits EXACTLY once', async () => {
  // v4 gauntlet finding: a Depositum's usdFmv is persisted at `create` BEFORE bookRevenue runs (two
  // writes, no transaction). If record() threw transiently and the process restarted, the sweep would
  // see a PRICED row with NO revenue booked. Crediting it without re-booking leaves revenue permanently
  // zero (re-delivery short-circuits on processatum). The sweep must re-book idempotently first.
  const { personae, link } = makePersonae()
  link(PAYER, ANIMA)
  const deposita = makeDeposita()
  // The row exists WITH its receipt-time basis persisted (create succeeded) but revenue was never
  // booked (redituum is empty — the book write failed before the restart).
  await deposita.create({ chainId: CHAIN_ID, transactioHash: TX_HASH, ab: PAYER.toLowerCase(), ad: VAULT, valor: AMOUNT, confirmationes: 1, status: 'confirmatum', token: TOKEN, usdFmv: EXPECTED_GROSS })
  const { deps, signorum, redituum } = makeDeps(personae, { deposita })
  assert.equal(await redituum.trailingUsdRevenue(new Date()), 0n)   // precondition: no revenue booked

  assert.deepEqual(await sweepConfirmatumDeposita(deps), { swept: 1, skipped: 0 })   // books AND credits
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)        // revenue now booked
  assert.equal(await signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)         // credited exactly once
  assert.equal((await signorum.history({ animaId: ANIMA })).length, 1)

  // A subsequent sweep + a webhook re-delivery must NOT double revenue or signum (idempotent on both).
  assert.deepEqual(await sweepConfirmatumDeposita(deps), { swept: 0, skipped: 0 })
  await handleAlchemyWebhook(req([paymentLog()]), deps)                              // re-delivery → short-circuit
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)        // revenue still once
  assert.equal((await signorum.history({ animaId: ANIMA })).length, 1)              // signum still once
  assert.equal([...deposita.store.values()].length, 1)
})

test('webhook re-delivery of a book-failed row books from the receipt basis, not the drifted spot', async () => {
  // v4 gauntlet finding (webhook retry path, sibling of the sweep case above): AssetPricer prices at
  // SPOT, so re-pricing on a re-delivery yields the retry-window price, not the receipt price. For the
  // create-succeeded-but-book-failed row (Depositum persisted at receipt FMV, no Reditus — the book
  // write threw transiently), the Alchemy retry reuses the row and re-prices at the drifted spot. If
  // the webhook booked from that fresh price it would recognize revenue at the DRIFTED figure while
  // crediting impetus from the PERSISTED receipt basis — recognized USD diverging from the credit
  // basis by the spot drift (value-conservation break; Captain amendment B). The webhook must book
  // from the same persisted basis the credit uses, mirroring the sweep's re-book.
  const { personae, link } = makePersonae()
  link(PAYER, ANIMA)

  // Spot drifts UP over the retry window — the re-delivery prices at $6000, twice the receipt $3000.
  let spot = 6000
  const mutablePricer = { async usdFmv(_c: unknown, _t: unknown, amountRaw: bigint) {
    const micro = (amountRaw * BigInt(Math.round(spot * 1_000_000))) / 10n ** 18n
    return micro > 0n ? micro : null
  } }

  // The book-failed row: create succeeded (receipt basis $3000 frozen on the row) but revenue was
  // never booked (redituum empty — the book write failed before a restart).
  const deposita = makeDeposita()
  await deposita.create({ chainId: CHAIN_ID, transactioHash: TX_HASH, ab: PAYER.toLowerCase(), ad: VAULT, valor: AMOUNT, confirmationes: 1, status: 'confirmatum', token: TOKEN, usdFmv: EXPECTED_GROSS })
  const { deps, signorum, redituum } = makeDeps(personae, { deposita, pricer: mutablePricer as unknown as AlchemyWebhookDeps['pricer'] })
  assert.equal(await redituum.trailingUsdRevenue(new Date()), 0n)   // precondition: no revenue booked

  await handleAlchemyWebhook(req([paymentLog()]), deps)             // retry at the drifted spot → books + credits

  // The invariant: recognized revenue == the credit basis, BOTH the receipt FMV ($3000) — NOT the
  // drifted spot ($6000). Old code booked 6_000_000n here while crediting from 3_000_000n.
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)   // receipt, not spot
  assert.equal(await signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)    // credit from the same basis
  assert.equal((await signorum.history({ animaId: ANIMA })).length, 1)
  assert.equal([...deposita.store.values()][0].status, 'processatum')

  // Re-delivery again short-circuits (processatum) — no double revenue, no double signum.
  await handleAlchemyWebhook(req([paymentLog()]), deps)
  assert.equal(await redituum.trailingUsdRevenue(new Date()), EXPECTED_GROSS)
  assert.equal((await signorum.history({ animaId: ANIMA })).length, 1)
})

test('magic-amount petitio confirmed on a linked-payer deposit', async () => {
  const { personae, link } = makePersonae()
  link(PAYER, ANIMA)
  const petitiones = makePetitiones({
    id: 'pet-1', animaId: ANIMA, chainId: CHAIN_ID, valuta: AMOUNT, ad: VAULT,
    status: 'expectans', natum: new Date(), expirat: new Date(Date.now() + 3_600_000),
  })
  const { deps } = makeDeps(personae, { petitiones })

  await handleAlchemyWebhook(req([paymentLog()]), deps)
  const updated = petitiones.store.get('pet-1')
  assert.equal(updated?.status, 'confirmata')
  assert.equal(updated?.walletAddress, PAYER.toLowerCase())
})

test('NFT path: linked sender creates a Testimonium; unlinked is skipped', async () => {
  const { personae, link } = makePersonae()
  link(PAYER, ANIMA)
  const { deps, testimonia } = makeDeps(personae)
  await handleAlchemyWebhook(req([nftLog({ from: PAYER })]), deps)
  assert.equal(testimonia.store.length, 1)
  assert.equal(testimonia.store[0].animaId, ANIMA)

  const other = makePersonae()   // nobody linked
  const { deps: deps2, testimonia: t2 } = makeDeps(other.personae)
  const r = await handleAlchemyWebhook(req([nftLog({ from: PAYER })]), deps2)
  assert.equal(r.body.processed, 0)
  assert.equal(t2.store.length, 0)
})

test('sweep skips a legacy parked row that lacks the persisted receipt-time basis', async () => {
  const { personae, link } = makePersonae()
  link(PAYER, ANIMA)
  const deposita = makeDeposita()
  // A row that predates the token/usdFmv persistence (the three stuck staging deposita).
  await deposita.create({ chainId: CHAIN_ID, transactioHash: TX_HASH, ab: PAYER.toLowerCase(), ad: VAULT, valor: AMOUNT, confirmationes: 1, status: 'confirmatum' })
  const { deps, signorum } = makeDeps(personae, { deposita })

  assert.deepEqual(await sweepConfirmatumDeposita(deps), { swept: 0, skipped: 1 })   // skipped, not credited
  assert.equal([...deposita.store.values()][0].status, 'confirmatum')                // still parked
  assert.equal(await signorum.balance({ animaId: ANIMA }), 0n)
})
