/**
 * End-to-end flow test for the ZK anonymous credit system.
 *
 * Walks the full path:
 *   identified balance → issue note → tree grows → fresh proof → spend → actum
 *
 * Uses all in-memory fakes (no MongoDB, no snarkjs). The Groth16 verify fn
 * is mocked to accept any well-formed proof, isolating flow correctness
 * from cryptographic correctness (which is covered by the circuit itself).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArcanumIssuer } from '../../../src/ledger/ArcanumIssuer.js'
import { ArcanumVerifier } from '../../../src/arcanum/ArcanumVerifier.js'
import { MemoryArcanumTree } from '../../../src/arcanum/ArcanumTree.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { ActumInceptor, InsufficientFundsError } from '../../../src/execution/ActumInceptor.js'
import { MongoBursarium } from '../../../src/arcanum/MongoBursarium.js'
import { InsufficientBursaCreditsError } from '../../../src/types/bursa.js'
import { computeCommitment, computeNullifierHash } from '../../../src/arcanum/poseidon.js'
import { computeRecipient } from '../../../src/arcanum/prover.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { ArcanumSpendProof } from '../../../src/arcanum/types.js'
import type { Cursor, Actorum, Cursorum } from '../../../src/types/cursus.js'

// ── Shared fakes ──────────────────────────────────────────────────────────────

function makeModus(reserve = 100n): Modus {
  return {
    id: 'mod-1', nomen: 'test', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc',
    aditus: {}, exitus: {}, canonica: true,
    ministerium: 'openai', impetusFixum: reserve,
    natum: new Date(), mutatum: new Date(),
  }
}

function makeRunner(reserve: bigint): Cursor {
  return {
    reserve: async () => reserve,
    run: async () => ({ exitus: {}, impetus: reserve }),
  }
}

function makeCursorum(runner: Cursor): Cursorum {
  return { register: () => {}, resolve: () => runner }
}

function makeActa(): Actorum & { records: Actum[] } {
  const records: Actum[] = []
  return {
    records,
    create: async (a) => { const r = { ...a, inceptum: new Date() }; records.push(r); return r },
    update: async (id, patch) => {
      const r = records.find(x => x.id === id)!
      Object.assign(r, patch)
      return r
    },
    findById: async (id) => records.find(x => x.id === id) ?? null,
    findByExternusJobId: async () => null,
    findByNullifier: async (n) => records.find(x => x.nullifier === n) ?? null,
    findExpired: async () => [],
  }
}

/** Mock verifier — accepts any proof. Validates signals shape only. */
const mockVerify = async (_proof: object, signals: string[]) => {
  assert.equal(signals.length, 4, 'public signals must have exactly 4 elements')
  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeSetup(identifiedBalance = 500n) {
  const signorum = new MemorySignorum()
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: identifiedBalance, auctor: 'test' })

  const tree = new MemoryArcanumTree()
  const issuer = new ArcanumIssuer({ signorum, tree })
  const verifier = new ArcanumVerifier({ tree, verify: mockVerify })

  const modus = makeModus(100n)
  const acta = makeActa()
  const inceptor = new ActumInceptor({
    modorum: { find: async () => modus, register: async () => {}, list: async () => [] },
    cursorum: makeCursorum(makeRunner(100n)),
    signorum,
    acta,
    arcanumVerifier: verifier,
  })

  return { signorum, tree, issuer, verifier, inceptor, modus, acta }
}

// ── Test 1: full happy-path spend ─────────────────────────────────────────────

test('full flow: issue note → spend → actum has nullifierHash as nullifier', async () => {
  const { issuer, tree, inceptor, modus } = await makeSetup(500n)

  // 1. Issue note
  const issuance = await issuer.issue({ animaId: 'anima-1' }, 200n)
  const { note } = issuance
  assert.equal(note.valor, 200n)
  assert.equal(note.spent, false)

  // 2. Fetch fresh Merkle proof (root may have changed if other notes were issued)
  const freshProof = await tree.getProof(note.leafIndex)

  // 3. Build spend proof with correct public signals
  const aditus = {}
  const recipient = computeRecipient(modus.id, aditus)
  const spend: ArcanumSpendProof = {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root: freshProof.root,
      nullifierHash: note.nullifierHash,
      valor: note.valor.toString(),
      recipient,
    },
  }

  // 4. Spend via ActumInceptor
  const actum = await inceptor.initiate({
    modusId: modus.id, aditus, by: { arcanumProof: spend },
  })

  assert.equal(actum.status, 'nascens')
  assert.equal(actum.nullifier, note.nullifierHash)
  assert.deepEqual(actum.signaConsumed, [])
})

