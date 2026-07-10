// =============================================================================
// depositSweepConcurrent — the deposit rail's DURABLE cross-instance idempotency, on real Mongo.
// =============================================================================
//
// The hermetic tests (tests/unit/allocutio/api/depositAttribution.test.ts) prove SEQUENTIAL
// idempotency, but a single-writer Map cannot prove the money-critical property (noema-027 §C):
// a retry-sweep tick racing an Alchemy webhook RE-DELIVERY of the SAME parked deposit credits it
// EXACTLY ONCE. That guarantee is the unique PARTIAL index on `Signum.testis`
// (auctor:'alchemy-webhook') created by the production `ensureIndexes` — the second issue() throws
// a dup-key, and `creditConfirmedDeposit` catches it to replay the winner instead of double-minting.
// This test wires the REAL MongoSignorum + MongoDepositum + MongoRedituum behind the actual webhook
// handler and the sweep, and fires them concurrently. Runs under test:crystal (ephemeral mongo).
// =============================================================================

import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Db } from 'mongodb'
import { AbiCoder } from 'ethers'

import { ensureIndexes } from '../../../src/crystal/ensureIndexes.js'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'
import { MongoRedituum } from '../../../src/crystal/MongoRedituum.js'
import { MongoDepositum } from '../../../src/crystal/MongoDepositum.js'
import { MongoPersona } from '../../../src/crystal/MongoPersona.js'
import { makeResolveWalletAnima } from '../../../src/crystal/resolveWalletAnima.js'
import { handleAlchemyWebhook, sweepConfirmatumDeposita } from '../../../src/api/webhooks/alchemyWebhook.js'
import type { AlchemyWebhookDeps, AlchemyWebhookRequest } from '../../../src/api/webhooks/alchemyWebhook.js'
import { permissiveSanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'
import { fixedPricer } from '../../../src/crystal/AssetPricer.js'
import type { Petitionum, Testimoniorum } from '../../../src/types/catena.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test_deposit_sweep_concurrent'

const TOPIC_PAYMENT = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const VAULT   = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
const CHAIN_ID = '1'
const PAYER   = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
const TOKEN   = '0x0000000000000000000000000000000000000000'
const AMOUNT  = 1_000_000_000_000_000n
const ANIMA   = 'anima-conc-1'
const EXPECTED_GROSS = 3_000_000n
const EXPECTED_IMPETUS = 6231n

const coder = AbiCoder.defaultAbiCoder()
const encodeTopic = (a: string) => '0x' + a.toLowerCase().replace('0x', '').padStart(64, '0')

function req(): AlchemyWebhookRequest {
  const body = {
    type: 'GRAPHQL',
    event: { data: { block: { number: 1, logs: [{
      account: { address: VAULT },
      topics: [TOPIC_PAYMENT, encodeTopic(PAYER), encodeTopic(TOKEN)],
      data: coder.encode(['address', 'uint256', 'uint256', 'uint256'], [TOKEN, AMOUNT, 0n, 0n]),
      transaction: { hash: TX_HASH },
    }] } } },
  }
  return { body, rawBody: JSON.stringify(body), chainId: CHAIN_ID }
}

// petitiones / testimonia / arcanumTree are not under test here — inert stubs.
const petitiones: Petitionum = {
  async find() { return null }, async findExpectans() { return null },
  async create() { throw new Error('unused') }, async update() { throw new Error('unused') }, async expireStale() { return 0 },
}
const testimonia = { async find() { return null }, async findByPossessor() { return null }, async listByAnima() { return [] }, async create() { throw new Error('unused') }, async update() { throw new Error('unused') } } as unknown as Testimoniorum
const arcanumTree = { async insert() { return { leafIndex: 0, proof: {} as never } }, async getProof() { throw new Error('x') }, async getRoot() { return '0x0' }, async findLeaf() { return null }, async size() { return 0 } }

let client: MongoClient
let db: Db
let deps: AlchemyWebhookDeps

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  db = client.db(DB)
  await ensureIndexes(db)   // the PRODUCTION index defs — incl. the unique partial on signa.testis@alchemy-webhook
  const personae = new MongoPersona(db.collection('personae'))
  deps = {
    deposita: new MongoDepositum(db.collection('deposita')),
    signorum: new MongoSignorum(db.collection('signa'), client),
    redituum: new MongoRedituum(db.collection('reditus')),
    petitiones,
    testimonia,
    resolveWalletAnima: makeResolveWalletAnima({ personae, animae: { async findByCustos() { return null } } }),
    arcanumTree: arcanumTree as unknown as AlchemyWebhookDeps['arcanumTree'],
    sanctions: permissiveSanctionsScreen,
    signingKeys: {},
    vaultAddresses: { [CHAIN_ID]: VAULT },
    pricer: fixedPricer(3000, 18),
  }
})

