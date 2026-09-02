import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
import { reservationImpetus, GENERIC_RESERVE_IMPETUS } from '../../../../src/ledger/rates.js'

// An under-reservation is not a mis-price, it is a LOST RUN: `ActumCompletor` throws
// `Cursor overcharge` when the measured cost exceeds the hold, so the run fails after the pod
// time is spent and the output exists. rates.ts calls this out as the asymmetric failure and
// sizes its 2x factor for it.
//
// The MiniMax H3 flows measured 871 impetus on their first cold run against the generic 900 —
// a 3.3% margin on a cost dominated by a 56 GB download whose duration varies with mirror
// throughput. This pins that they no longer ride the generic reserve.

/** Measured on the first successful t2v run (cold, RTX 4090 @ $0.74/hr), 2026-09-02. */
const H3_MEASURED_IMPETUS = 871
const H3_FLOWS = ['minimax-h3-t2v', 'minimax-h3-fl2v', 'minimax-h3-ref2v']

/** What `RunPodCursor.reserve()` will hold for a flow, clamp included. */
function reserveFor(id: string): bigint {
  const e = CANONICAL_ESSENTIAE.find(x => x.id === id)
  assert.ok(e, `no essentia '${id}'`)
  if (e.impetusFixum !== undefined) return e.impetusFixum
  const fitted = e.pretium
    ? reservationImpetus({ pretium: e.pretium, forma: e.aditus, aditus: {} })
    : null
  const base = fitted ?? GENERIC_RESERVE_IMPETUS
  const ceiling = 1800n              // config.maxJobSeconds default
  return base < ceiling ? base : ceiling
}

for (const id of H3_FLOWS) {
  test(`${id} reserves more than its measured cold cost`, () => {
    const held = reserveFor(id)
    assert.ok(
      held > BigInt(H3_MEASURED_IMPETUS),
      `${id} holds ${held} against a measured ${H3_MEASURED_IMPETUS} — an under-reservation ` +
      'throws Cursor overcharge and destroys a completed run',
    )
  })

  test(`${id} keeps real margin over the measured cost, not a rounding sliver`, () => {
    const held = Number(reserveFor(id))
    const margin = held / H3_MEASURED_IMPETUS
    assert.ok(margin >= 1.5,
      `${id} holds only ${margin.toFixed(2)}x the measured cost; the generic reserve's 1.03x is ` +
      'what this test exists to prevent')
  })
}

test('the H3 flows declare a curve rather than riding the generic reserve', () => {
  for (const id of H3_FLOWS) {
    const e = CANONICAL_ESSENTIAE.find(x => x.id === id)!
    assert.ok(e.pretium?.baseSeconds, `${id} must declare its own cost curve`)
  }
})

test('the generic reserve would NOT have covered it (the guard is not vacuous)', () => {
  assert.ok(Number(GENERIC_RESERVE_IMPETUS) / H3_MEASURED_IMPETUS < 1.1,
    'if the generic reserve ever grows past this, revisit whether these curves are still needed')
})
