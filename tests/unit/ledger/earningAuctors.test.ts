import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../src/types/nexus.js'
import { EARNING_AUCTORS, EARNING_AUCTOR_IDS, EARNING_KIND_ORDER, earningKind } from '../../../src/ledger/earnings.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { modelRoyaltyHook } from '../../../src/ledger/hooks/modelRoyalty.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { hospitiumHook } from '../../../src/ledger/hooks/hospitium.js'
import { referralSplitHook } from '../../../src/ledger/hooks/referralSplit.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'
import { sessionSpendHook } from '../../../src/ledger/hooks/sessionSpend.js'
import { studioSpendHook } from '../../../src/ledger/hooks/studioSpend.js'

// The drift guard behind GET /v1/me/earnings. `EARNING_AUCTORS` is a hand-written list of the
// auctors that mean "this person was paid for their own work", and the read filters on it — so
// a new earning stream whose auctor is missing from that list would pay people money they could
// never see. These tests run the hooks and hold the list to what they actually emit.

const actum = {
  id: 'act-1',
  modusId: 'mod-1',
  modusVersiono: '1.0.0',
  impetus: 1000n,
  signaConsumed: [],
  aditus: {},
  status: 'completus' as const,
  inceptum: new Date(),
  expirat: new Date(Date.now() + 60_000),
  materiamId: 'studio-1',
}

function spendEvent(overrides: Partial<SignumEvent<'execution_spend'>['payload']> = {}): SignumEvent<'execution_spend'> {
  return { type: 'execution_spend', payload: { actum, impetus: 1000n, baseImpetus: 1000n, ...overrides } }
}

test('every earning hook emits an auctor the earnings list knows', async () => {
  const emitted = [
    ...await spellRoyaltyHook(spendEvent({ modusAuctorAnimaId: 'author-1' })),
    ...await modelRoyaltyHook(spendEvent({ intellaRoyaltyPayees: [{ animaId: 'trainer-1', weight: 1 }] })),
    ...await hostCutHook(spendEvent({ modoHostKey: { animaId: 'host-1' } })),
    ...await hospitiumHook(spendEvent({ modoHostKey: { animaId: 'host-1' } })),
    ...await referralSplitHook({
      type: 'deposit_confirmed',
      payload: {
        signum: { id: 's-1', animaId: 'newcomer', forma: 'eth', valor: 10_000n, auctor: 'deposit', status: 'valid', natum: new Date() },
        referrerAnimaId: 'referrer-1',
      },
    }),
  ]

  assert.ok(emitted.length > 0, 'the hooks must actually emit — a silent [] would vacuously pass')
  for (const s of emitted) {
    assert.ok(
      earningKind(s.auctor),
      `${s.auctor} pays a person but is not in EARNING_AUCTORS — it would be invisible at GET /v1/me/earnings`,
    )
  }
  // …and every stream the list claims is one a hook really produces.
  const seen = new Set(emitted.map(s => s.auctor))
  for (const auctor of EARNING_AUCTOR_IDS) {
    assert.ok(seen.has(auctor), `${auctor} is listed as an earning stream but no hook emitted it`)
  }
})

test('the platform book is not an earning', async () => {
  // These three credit PLATFORM_ANIMA_ID — the platform's own revenue, not a payee's work.
  // Listing one would report the house's takings on every account that shares its anima id.
  const platform = [
    ...await platformSkimHook({ type: 'royalty_fired', payload: { actumId: 'act-1', royaltyValor: 100n, baseValor: 1000n } }),
    ...await sessionSpendHook({ type: 'session_spend', payload: { modo: { id: 'modo-1' } as never, seconds: 10, impetus: 100n } }),
    ...await studioSpendHook({ type: 'studio_spend', payload: { materiaId: 'studio-1', hostKey: { animaId: 'host-1' }, impetus: 100n, seconds: 10 } }),
  ]

  assert.ok(platform.length > 0)
  for (const s of platform) {
    assert.equal(earningKind(s.auctor), undefined, `${s.auctor} is the platform's own book and must not be an earning`)
  }
})

test('every listed auctor has a display order, and every ordered kind is listed', () => {
  const kinds = new Set(Object.values(EARNING_AUCTORS))
  assert.deepEqual([...EARNING_KIND_ORDER].sort(), [...kinds].sort())
})