afterEach(async () => {
  await Promise.all([
    db.collection('signa').deleteMany({}),
    db.collection('reditus').deleteMany({}),
    db.collection('deposita').deleteMany({}),
    db.collection('personae').deleteMany({}),
  ])
})

after(async () => {
  await db.dropDatabase().catch(() => {})
  await client.close()
})

async function linkWallet() {
  await db.collection('personae').insertOne({
    id: 'per-conc', activeAnimaId: ANIMA, animaIds: [ANIMA], genus: 'web',
    externusId: PAYER.toLowerCase(), status: 'active', natum: new Date(), visum: new Date(),
  })
}

test('CONCURRENT: sweep vs webhook re-delivery of the same parked deposit → EXACTLY one signum', async () => {
  // 1. First delivery, wallet unlinked → parked confirmatum (token+usdFmv frozen, revenue booked).
  await handleAlchemyWebhook(req(), deps)
  const parked = await db.collection('deposita').findOne({ transactioHash: TX_HASH })
  assert.equal(parked?.status, 'confirmatum')
  assert.equal(parked?.usdFmv, EXPECTED_GROSS.toString())

  // 2. Wallet links.
  await linkWallet()

  // 3. Race the sweep against an Alchemy re-delivery of the very same deposit.
  await Promise.all([
    handleAlchemyWebhook(req(), deps),
    sweepConfirmatumDeposita(deps),
  ])

  // 4. EXACTLY one credit signum, correct balance, one revenue row, deposit terminal.
  const credits = await db.collection('signa').find({ auctor: 'alchemy-webhook', testis: TX_HASH }).toArray()
  assert.equal(credits.length, 1, 'expected exactly one credit signum (no double-mint)')
  assert.equal(credits[0]!.valor, EXPECTED_IMPETUS.toString())
  assert.equal(await deps.signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)

  const reditusRows = await db.collection('reditus').find({ depositumId: parked!.id }).toArray()
  assert.equal(reditusRows.length, 1, 'expected exactly one Reditus (no double-book)')
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), EXPECTED_GROSS)

  const settled = await db.collection('deposita').findOne({ transactioHash: TX_HASH })
  assert.equal(settled?.status, 'processatum')
  assert.equal(settled?.animaId, ANIMA)
  assert.equal(settled?.signumId, credits[0]!.id)
})

test('CONCURRENT: N sweep ticks racing one re-delivery still credit EXACTLY once', async () => {
  await handleAlchemyWebhook(req(), deps)   // parked
  await linkWallet()

  await Promise.all([
    handleAlchemyWebhook(req(), deps),
    sweepConfirmatumDeposita(deps),
    sweepConfirmatumDeposita(deps),
    sweepConfirmatumDeposita(deps),
  ])

  const credits = await db.collection('signa').find({ auctor: 'alchemy-webhook', testis: TX_HASH }).toArray()
  assert.equal(credits.length, 1)
  assert.equal(await deps.signorum.balance({ animaId: ANIMA }), EXPECTED_IMPETUS)
})
