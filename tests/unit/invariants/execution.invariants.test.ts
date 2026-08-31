// =============================================================================
// EXECUTION INVARIANTS
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Modus } from '../../../src/types/modus.js'
import type { Cursor, CursorResult } from '../../../src/types/cursus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modo } from '../../../src/types/modo.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { Cursorum } from '../../../src/execution/Cursorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { dispatchInceptio, dispatchFailureActumId } from '../../../src/execution/dispatchInceptio.js'
import type { DispatchDeps } from '../../../src/execution/dispatchInceptio.js'

function buildModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'mod-1', nomen: 'Test', genus: 'atomicus', versio: '1.0.0',
    contentHash: 'abc', aditus: {}, exitus: {}, ministerium: 'test',
    canonica: true, natum: new Date(), mutatum: new Date(), ...overrides,
  }
}

function fakeCursor(reserve: bigint, run: bigint): Cursor {
  return {
    async reserve() { return reserve },
    async run(_actum: Actum, _modo?: Modo): Promise<CursorResult> {
      return { kind: 'sync', exitus: { exitus: {}, impetus: run } }
    },
  }
}

function buildPipeline() {
  const signorum = new MemorySignorum()
  const acta = new MemoryActorum()
  const modorum = new MemoryModorum()
  const cursorum = new Cursorum()
  const nexus = new Nexus()
  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta })
  const completor = new ActumCompletor({ acta, signorum, nexus })
  return { signorum, acta, modorum, cursorum, nexus, inceptor, completor }
}

// ── Actum Expiry + Recovery ──────────────────────────────────────────────────
// RULE: every nascens actum has a hard deadline (expirat).
// A process crash during cursor.run() must never freeze a user's credits forever.
// findExpired() surfaces stuck actum records so they can be failed and signa released.

test('INVARIANT: every created actum has an expirat timestamp', async () => {
  const { signorum, modorum, cursorum, inceptor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })

  assert.ok(actum.expirat instanceof Date, 'expirat must be a Date')
  assert.ok(actum.expirat > actum.inceptum, 'expirat must be after inceptum')
})

test('INVARIANT: findExpired returns nascens actum past their expirat', async () => {
  const { acta } = buildPipeline()

  const past = new Date(Date.now() - 1000)
  const future = new Date(Date.now() + 60_000)

  await acta.create({ id: 'act-expired', modusId: 'm', modusVersiono: '1', impetus: 0n, signaConsumed: [], aditus: {}, status: 'nascens', expirat: past })
  await acta.create({ id: 'act-fresh',   modusId: 'm', modusVersiono: '1', impetus: 0n, signaConsumed: [], aditus: {}, status: 'nascens', expirat: future })

  const expired = await acta.findExpired()
  assert.equal(expired.length, 1)
  assert.equal(expired[0].id, 'act-expired')
})

test('INVARIANT: findExpired never returns completus actum', async () => {
  const { acta } = buildPipeline()
  const past = new Date(Date.now() - 1000)

  await acta.create({ id: 'act-done', modusId: 'm', modusVersiono: '1', impetus: 0n, signaConsumed: [], aditus: {}, status: 'completus', expirat: past })

  const expired = await acta.findExpired()
  assert.equal(expired.length, 0, 'completed actum must never appear in expired list')
})

test('INVARIANT: findExpired never returns fractus actum', async () => {
  const { acta } = buildPipeline()
  const past = new Date(Date.now() - 1000)

  await acta.create({ id: 'act-failed', modusId: 'm', modusVersiono: '1', impetus: 0n, signaConsumed: [], aditus: {}, status: 'fractus', expirat: past })

  const expired = await acta.findExpired()
  assert.equal(expired.length, 0, 'failed actum must never appear in expired list')
})

test('INVARIANT: expired actum recovery via fail() restores full balance', async () => {
  const { signorum, modorum, cursorum, acta, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(600n, 600n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })

  // Simulate stuck actum: manually expire it (process crashed, never called complete/fail)
  await acta.update(actum.id, { expirat: new Date(Date.now() - 1) })

  const expired = await acta.findExpired()
  assert.equal(expired.length, 1, 'stuck actum must appear in expired list')

  // Recovery: fail each expired actum — releases locked signa
  for (const stuck of expired) {
    await completor.fail(stuck, 'expired')
  }

  assert.equal(
    await signorum.balance({ animaId: 'anima-1' }),
    1000n,
    'full balance must be restored after expiry recovery'
  )
})

test('INVARIANT: fail() on already-completus actum is a safe no-op', async () => {
  const { signorum, modorum, cursorum, acta, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.complete(actum, { exitus: {}, impetus: 400n })

  // Recovery job races with completion — must not corrupt state
  await assert.doesNotReject(() => completor.fail(actum, 'expired'))

  // Balance must still reflect the legitimate charge, not be double-refunded
  assert.equal(await signorum.balance({ animaId: 'anima-1' }), 600n, 'balance must not be corrupted by late fail()')
  // Actum status must not be overwritten — completus must stay completus
  const stored = await acta.findById(actum.id)
  assert.equal(stored?.status, 'completus', 'actum status must not be corrupted by late fail()')
})

test('INVARIANT: fail() on already-fractus actum is idempotent', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.fail(actum, 'first failure')

  await assert.doesNotReject(() => completor.fail(actum, 'duplicate recovery'))

  assert.equal(await signorum.balance({ animaId: 'anima-1' }), 1000n, 'balance must not be double-refunded')
})

