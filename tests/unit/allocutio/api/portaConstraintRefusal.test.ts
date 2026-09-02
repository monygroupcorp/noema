// =============================================================================
// noema-396 — an illegal numeric input is refused at the run-submit boundary
// =============================================================================
//
// `Porta.min/max/step` declares what a numeric port will accept. `invokeFlow` is where third-party
// input enters, and it is where a violation is refused — above the `Inceptio` literal, so the
// refusal reserves nothing, creates no actum and provisions no pod.
//
// This is the whole point of the item. `minimax-h3-t2v` with `frames: 100` used to provision a
// pod, pull 56 GB of weights over ~12 minutes and fail at execution: ~28 minutes and real GPU
// spend to reject an input that was illegal before the run started. The cost of the refusal is
// what these tests pin, not just the refusal.
//
// REACHED-DISPATCH SENTINEL: the inceptor double records the inceptio and throws a sentinel, so
// "refused" and "ran unchanged" are two distinguishable outcomes without standing up a cursor, a
// ledger or a store. A test that asserts a refusal also asserts the inceptor was never called — a
// refusal that still reserved would pass the first assertion and fail the second. (Harness shape
// shared with `undeclaredAditusRefusal.test.ts` / `ownedResourceValidation.test.ts`, same
// boundary.)
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
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

/** Assert the submit was refused as bad input naming `porta`, with nothing dispatched. */
async function assertRefused(
  h: Harness, modusId: string, aditus: Record<string, unknown>, porta: string,
): Promise<ApiError> {
  let captured: ApiError | undefined
  await assert.rejects(
    () => h.api.invokeFlow(CALLER, { modusId }, aditus),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, 'refused as a request error, not a 500')
      assert.equal(err.code, 'input.invalid_aditus')
      assert.equal(err.httpStatus, 422)
      assert.equal((err.toBody().details as { porta?: string })?.porta, porta)
      captured = err
      return true
    },
  )
  assert.equal(h.dispatched(), undefined, 'nothing was dispatched: no actum, no reservation, no pod')
  return captured as ApiError
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
  const found = CANONICAL_ESSENTIAE.find(m => m.id === id)
  assert.ok(found, `seed ${id} is present`)
  return found
}

// ── The class: an arbitrary modus, so nothing here rides on one seed's port names ──

const TEST_MODUS: Modus = (() => {
  const def: Omit<Modus, 'contentHash'> = {
    id: 'modus.test-constrained-port',
    nomen: 'A modus with one constrained port and one free one',
    genus: 'atomicus',
    versio: '1.0.0',
    ministerium: 'test',
    canonica: false,
    aditus: {
      prompt: { type: 'text', required: true },
      length: { type: 'int', required: false, default: 5, min: 5, step: 17 },
      free: { type: 'int', required: false },
    },
    exitus: {},
    natum: new Date(0),
    mutatum: new Date(0),
  }
  return { ...def, contentHash: hashModus({ ...def, contentHash: '' }) }
})()

test('a value that violates a declared constraint is refused, and nothing is dispatched', async () => {
  const h = harness([TEST_MODUS])
  await assertRefused(h, TEST_MODUS.id, { prompt: 'a dragon', length: 100 }, 'length')
})

test('the refusal message NAMES THE RULE, so the caller can fix it without a second run', async () => {
  const h = harness([TEST_MODUS])
  const err = await assertRefused(h, TEST_MODUS.id, { prompt: 'a dragon', length: 100 }, 'length')
  assert.match(err.message, /length/)
  assert.match(err.message, /5 or more/)
  assert.match(err.message, /steps of 17/)
  assert.match(err.message, /got 100/)
  assert.equal((err.toBody().details as { regula?: string })?.regula, '5 or more, in steps of 17 from 5 (5, 22, 39, …)')
})

test('a legal value is unaffected and reaches dispatch untouched', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { prompt: 'a dragon', length: 22 })
  assert.deepEqual(inceptio.aditus, { prompt: 'a dragon', length: 22 })
})

test('an unconstrained port on the same modus is not policed', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { prompt: 'a dragon', free: -9999 })
  assert.deepEqual(inceptio.aditus, { prompt: 'a dragon', free: -9999 })
})

test('an omitted constrained port is not a refusal — its own default applies downstream', async () => {
  const h = harness([TEST_MODUS])
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { prompt: 'a dragon' })
  assert.deepEqual(inceptio.aditus, { prompt: 'a dragon' })
})

// ── The live flow this item exists for ───────────────────────────────────────

test('minimax-h3-t2v: frames: 100 costs a 422, not a pod and 56 GB of weights', async () => {
  const h3 = seed('minimax-h3-t2v')
  const h = harness([h3])
  const err = await assertRefused(h, h3.id, { prompt: 'a newsreader speaking', frames: 100 }, 'frames')
  assert.match(err.message, /steps of 17/, 'the caller is told the actual H3 rule')
})

test('minimax-h3-t2v: the flow default (209 = 17*12+5) still runs', async () => {
  const h3 = seed('minimax-h3-t2v')
  const h = harness([h3])
  const inceptio = await assertReachedDispatch(h, h3.id, { prompt: 'a newsreader speaking', frames: 209 })
  assert.equal(inceptio.aditus.frames, 209)
})

test('all three minimax-h3 flows refuse an off-step clip length before reserving', async () => {
  for (const id of ['minimax-h3-t2v', 'minimax-h3-fl2v', 'minimax-h3-ref2v']) {
    const flow = seed(id)
    const h = harness([flow])
    await assertRefused(h, id, { prompt: 'x', frames: 200 }, 'frames')
  }
})

test('wan22 declares no frame rule, so its ports are untouched by this boundary', async () => {
  // Deliberate (noema-396): H3's rule was verified, Wan2.2's was not, and a guessed constraint
  // would refuse runs that work today. If this starts failing, someone declared one — measure it
  // on a pod first.
  const submits: Record<string, Record<string, unknown>> = {
    'wan22-t2v': { prompt: 'x', frames: 100 },
    'wan22-i2v': { prompt: 'x', image: 'https://example.invalid/a.png', frames: 100 },
  }
  for (const [id, aditus] of Object.entries(submits)) {
    const h = harness([seed(id)])
    const inceptio = await assertReachedDispatch(h, id, aditus)
    assert.equal(inceptio.aditus.frames, 100)
  }
})