// ── Test 2: identified balance is debited on issue ────────────────────────────

test('identified balance decreases by note valor after issue', async () => {
  const { signorum, issuer } = await makeSetup(500n)

  await issuer.issue({ animaId: 'anima-1' }, 300n)

  const remaining = await signorum.balance({ animaId: 'anima-1' })
  assert.equal(remaining, 200n)
})

// ── Test 3: tree root advances after issue ────────────────────────────────────

test('tree root changes when another note is issued between issue and spend', async () => {
  const { issuer, tree } = await makeSetup(500n)

  const r1 = await issuer.issue({ animaId: 'anima-1' }, 100n)

  // Another note issued — simulates a different user
  const c2 = await computeCommitment('f'.repeat(64), 'e'.repeat(64))
  await tree.insert(c2, 50n)

  const freshProof = await tree.getProof(r1.note.leafIndex)

  // Root from original issuance is now stale
  assert.notEqual(r1.merkleRoot, await tree.getRoot())
  // Fresh proof root matches current root
  assert.equal(freshProof.root, await tree.getRoot())
})

// ── Test 4: stale root is rejected ───────────────────────────────────────────

test('spend with stale root is rejected even with valid proof', async () => {
  const { issuer, tree, inceptor, modus } = await makeSetup(500n)

  const issuance = await issuer.issue({ animaId: 'anima-1' }, 200n)

  // Another note issued — advances the tree root
  const c2 = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  await tree.insert(c2, 50n)

  // Client uses the STALE root from issuance time — not the current root
  const recipient = computeRecipient(modus.id, {})
  const staleSpend: ArcanumSpendProof = {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root: issuance.merkleRoot,  // stale
      nullifierHash: issuance.note.nullifierHash,
      valor: issuance.note.valor.toString(),
      recipient,
    },
  }

  await assert.rejects(
    () => inceptor.initiate({ modusId: modus.id, aditus: {}, by: { arcanumProof: staleSpend } }),
    /stale root/i,
  )
})

// ── Test 5: double-spend is rejected ─────────────────────────────────────────

test('double-spend is rejected after first successful spend', async () => {
  const { issuer, tree, inceptor, modus } = await makeSetup(500n)

  const issuance = await issuer.issue({ animaId: 'anima-1' }, 200n)
  const freshProof = await tree.getProof(issuance.note.leafIndex)

  const recipient = computeRecipient(modus.id, {})
  const spend: ArcanumSpendProof = {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root: freshProof.root,
      nullifierHash: issuance.note.nullifierHash,
      valor: issuance.note.valor.toString(),
      recipient,
    },
  }

  // First spend succeeds
  await inceptor.initiate({ modusId: modus.id, aditus: {}, by: { arcanumProof: spend } })

  // Second spend with the same nullifierHash fails
  await assert.rejects(
    () => inceptor.initiate({ modusId: modus.id, aditus: {}, by: { arcanumProof: spend } }),
    /double-spend/i,
  )
})

// ── Test 6: recipient mismatch is rejected ────────────────────────────────────

test('spend with wrong recipient is rejected', async () => {
  const { issuer, tree, inceptor, modus } = await makeSetup(500n)

  const issuance = await issuer.issue({ animaId: 'anima-1' }, 200n)
  const freshProof = await tree.getProof(issuance.note.leafIndex)

  const wrongSpend: ArcanumSpendProof = {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root: freshProof.root,
      nullifierHash: issuance.note.nullifierHash,
      valor: issuance.note.valor.toString(),
      recipient: '0',  // wrong — not bound to this modus+aditus
    },
  }

  await assert.rejects(
    () => inceptor.initiate({ modusId: modus.id, aditus: {}, by: { arcanumProof: wrongSpend } }),
    /recipient mismatch/i,
  )
})

// ── Test 7: client-provided commitment (max privacy mode) ─────────────────────

