// =============================================================================
// noema-314 — an undeclared aditus key is refused at the run-submit boundary
// =============================================================================
//
// `invokeFlow` is where third-party input enters: it diffs the submitted aditus against the
// resolved modus's declared ports and refuses the first key the flow does not declare with
// `input.invalid_aditus` (422). An undeclared key is not carried into the run — it never
// reaches a cursor — so accepting one bills a run that does different work than the caller
// asked for. A mistyped port is a request error, and this is where it is named.
//
// The tolerance INSIDE the system is unchanged: `validateAditus` still strips at every
// internal call site (single ports are validated there during draft edits, where a blanket
// throw is the wrong shape). These tests pin the boundary only.
//
// REACHED-DISPATCH SENTINEL: the refusal lands above `dispatchInceptio`, whose first real act
// is `inceptor.initiate`. The inceptor double therefore records the inceptio and throws a
// sentinel, so "refused" and "ran unchanged" are two distinguishable outcomes without standing
// up a cursor, a ledger or a store. A test that asserts a refusal also asserts the inceptor was
// never called — a refusal that still reserved would pass the first assertion and fail the
// second. (Harness shape shared with `ownedResourceValidation.test.ts`, same boundary.)
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { CANONICAL_MODI } from '../../../../src/crystal/seeds/modi.js'
import { hashModus } from '../../../../src/crystal/hashModus.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { Inceptio } from '../../../../src/types/cursus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const CALLER: AuctorKey = { animaId: 'anima-caller' }
const REACHED_DISPATCH = 'reached-dispatch'

interface Harness {
  api: CrystalApi
  /** The inceptio dispatch was reached with, or undefined when the run was refused. */
  dispatched: () => Inceptio | undefined
}

function harness(modi: Modus[]): Harness {
  let seen: Inceptio | undefined
  const deps = {
    modorum: { async find(id: string) { return modi.find(m => m.id === id) ?? null } },
    inceptor: {
      async initiate(inceptio: Inceptio) {
        seen = inceptio
        throw new Error(REACHED_DISPATCH)
      },
    },
    cursorum: { resolve() { throw new Error('cursor must not resolve on a refused run') } },
    completor: {},
  }
  return { api: new CrystalApi(deps as unknown as CrystalApiDeps), dispatched: () => seen }
}

/** Assert the submit was refused as bad input, naming `key`, with nothing dispatched. */
async function assertRefused(
  h: Harness, modusId: string, aditus: Record<string, unknown>, key: string,
): Promise<void> {
  await assert.rejects(
    () => h.api.invokeFlow(CALLER, { modusId }, aditus),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, 'refused as a request error, not a 500')
      assert.equal(err.code, 'input.invalid_aditus')
      assert.equal(err.httpStatus, 422)
      const details = err.toBody().details as { undeclared?: string } | undefined
      assert.equal(details?.undeclared, key, 'the offending key is named')
      assert.equal(
        Object.keys(details ?? {}).length, 1,
        'only the offending key: not its value, and not the ports the flow does declare',
      )
      return true
    },
  )
  assert.equal(h.dispatched(), undefined, 'nothing was dispatched: no actum, no reservation, no pod')
}

/** Assert the submit passed the boundary and reached dispatch. */
async function assertReachedDispatch(
  h: Harness, modusId: string, aditus: Record<string, unknown>,
): Promise<Inceptio> {
  await assert.rejects(
    () => h.api.invokeFlow(CALLER, { modusId }, aditus),
    (err: unknown) => err instanceof Error && err.message === REACHED_DISPATCH,
  )
  const inceptio = h.dispatched()
  assert.ok(inceptio, 'dispatch was reached')
  return inceptio
}

const seed = (id: string): Modus => {
  const found = CANONICAL_MODI.find(m => m.id === id)
  assert.ok(found, `seed ${id} is present`)
  return found
}

// ── The class: an arbitrary modus, so nothing here rides on one seed's port names ──

const TEST_MODUS: Modus = (() => {
  const def: Omit<Modus, 'contentHash'> = {
    id: 'modus.test-declared-ports',
    nomen: 'A modus with one required port and one optional one',
    genus: 'atomicus',
    versio: '1.0.0',
    ministerium: 'test',
    canonica: false,
    aditus: {
      prompt: { type: 'text', required: true },
      seed: { type: 'int', required: false },
    },
    exitus: {},
    natum: new Date(0),
    mutatum: new Date(0),
  }
  return { ...def, contentHash: hashModus({ ...def, contentHash: '' }) }
})()

test('a key the flow does not declare is refused, and nothing is dispatched', async () => {
  const h = harness([TEST_MODUS])
  await assertRefused(h, TEST_MODUS.id, { prompt: 'a dragon', sed: 7 }, 'sed')
})

test('the refusal names the offending key, not the value it carried', async () => {
  const h = harness([TEST_MODUS])
  await assert.rejects(
    () => h.api.invokeFlow(CALLER, { modusId: TEST_MODUS.id }, { prompt: 'a dragon', sed: 'a-secret-value' }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(JSON.stringify(err.toBody()).includes('a-secret-value'), false)
      return true
    },
  )
})

test('a declared-only submit runs, and its aditus reaches dispatch untouched', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { prompt: 'a dragon', seed: 7 })
  assert.deepEqual(inceptio.aditus, { prompt: 'a dragon', seed: 7 })
})

test('an optional port may be absent — the boundary checks what was sent, not what was left out', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { prompt: 'a dragon' })
  assert.deepEqual(inceptio.aditus, { prompt: 'a dragon' })
})

test('an empty submit is not a refusal (a required port is the execution schema\'s business)', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, {})
  assert.deepEqual(inceptio.aditus, {})
})

test('internal underscore-prefixed channels ride through untouched', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(
    h, TEST_MODUS.id, { prompt: 'a dragon', _attributes: { rarity: 'gold' }, __capability: 'image' },
  )
  assert.deepEqual(inceptio.aditus._attributes, { rarity: 'gold' })
  assert.equal(inceptio.aditus.__capability, 'image')
})

test('an inherited property name is not a declared port', async () => {
  const h = harness([TEST_MODUS])
  await assertRefused(h, TEST_MODUS.id, { prompt: 'a dragon', toString: 'x' }, 'toString')
})

test('a flow whose definition does not resolve is left to the dispatch path', async () => {
  const h = harness([])
  await assertReachedDispatch(h, 'modus.not-registered', { anything: 1 })
})

// ── A live modus: the training submit the app actually sends stays accepted ──

test('the training launch payload the app sends is accepted in full', async () => {
  const training = seed('modus.aitoolkit-training')
  const h = harness([training])
  const inceptio = await assertReachedDispatch(h, training.id, {
    dataset: '[{"url":"https://example.invalid/1.png"}]',
    baseModel: 'klein-4b',
    triggerWord: 'trigword',
    steps: 1000,
    name: 'trigword',
    autocaption: true,
  })
  assert.equal(inceptio.aditus.triggerWord, 'trigword')
})

test('a misspelled training port is refused before a pod is provisioned', async () => {
  const training = seed('modus.aitoolkit-training')
  const h = harness([training])
  await assertRefused(h, training.id, {
    dataset: '[{"url":"https://example.invalid/1.png"}]',
    baseModel: 'klein-4b',
    triggerWord: 'trigword',
    steps: 1000,
    autocaptionn: true,
  }, 'autocaptionn')
})
