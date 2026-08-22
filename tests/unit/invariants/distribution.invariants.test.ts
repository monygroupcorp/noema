// =============================================================================
// DISTRIBUTION INVARIANTS
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../src/types/nexus.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { modelRoyaltyHook } from '../../../src/ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'
import { referralSplitHook } from '../../../src/ledger/hooks/referralSplit.js'
import { sessionSpendHook } from '../../../src/ledger/hooks/sessionSpend.js'

function buildNexus() {
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  nexus.on('deposit_confirmed', referralSplitHook)
  nexus.on('session_spend', sessionSpendHook)
  return nexus
}

function makeSpendEvent(impetus: bigint, overrides = {}): SignumEvent<'execution_spend'> {
  return {
    type: 'execution_spend',
    payload: {
      actum: { id: 'act-1', modusId: 'mod-1', modusVersiono: '1.0.0', impetus, signaConsumed: [], aditus: {}, status: 'completus' as const, inceptum: new Date(), expirat: new Date(Date.now() + 60_000) },
      impetus,
      baseImpetus: impetus,
      modoHostKey: { animaId: 'anima-host' },
      modusAuctorAnimaId: 'anima-author',
      intellaRoyaltyPayees: [{ animaId: 'anima-model-a', weight: 1 }],
      ...overrides,
    },
  }
}

// ── Total Distribution ≤ Spend ───────────────────────────────────────────────
// RULE: the sum of all hook-produced signa must never exceed the impetus spent.
// If hooks distributed more than 100%, we'd be paying out more than we took in.

test('INVARIANT: total distributed on execution_spend never exceeds impetus', async () => {
  const nexus = buildNexus()
  const impetus = 10_000n
  const signa = await nexus.emit(makeSpendEvent(impetus))

  const totalDistributed = signa.reduce((n, s) => n + s.valor, 0n)
  assert.ok(
    totalDistributed <= impetus,
    `distributed ${totalDistributed} exceeds impetus ${impetus}`
  )
})

test('INVARIANT: distribution holds across a range of impetus values', async () => {
  const nexus = buildNexus()
  const values = [1n, 7n, 100n, 999n, 10_000n, 1_000_000n]

  for (const impetus of values) {
    const signa = await nexus.emit(makeSpendEvent(impetus))
    const total = signa.reduce((n, s) => n + s.valor, 0n)
    assert.ok(total <= impetus, `impetus ${impetus}: distributed ${total} exceeds input`)
  }
})

// ── Hook Purity ──────────────────────────────────────────────────────────────
// RULE: the same event must always produce the same signa.
// Hooks must be deterministic — no randomness, no external state.

test('INVARIANT: same execution_spend event produces identical signa on repeated calls', async () => {
  const nexus = buildNexus()
  const event = makeSpendEvent(1000n)

  const first = await nexus.emit(event)
  const second = await nexus.emit(event)

  assert.equal(first.length, second.length)
  for (let i = 0; i < first.length; i++) {
    assert.equal(first[i].valor, second[i].valor)
    assert.equal(first[i].animaId, second[i].animaId)
    assert.equal(first[i].forma, second[i].forma)
    assert.equal(first[i].auctor, second[i].auctor)
  }
})

// ── Hook Isolation ───────────────────────────────────────────────────────────
// RULE: if one hook throws, the other hooks must still fire.
// A bad hook must not take down the whole distribution pipeline.
// This must hold for every event type, not just execution_spend.

test('INVARIANT: a throwing hook does not prevent other hooks from firing (execution_spend)', async () => {
  const nexus = new Nexus()

  nexus.on('execution_spend', async () => { throw new Error('hook exploded') })
  nexus.on('execution_spend', hostCutHook)

  const signa = await nexus.emit(makeSpendEvent(1000n))

  const hostSigma = signa.filter(s => s.auctor === 'nexus:hostCut')
  assert.equal(hostSigma.length, 1, 'hostCutHook must fire despite earlier hook throwing')
  assert.equal(hostSigma[0].valor, 200n)
})