test('client-generated commitment round-trips through issue → spend', async () => {
  const { issuer, tree, inceptor, modus } = await makeSetup(500n)

  // Client generates (nullifier, secret) locally, sends only commitment
  const clientNullifier = 'c'.repeat(64)
  const clientSecret = 'd'.repeat(64)
  const commitment = await computeCommitment(clientNullifier, clientSecret)
  const nullifierHash = await computeNullifierHash(clientNullifier)

  const issuance = await issuer.issue(
    { animaId: 'anima-1' },
    150n,
    { commitment, nullifier: clientNullifier },
  )

  assert.equal(issuance.note.commitment, commitment)
  assert.equal(issuance.note.nullifierHash, nullifierHash)

  // Client proves using their private inputs
  const freshProof = await tree.getProof(issuance.note.leafIndex)
  const recipient = computeRecipient(modus.id, {})
  const spend: ArcanumSpendProof = {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root: freshProof.root,
      nullifierHash,
      valor: '150',
      recipient,
    },
  }

  const actum = await inceptor.initiate({ modusId: modus.id, aditus: {}, by: { arcanumProof: spend } })
  assert.equal(actum.nullifier, nullifierHash)
})

// ── Test 8: note valor insufficient for modus reservation ─────────────────────

test('spend is rejected when note valor < modus reservation', async () => {
  const { issuer, tree, inceptor, modus } = await makeSetup(500n)

  // Issue a note worth 50n, but modus requires 100n
  const issuance = await issuer.issue({ animaId: 'anima-1' }, 50n)
  const freshProof = await tree.getProof(issuance.note.leafIndex)

  const recipient = computeRecipient(modus.id, {})
  const spend: ArcanumSpendProof = {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root: freshProof.root,
      nullifierHash: issuance.note.nullifierHash,
      valor: '50',
      recipient,
    },
  }

  // Asserted by TYPE and FIELDS, not by message shape: the fields are the contract the
  // API boundary reads to render a 402, and a message-shape assertion would pin prose
  // rather than behaviour.
  const err = await inceptor
    .initiate({ modusId: modus.id, aditus: {}, by: { arcanumProof: spend } })
    .then(() => { throw new Error('expected the spend to be rejected') }, (e: unknown) => e)

  assert.ok(err instanceof InsufficientFundsError, `expected InsufficientFundsError, got ${String(err)}`)
  assert.equal(err.balance, 50n)   // the note's valor
  assert.equal(err.required, 100n) // the modus reservation
})

// ── Test 9: bursa purse short of the debit ────────────────────────────────────
//
// The bursa rail's shortfall signal, asserted at its source (`Bursarum.debit`) by TYPE
// and FIELDS. A purse-backed run debits before it creates an actum, so this throw is the
// one an underfunded anonymous run surfaces. `credits` is in PURSE CREDITS — a distinct
// class from the impetus-denominated `InsufficientFundsError` above, so the two units are
// never compared. Hermetic: the collection is a stub, no Mongo.

function stubBursaCollection(doc: Record<string, unknown> | null) {
  return ({
    findOne: async () => doc,
    findOneAndUpdate: async () => doc,
  } as unknown) as ConstructorParameters<typeof MongoBursarium>[0]
}

test('a debit larger than the purse is rejected with the typed bursa shortfall error', async () => {
  const store = new MongoBursarium(stubBursaCollection({ token: 'purse-1', credits: '50', createdAt: new Date() }))

  const err = await store.debit('purse-1', 100n)
    .then(() => { throw new Error('expected the debit to be rejected') }, (e: unknown) => e)

  assert.ok(err instanceof InsufficientBursaCreditsError, `expected InsufficientBursaCreditsError, got ${String(err)}`)
  assert.equal(err.credits, 50n)
  assert.equal(err.required, 100n)
})

test('an unknown purse is a different condition, not a shortfall', async () => {
  const store = new MongoBursarium(stubBursaCollection(null))

  const err = await store.debit('purse-missing', 1n)
    .then(() => { throw new Error('expected the debit to be rejected') }, (e: unknown) => e)

  // A bad token is not an empty purse: it must keep its own handling rather than being
  // absorbed into the shortfall type (and therefore into the 402).
  assert.ok(err instanceof Error)
  assert.ok(!(err instanceof InsufficientBursaCreditsError), 'an unknown purse must not read as a shortfall')
})
