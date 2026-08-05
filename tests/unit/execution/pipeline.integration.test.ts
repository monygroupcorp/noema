import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Modus } from '../../../src/types/modus.js'
import type { Cursor } from '../../../src/types/cursus.js'
import type { Exitus } from '../../../src/types/cursus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modo } from '../../../src/types/modo.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { Cursorum } from '../../../src/execution/Cursorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'

// A minimal cursor that returns a known result for tests
function makeFakeCursor(impetusToCharge: bigint): Cursor {
  return {
    async reserve(_modus: Modus, _aditus: Record<string, unknown>) {
      return impetusToCharge
    },
    async run(_actum: Actum, _modo?: Modo): Promise<Exitus> {
      return { exitus: { result: 'ok' }, impetus: impetusToCharge }
    },
  }
}

function buildModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'mod-test',
    nomen: 'Test Tool',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc',
    aditus: {},
    exitus: {},
    ministerium: 'test',
    canonica: true,
    auctor: 'anima-author',
    natum: new Date(),
    mutatum: new Date(),
    ...overrides,
  }
}

function buildPipeline() {
  const signorum = new MemorySignorum()
  const acta = new MemoryActorum()
  const modorum = new MemoryModorum()
  const cursorum = new Cursorum()
  const nexus = new Nexus()

  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)

  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta })
  const completor = new ActumCompletor({ acta, signorum, nexus })

  return { signorum, acta, modorum, cursorum, nexus, inceptor, completor }
}

// ── Full happy path ──────────────────────────────────────────────────────────

test('initiate → complete: actum reaches completus with correct impetus', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()

  const modus = buildModus()
  await modorum.register(modus)
  cursorum.register('test', makeFakeCursor(500n))
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({
    modusId: 'mod-test',
    aditus: {},
    by: { animaId: 'anima-user' },
  })

  assert.equal(actum.status, 'nascens')
  assert.equal(actum.impetus, 500n)

  const result = await completor.complete(actum, { exitus: { result: 'ok' }, impetus: 500n })

  assert.equal(result.status, 'completus')
  assert.equal(result.impetus, 500n)
  assert.ok(result.exitus)
})

test('initiate → complete: user charged exactly actual impetus (overshoot refunded)', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()

  await modorum.register(buildModus())
  cursorum.register('test', makeFakeCursor(400n))
  // Single large signum — greedy locks all 1000n to cover 400n reservation.
  // settle() must refund the 600n delta so user is charged exactly 400n.
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 1000n, auctor: 'test' })

  const actum = await inceptor.initiate({
    modusId: 'mod-test',
    aditus: {},
    by: { animaId: 'anima-user' },
  })

  await completor.complete(actum, { exitus: {}, impetus: 400n })

  // 1000n locked, 400n consumed, 600n refunded — net charge = 400n
  assert.equal(await signorum.balance({ animaId: 'anima-user' }), 600n)
})

test('initiate: throws when balance is insufficient', async () => {
  const { signorum, modorum, cursorum, inceptor } = buildPipeline()

  await modorum.register(buildModus())
  cursorum.register('test', makeFakeCursor(1000n))
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 100n, auctor: 'test' })

  await assert.rejects(
    () => inceptor.initiate({ modusId: 'mod-test', aditus: {}, by: { animaId: 'anima-user' } }),
    /insufficient/i
  )
})

test('fail: releases locked signa back to balance', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()

  await modorum.register(buildModus())
  cursorum.register('test', makeFakeCursor(600n))
  // Issue two signa; greedy selects both to cover 600n (400 + 600 = 1000 ≥ 600)
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 400n, auctor: 'test' })
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 600n, auctor: 'test' })

  const actum = await inceptor.initiate({
    modusId: 'mod-test',
    aditus: {},
    by: { animaId: 'anima-user' },
  })

  // Both signa are locked during execution — balance is 0
  assert.equal(await signorum.balance({ animaId: 'anima-user' }), 0n)

  await completor.fail(actum, 'pod crashed')

  // All locked signa released via release() — full 1000n restored
  assert.equal(await signorum.balance({ animaId: 'anima-user' }), 1000n)
})

test('fail: actum reaches fractus with error set', async () => {
  const { signorum, modorum, cursorum, inceptor, completor } = buildPipeline()

  await modorum.register(buildModus())
  cursorum.register('test', makeFakeCursor(300n))
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 500n, auctor: 'test' })

  const actum = await inceptor.initiate({ modusId: 'mod-test', aditus: {}, by: { animaId: 'anima-user' } })
  const failed = await completor.fail(actum, 'timeout')

  assert.equal(failed.status, 'fractus')
  assert.equal(failed.error, 'timeout')
})

test('complete: nexus hooks fire and produce reward signa', async () => {
  const { signorum, modorum, cursorum, nexus, inceptor, completor } = buildPipeline()

  const modus = buildModus({ auctor: 'anima-author' })
  await modorum.register(modus)
  cursorum.register('test', makeFakeCursor(1000n))
  await signorum.issue({ animaId: 'anima-user', forma: 'minted', valor: 2000n, auctor: 'test' })

  const emitted: Array<{ type: string; signa: unknown[] }> = []
  const origEmit = nexus.emit.bind(nexus)
  nexus.emit = async (event) => {
    const signa = await origEmit(event)
    emitted.push({ type: event.type, signa })
    return signa
  }

  const actum = await inceptor.initiate({
    modusId: 'mod-test',
    aditus: {},
    by: { animaId: 'anima-user' },
  })

  await completor.complete(actum, {
    exitus: {},
    impetus: 1000n,
  })

  // execution_spend should have fired
  const spend = emitted.find(e => e.type === 'execution_spend')
  assert.ok(spend, 'execution_spend event must have been emitted')
})