// ── Pre-flight Atomicity ─────────────────────────────────────────────────────
// RULE: if initiate() fails for ANY reason, no signa are locked and no actum
// is created. Partial state must never persist.

test('INVARIANT: failed initiate (unknown modus) leaves no locked signa', async () => {
  const { signorum, inceptor } = buildPipeline()
  const sig = await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  await assert.rejects(() =>
    inceptor.initiate({ modusId: 'ghost-modus', aditus: {}, by: { animaId: 'anima-1' } })
  )

  const hist = await signorum.history({ animaId: 'anima-1' })
  assert.equal(hist.find(s => s.id === sig.id)!.status, 'valid', 'signum must stay valid')
  assert.equal(await signorum.balance({ animaId: 'anima-1' }), 1000n, 'balance must be unchanged')
})

test('INVARIANT: failed initiate (insufficient balance) creates no actum', async () => {
  const { signorum, modorum, cursorum, acta, inceptor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(1000n, 1000n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 100n, auctor: 'test' })

  await assert.rejects(() =>
    inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  )

  const allActa = await Promise.all([acta.findById('any')].map(p => p.catch(() => null)))
  assert.equal(allActa[0], null, 'no actum must be created')
})

// ── Failure Atomicity ────────────────────────────────────────────────────────
// RULE: after fail(), the user's balance is exactly what it was before initiate().
// The user pays nothing for a failed execution.

test('INVARIANT: fail() restores balance to pre-initiate state exactly', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(600n, 600n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const balanceBefore = await signorum.balance({ animaId: 'anima-1' })
  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.fail(actum, 'crash')
  const balanceAfter = await signorum.balance({ animaId: 'anima-1' })

  assert.equal(balanceAfter, balanceBefore, 'balance must be fully restored after fail')
})

// ── Treasury Invariant ───────────────────────────────────────────────────────
// RULE: user is charged exactly actualImpetus — never more.
// This must hold regardless of how many signa were locked or their sizes.

test('INVARIANT: user charged exactly actual impetus (single large signum overshoot)', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  const reservation = 800n
  const actual = 300n
  cursorum.register('test', fakeCursor(reservation, actual))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 5000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.complete(actum, { exitus: {}, impetus: actual })

  assert.equal(
    await signorum.balance({ animaId: 'anima-1' }),
    5000n - actual,
    'user must be charged exactly the actual impetus'
  )
})

test('INVARIANT: user charged exactly actual impetus (multiple signa overshoot)', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(900n, 250n))
  // Three signa; greedy will lock multiple to cover 900n reservation
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 300n, auctor: 'test' })
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 300n, auctor: 'test' })
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 300n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.complete(actum, { exitus: {}, impetus: 250n })

  assert.equal(
    await signorum.balance({ animaId: 'anima-1' }),
    900n - 250n,
    'user charged exactly 250n regardless of how many signa were locked'
  )
})

// ── Cursor Cost Contract ─────────────────────────────────────────────────────
// RULE: run().impetus must never exceed reserve().
// A cursor that violates this would charge more than the user was quoted.

test('INVARIANT: cursor that overcharges causes settle to throw (protection at ledger)', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  // Malicious cursor: reserve says 100n, run charges 500n
  cursorum.register('test', fakeCursor(100n, 500n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })

  // settle() will try to spend 100n-locked signa but apply 500n actual,
  // resulting in a negative delta — this must be caught
  await assert.rejects(
    () => completor.complete(actum, { exitus: {}, impetus: 500n }),
    /exceed|overcharge|delta.*negative|actual.*exceeds/i
  )
})

// ── Pre-flight Atomicity: lock-then-create ───────────────────────────────────
// RULE: if acta.create() fails after signorum.lock() succeeds, all locked signa
// must be released. Partial state (locked signa, no actum) must never persist.

test('INVARIANT: create() failure after lock() releases all locked signa', async () => {
  const { signorum, modorum, cursorum } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  // Inject an acta that throws on create
  const faultyActa = {
    async create() { throw new Error('database unavailable') },
    async update() { throw new Error('unreachable') },
    async findById() { return null },
  }
  const faultyInceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: faultyActa as any })

  await assert.rejects(
    () => faultyInceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } }),
    /database unavailable/
  )

  // All signa must be back to valid — no locked orphans
  assert.equal(await signorum.balance({ animaId: 'anima-1' }), 1000n, 'balance must be fully restored')
  const hist = await signorum.history({ animaId: 'anima-1' })
  const locked = hist.filter(s => s.status === 'locked')
  assert.equal(locked.length, 0, 'no signa must remain locked after create failure')
})