test('INVARIANT: a throwing hook does not prevent other hooks from firing (deposit_confirmed)', async () => {
  const nexus = new Nexus()

  nexus.on('deposit_confirmed', async () => { throw new Error('hook exploded') })
  nexus.on('deposit_confirmed', referralSplitHook)

  const signa = await nexus.emit({
    type: 'deposit_confirmed',
    payload: {
      signum: { id: 'sig-1', forma: 'eth', valor: 1000n, auctor: 'test', status: 'valid', natum: new Date() },
      referrerAnimaId: 'referrer',
    },
  })

  const referralSigma = signa.filter(s => s.auctor === 'nexus:referralSplit')
  assert.equal(referralSigma.length, 1, 'referralSplitHook must fire despite earlier hook throwing')
  assert.equal(referralSigma[0].valor, 50n)
})

// ── Rate Correctness ─────────────────────────────────────────────────────────
// RULE: each hook's stated rate must be exactly what it charges.
// Rates are a contract with creators and hosts — drifting would be fraud.

test('INVARIANT: host cut is always exactly 20% (floor)', async () => {
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)

  for (const impetus of [100n, 333n, 999n, 10_000n]) {
    const signa = await nexus.emit(makeSpendEvent(impetus))
    const expected = (impetus * 20n) / 100n
    assert.equal(signa[0].valor, expected, `host cut wrong at impetus ${impetus}`)
  }
})

test('INVARIANT: spell royalty is always exactly 10% (floor)', async () => {
  const nexus = new Nexus()
  nexus.on('execution_spend', spellRoyaltyHook)

  for (const impetus of [100n, 333n, 10_000n]) {
    const signa = await nexus.emit(makeSpendEvent(impetus))
    const expected = (impetus * 10n) / 100n
    assert.equal(signa[0].valor, expected, `spell royalty wrong at impetus ${impetus}`)
  }
})

test('INVARIANT: model royalty split is always exactly 5% total divided equally (floor)', async () => {
  const nexus = new Nexus()
  nexus.on('execution_spend', modelRoyaltyHook)

  const impetus = 1000n
  const event = makeSpendEvent(impetus, {
    intellaRoyaltyPayees: [{ animaId: 'model-a', weight: 1 }, { animaId: 'model-b', weight: 1 }, { animaId: 'model-c', weight: 1 }],
  })
  const signa = await nexus.emit(event)

  const totalModel = signa.reduce((n, s) => n + s.valor, 0n)
  const expectedPool = (impetus * 5n) / 100n  // 50n
  // Total distributed ≤ pool (floor division may leave dust)
  assert.ok(totalModel <= expectedPool, 'model royalty must not exceed 5% pool')
  // Each recipient gets an equal share (floor)
  const perShare = expectedPool / 3n   // 16n
  for (const s of signa) {
    assert.equal(s.valor, perShare, 'each model author gets equal share')
  }
})

test('INVARIANT: referral split is always exactly 5% of deposit valor', async () => {
  const nexus = new Nexus()
  nexus.on('deposit_confirmed', referralSplitHook)

  for (const valor of [100n, 333n, 10_000n]) {
    const signa = await nexus.emit({
      type: 'deposit_confirmed',
      payload: {
        signum: { id: 'sig-1', forma: 'eth', valor, auctor: 'test', status: 'valid', natum: new Date() },
        referrerAnimaId: 'referrer',
      },
    })
    const expected = (valor * 5n) / 100n
    assert.equal(signa[0].valor, expected, `referral split wrong at valor ${valor}`)
  }
})

test('INVARIANT: session spend always credits full impetus to platform', async () => {
  const nexus = new Nexus()
  nexus.on('session_spend', sessionSpendHook)

  for (const impetus of [60n, 300n, 10_000n]) {
    const signa = await nexus.emit({
      type: 'session_spend',
      payload: {
        modo: { id: 'modo-1', status: 'active', impetusAccrued: 0n, acta: [], idleWarmthSec: 300, inceptum: new Date() },
        seconds: 60,
        impetus,
      },
    })
    assert.equal(signa[0].valor, impetus, `session spend wrong at impetus ${impetus}`)
  }
})
