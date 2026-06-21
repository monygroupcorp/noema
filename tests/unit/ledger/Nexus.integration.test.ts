import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../src/types/nexus.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { modelRoyaltyHook } from '../../../src/ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'
import { referralSplitHook } from '../../../src/ledger/hooks/referralSplit.js'

function buildNexus(): Nexus {
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  nexus.on('deposit_confirmed', referralSplitHook)
  return nexus
}

// Rates: host 20%, spell 10%, model 5% (split), platform skim 5% of baseValor

test('execution_spend: all three hooks fire and signa are collected', async () => {
  const nexus = buildNexus()

  const event: SignumEvent<'execution_spend'> = {
    type: 'execution_spend',
    payload: {
      actum: {
        id: 'act-1', modusId: 'mod-1', modusVersiono: '1.0.0',
        impetus: 1000n, signaConsumed: [], aditus: {},
        status: 'completed', inceptum: new Date(),
      },
      impetus: 1000n,
      modoHostAnimaId: 'anima-host',
      modusAuctorAnimaId: 'anima-spell-author',
      intellaRoyaltyPayees: [{ animaId: 'anima-model-a', weight: 1 }, { animaId: 'anima-model-b', weight: 1 }],
    },
  }

  const signa = await nexus.emit(event)

  // host 200, spell 100, model-a 25, model-b 25 → 4 signa
  assert.equal(signa.length, 4)

  const host = signa.find(s => s.animaId === 'anima-host')
  const spell = signa.find(s => s.animaId === 'anima-spell-author')
  const modelA = signa.find(s => s.animaId === 'anima-model-a')
  const modelB = signa.find(s => s.animaId === 'anima-model-b')

  assert.ok(host, 'host signum missing')
  assert.ok(spell, 'spell royalty signum missing')
  assert.ok(modelA, 'model-a signum missing')
  assert.ok(modelB, 'model-b signum missing')

  assert.equal(host!.valor, 200n)
  assert.equal(spell!.valor, 100n)
  assert.equal(modelA!.valor, 25n)
  assert.equal(modelB!.valor, 25n)
})

test('royalty_fired: platform skim hook fires; execution_spend hooks are silent', async () => {
  const nexus = buildNexus()

  const signa = await nexus.emit({
    type: 'royalty_fired',
    payload: { actumId: 'act-1', royaltyValor: 350n, baseValor: 1000n },
  })

  assert.equal(signa.length, 1)
  assert.equal(signa[0].valor, 50n)   // 5% of 1000
  assert.equal(signa[0].auctor, 'nexus:platformSkim')
})

test('deposit_confirmed: referral hook fires; other hooks are silent', async () => {
  const nexus = buildNexus()

  const signa = await nexus.emit({
    type: 'deposit_confirmed',
    payload: {
      signum: {
        id: 'sig-1', forma: 'eth', valor: 1000n, auctor: 'deposit-watcher',
        status: 'valid', natum: new Date(),
      },
      referrerAnimaId: 'anima-referrer',
    },
  })

  assert.equal(signa.length, 1)
  assert.equal(signa[0].valor, 50n)   // 5% of 1000
  assert.equal(signa[0].animaId, 'anima-referrer')
})

test('execution_spend with no optional fields produces no signa', async () => {
  const nexus = buildNexus()

  const signa = await nexus.emit({
    type: 'execution_spend',
    payload: {
      actum: {
        id: 'act-bare', modusId: 'mod-1', modusVersiono: '1.0.0',
        impetus: 1000n, signaConsumed: [], aditus: {},
        status: 'completed', inceptum: new Date(),
      },
      impetus: 1000n,
      // no host, no spell author, no model authors
    },
  })

  assert.deepEqual(signa, [])
})