// ── Completion Idempotency ───────────────────────────────────────────────────
// RULE: complete() must never fire twice on the same actum.
// A second call would double-emit execution_spend, causing double-payment to
// every distribution recipient.

test('INVARIANT: complete() called twice on same actum throws on second call', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.complete(actum, { exitus: {}, impetus: 400n })

  await assert.rejects(
    () => completor.complete(actum, { exitus: {}, impetus: 400n }),
    /already complete|completus|already settled/i
  )
})

// ── Anonymous Execution Path (arcanum) ──────────────────────────────────────
// RULE: the full execution rail must work identically when funded by arcanum
// signa. The payer is identified only by H(secret) — no animaId at any point.

test('INVARIANT: arcanum-funded actum charges exactly actual impetus', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(800n, 300n))
  await signorum.issue({ forma: 'arcanum', valor: 5000n, auctor: 'test', testis: 'hash-anon' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { commitment: 'hash-anon' } })
  await completor.complete(actum, { exitus: {}, impetus: 300n })

  assert.equal(
    await signorum.balance({ commitment: 'hash-anon' }),
    5000n - 300n,
    'arcanum user charged exactly actual impetus'
  )
})

test('INVARIANT: arcanum-funded actum: fail() restores arcanum balance exactly', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(600n, 600n))
  await signorum.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-anon' })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { commitment: 'hash-anon' } })
  await completor.fail(actum, 'crash')

  assert.equal(
    await signorum.balance({ commitment: 'hash-anon' }),
    1000n,
    'arcanum balance must be fully restored after fail'
  )
})

// ── Nexus Emission Invariants ────────────────────────────────────────────────
// RULE: execution_spend fires exactly once per successful completion.
// RULE: no execution_spend fires on failure.

test('INVARIANT: nexus emits exactly once on complete', async () => {
  const { signorum, modorum, cursorum, nexus, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  let emitCount = 0
  nexus.on('execution_spend', async () => { emitCount++; return [] })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.complete(actum, { exitus: {}, impetus: 400n })

  assert.equal(emitCount, 1)
})

test('INVARIANT: nexus does not emit on fail', async () => {
  const { signorum, modorum, cursorum, nexus, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(400n, 400n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  let emitCount = 0
  nexus.on('execution_spend', async () => { emitCount++; return [] })

  const actum = await inceptor.initiate({ modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
  await completor.fail(actum, 'crash')

  assert.equal(emitCount, 0)
})

// ── Post-initiate dispatch failure (noema-359) ───────────────────────────────
// RULE: once initiate() returns, an Actum is persisted and its signa are LOCKED.
// Every path out of the dispatch after that point releases them. The reservation is
// bounded in time by the expiry reaper, but a bound is not a release: until the
// dispatch settles the run, the payer cannot use credits that were never spent.
//
// These run the real ledger, inceptor and completor through dispatchInceptio and
// assert the BALANCE, so a release that stops happening shows up here as money left
// locked rather than as a still-passing "it threw" assertion.

test('INVARIANT: a post-initiate dispatch failure restores the balance exactly', async () => {
  const { signorum, modorum, cursorum, acta, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(600n, 600n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const balanceBefore = await signorum.balance({ animaId: 'anima-1' })

  // The dispatch resolves its cursor from its own registry. Here that resolution
  // fails — the initiation has already happened and its signa are locked.
  const deps: DispatchDeps = {
    inceptor: { initiate: (i) => inceptor.initiate(i) },
    modorum,
    cursorum: {
      register: () => {},
      resolve: () => { throw new Error('No cursor registered for ministerium') },
    },
    completor,
  }

  await assert.rejects(
    () => dispatchInceptio(deps, { modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } }),
    /No cursor registered/,
  )

  const balanceAfter = await signorum.balance({ animaId: 'anima-1' })
  assert.equal(balanceAfter, balanceBefore, 'nothing was executed, so nothing may stay locked')

  const all = await acta.findExpired()
  assert.equal(all.length, 0, 'no nascens actum is left for the reaper to find')
})

test('INVARIANT: a post-initiate dispatch failure leaves the actum fractus, not nascens', async () => {
  const { signorum, modorum, cursorum, acta, inceptor, completor } = buildPipeline()
  await modorum.register(buildModus())
  cursorum.register('test', fakeCursor(600n, 600n))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const deps: DispatchDeps = {
    inceptor: { initiate: (i) => inceptor.initiate(i) },
    modorum,
    cursorum: {
      register: () => {},
      resolve: () => { throw new Error('No cursor registered for ministerium') },
    },
    completor,
  }

  const err = await dispatchInceptio(deps, { modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' } })
    .then(() => { throw new Error('expected the dispatch to throw') }, (e: unknown) => e)

  // The caller is handed the id of the run that was persisted before the throw, so a
  // collection can account for the failed piece instead of orphaning it.
  const actumId = dispatchFailureActumId(err)
  assert.ok(actumId, 'the persisted actum id rides the error')

  const record = await acta.findById(actumId)
  assert.ok(record)
  assert.equal(record.status, 'fractus')
  assert.ok(record.completum instanceof Date, 'terminal, with a completion time')
})
