// =============================================================================
// Licence terms at the run entry point — MiniMax H3's flow-down obligation
// =============================================================================
//
// MiniMax H3's Community License (Section V.2) requires every user to be bound to its use
// restrictions before they get access, and Section V.5 requires repeat violators to be
// suspended. The H3 flows declare `useTerms: ['minimax-h3']`; these tests pin that a run of one
// is refused until the caller has accepted the current version, refused once the caller is
// suspended, and that a refusal costs nothing.
//
// REACHED-DISPATCH SENTINEL, as in portaConstraintRefusal.test.ts: the inceptor double records
// the inceptio and throws, so "refused" and "would have run" are distinguishable without a
// cursor, ledger or store, and every refusal also asserts nothing was dispatched.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
import { MemoryConsuetudinum } from '../../../../src/crystal/MemoryConsuetudinum.js'
import { USE_TERMS, useTermsVerdict } from '../../../../src/crystal/useTerms.js'
import { ownerKeyOf } from '../../../../src/crystal/ownerKey.js'
import { useTermsCopy } from '../../../../src/flow/flows/ExecuteFlow.js'
import type { Gradus, Modus } from '../../../../src/types/modus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const CALLER: AuctorKey = { animaId: 'anima-caller' }
const REACHED_DISPATCH = 'reached-dispatch'
const H3 = USE_TERMS['minimax-h3']
const H3_IDS = ['minimax-h3-t2v', 'minimax-h3-fl2v', 'minimax-h3-ref2v']

function essentia(id: string): Modus {
  const m = CANONICAL_ESSENTIAE.find(e => e.id === id)
  assert.ok(m, `seed ${id} exists`)
  return m as Modus
}

/** A flow with no licence terms, to show the gate costs nothing where nothing is declared. */
const PLAIN: Modus = { ...essentia('minimax-h3-t2v'), id: 'plain-flow', useTerms: undefined }
/** A composite whose only step is an H3 flow. */
const COMPOSITE: Modus = {
  ...PLAIN, id: 'h3-composite', genus: 'compositus', useTerms: undefined,
  gradus: [{ ordine: 0, modusId: 'minimax-h3-t2v' } as Gradus],
}

function harness(opts: { consuetudinum?: MemoryConsuetudinum | null; strikes?: number } = {}) {
  let dispatched = false
  const consuetudinum = opts.consuetudinum === undefined ? new MemoryConsuetudinum() : opts.consuetudinum
  const modi = [...H3_IDS.map(essentia), PLAIN, COMPOSITE]
  const deps = {
    modorum: { async find(id: string) { return modi.find(m => m.id === id) ?? null } },
    inceptor: { async initiate() { dispatched = true; throw new Error(REACHED_DISPATCH) } },
    cursorum: { resolve() { throw new Error('cursor must not resolve on a refused run') } },
    completor: {},
    ...(consuetudinum ? { consuetudinum } : {}),
    querelae: { async countViolations(ownerKey: string, termsId: string) {
      return ownerKey === ownerKeyOf(CALLER) && termsId === 'minimax-h3' ? (opts.strikes ?? 0) : 0
    } },
  }
  return { api: new CrystalApi(deps as unknown as CrystalApiDeps), consuetudinum, dispatched: () => dispatched }
}

const aditusFor = (id: string): Record<string, unknown> => {
  // Each flow's own defaults, so nothing but the terms can refuse it.
  const ports = essentia(id === 'plain-flow' || id === 'h3-composite' ? 'minimax-h3-t2v' : id).aditus
  return Object.fromEntries(Object.entries(ports).filter(([, p]) => (p as { default?: unknown }).default !== undefined)
    .map(([k, p]) => [k, (p as { default?: unknown }).default]))
}

async function refusedWith(h: ReturnType<typeof harness>, modusId: string, code: string): Promise<ApiError> {
  let caught: ApiError | undefined
  await assert.rejects(() => h.api.invokeFlow(CALLER, { modusId }, aditusFor(modusId)), (err: unknown) => {
    assert.ok(err instanceof ApiError, `refused as a request error, not ${String(err)}`)
    assert.equal(err.code, code)
    caught = err
    return true
  })
  assert.equal(h.dispatched(), false, 'nothing was dispatched: no actum, no reservation, no pod')
  return caught as ApiError
}

async function reachedDispatch(h: ReturnType<typeof harness>, modusId: string): Promise<void> {
  await assert.rejects(() => h.api.invokeFlow(CALLER, { modusId }, aditusFor(modusId)), new RegExp(REACHED_DISPATCH))
  assert.equal(h.dispatched(), true)
}

test('every MiniMax H3 flow declares the H3 terms', () => {
  for (const id of H3_IDS) assert.deepEqual(essentia(id).useTerms, ['minimax-h3'], id)
  // and nothing else in the catalog runs H3 without them
  for (const e of CANONICAL_ESSENTIAE) {
    if (e.fundamentumId === 'minimax-h3-comfyui') assert.deepEqual(e.useTerms, ['minimax-h3'], e.id)
  }
})

test('an H3 run with no acceptance on file is refused with terms.required, before anything is reserved', async () => {
  for (const id of H3_IDS) {
    const err = await refusedWith(harness(), id, 'terms.required')
    assert.equal(err.httpStatus, 403)
    const details = err.toBody().details as Record<string, unknown>
    assert.equal(details.terms, 'minimax-h3')
    assert.equal(details.versio, H3.versio)
    assert.equal(details.href, H3.href)
    assert.equal(details.licenseHref, H3.licenseHref)
  }
})

test('with no settings store at all the H3 run is still refused (fail-closed)', async () => {
  await refusedWith(harness({ consuetudinum: null }), 'minimax-h3-t2v', 'terms.required')
})

test('acceptance of an earlier version does not cover the current one', async () => {
  const h = harness()
  await h.consuetudinum!.setGeneratio(CALLER, { termsAccepted: { 'minimax-h3': { versio: '2000-01-01', acceptedAt: 1 } } })
  await refusedWith(h, 'minimax-h3-t2v', 'terms.required')
})

test('after acceptUseTerms the same H3 run goes through', async () => {
  const h = harness()
  const rec = await h.api.acceptUseTerms(CALLER, 'minimax-h3')
  assert.equal(rec.terms, 'minimax-h3')
  assert.equal(rec.versio, H3.versio)
  await reachedDispatch(h, 'minimax-h3-fl2v')
})

test('acceptance is per caller: another identity is still refused', async () => {
  const h = harness()
  await h.api.acceptUseTerms({ animaId: 'someone-else' }, 'minimax-h3')
  await refusedWith(h, 'minimax-h3-t2v', 'terms.required')
})

test('accepting unknown terms is refused', async () => {
  await assert.rejects(() => harness().api.acceptUseTerms(CALLER, 'no-such-terms'), (e: unknown) =>
    e instanceof ApiError && e.code === 'not_found.terms')
})

test('a Preferences replace can neither forge nor erase an acceptance', async () => {
  const h = harness()
  // forge
  await h.api.setGeneratio(CALLER, { termsAccepted: { 'minimax-h3': { versio: H3.versio, acceptedAt: 1 } } })
  await refusedWith(h, 'minimax-h3-t2v', 'terms.required')
  // erase
  await h.api.acceptUseTerms(CALLER, 'minimax-h3')
  await h.api.setGeneratio(CALLER, { style: 'noir' })
  const stored = await h.consuetudinum!.resolveGeneratio(CALLER)
  assert.equal(stored?.termsAccepted?.['minimax-h3']?.versio, H3.versio)
  assert.equal(stored?.style, 'noir')
})

test('a caller at the strike limit is suspended from H3 runs; one below it is not', async () => {
  const below = harness({ strikes: H3.strikeLimit - 1 })
  await below.api.acceptUseTerms(CALLER, 'minimax-h3')
  await reachedDispatch(below, 'minimax-h3-t2v')

  const at = harness({ strikes: H3.strikeLimit })
  await at.api.acceptUseTerms(CALLER, 'minimax-h3')
  const err = await refusedWith(at, 'minimax-h3-t2v', 'terms.suspended')
  assert.equal(err.httpStatus, 403)
})

test('suspension is repeat-violator only: the limit is more than one', () => {
  assert.ok(H3.strikeLimit >= 2)
})

test('a composite with an H3 step carries the H3 terms', async () => {
  await refusedWith(harness(), 'h3-composite', 'terms.required')
})

test('a flow with no terms is untouched by the gate', async () => {
  await reachedDispatch(harness({ strikes: 99 }), 'plain-flow')
})

test('the chat path says where to accept, and says suspended plainly', async () => {
  const required = await useTermsVerdict({
    modus: essentia('minimax-h3-t2v'), find: async () => null, accepted: async () => undefined,
  })
  assert.equal(required.ok, false)
  if (required.ok) return
  assert.match(useTermsCopy(required, 'https://noema.art'), /https:\/\/noema\.art\/legal\/terms#11-minimax-h3-additional-terms/)

  const suspended = await useTermsVerdict({
    modus: essentia('minimax-h3-t2v'), find: async () => null,
    accepted: async () => ({ 'minimax-h3': { versio: H3.versio, acceptedAt: 0 } }),
    strikes: async () => H3.strikeLimit,
  })
  assert.equal(suspended.ok, false)
  if (suspended.ok) return
  assert.equal(suspended.reason, 'suspended')
  assert.match(useTermsCopy(suspended), /suspended/)
})
