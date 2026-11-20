// =============================================================================
// Territorial licence exclusion at the run entry point — MiniMax H3's §I.5/§V.4
// =============================================================================
//
// MiniMax H3's Community License excludes the EU, UK and Republic of Korea from self-hosted
// use entirely (our own US exclusion was separately lifted by MiniMax's 2026-11-13 grant — see
// docs/legal/minimax-h3-license-proposal.md). Our own terms (Section 11.1) already PROMISE this;
// these tests pin the CONTROL that actually enforces it: a run (or a collection write that
// dispatches new paid pieces) from a caller whose origin is one of those territories is refused
// before anything is reserved, and a run from an unresolvable or US origin is unaffected.
//
// REACHED-DISPATCH SENTINEL, as in useTermsGate.test.ts: the inceptor double records the
// inceptio and throws, so "refused" and "would have run" are distinguishable without a cursor,
// ledger or store, and every refusal also asserts nothing was dispatched.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
import { MemoryConsuetudinum } from '../../../../src/crystal/MemoryConsuetudinum.js'
import { USE_TERMS, territoryVerdict } from '../../../../src/crystal/useTerms.js'
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

/** A flow with no licence terms at all, to show the gate costs nothing where nothing is declared. */
const PLAIN: Modus = { ...essentia('minimax-h3-t2v'), id: 'plain-flow', useTerms: undefined }
/** A composite whose only step is an H3 flow. */
const COMPOSITE: Modus = {
  ...PLAIN, id: 'h3-composite', genus: 'compositus', useTerms: undefined,
  gradus: [{ ordine: 0, modusId: 'minimax-h3-t2v' } as Gradus],
}

function harness() {
  let dispatched = false
  const consuetudinum = new MemoryConsuetudinum()
  const modi = [...H3_IDS.map(essentia), PLAIN, COMPOSITE]
  const deps = {
    modorum: { async find(id: string) { return modi.find(m => m.id === id) ?? null } },
    inceptor: { async initiate() { dispatched = true; throw new Error(REACHED_DISPATCH) } },
    cursorum: { resolve() { throw new Error('cursor must not resolve on a refused run') } },
    completor: {},
    consuetudinum,
    querelae: { async countViolations() { return 0 } },
  }
  return { api: new CrystalApi(deps as unknown as CrystalApiDeps), consuetudinum, dispatched: () => dispatched }
}

const aditusFor = (id: string): Record<string, unknown> => {
  const ports = essentia(id === 'plain-flow' || id === 'h3-composite' ? 'minimax-h3-t2v' : id).aditus
  return Object.fromEntries(Object.entries(ports).filter(([, p]) => (p as { default?: unknown }).default !== undefined)
    .map(([k, p]) => [k, (p as { default?: unknown }).default]))
}

/** Accept the H3 terms for CALLER so a refusal under test is territory, never acceptance. */
async function accepted(h: ReturnType<typeof harness>): Promise<void> {
  await h.api.acceptUseTerms(CALLER, 'minimax-h3')
}

async function refusedWith(
  h: ReturnType<typeof harness>, modusId: string, originCountry: string | undefined, code: string,
): Promise<ApiError> {
  let caught: ApiError | undefined
  await assert.rejects(
    () => h.api.invokeFlow(CALLER, { modusId }, aditusFor(modusId), { originCountry }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `refused as a request error, not ${String(err)}`)
      assert.equal(err.code, code)
      caught = err
      return true
    },
  )
  assert.equal(h.dispatched(), false, 'nothing was dispatched: no actum, no reservation, no pod')
  return caught as ApiError
}

async function reachedDispatch(
  h: ReturnType<typeof harness>, modusId: string, originCountry: string | undefined,
): Promise<void> {
  await assert.rejects(
    () => h.api.invokeFlow(CALLER, { modusId }, aditusFor(modusId), { originCountry }),
    new RegExp(REACHED_DISPATCH),
  )
  assert.equal(h.dispatched(), true)
}

test('an H3 run from an EU, UK or Republic of Korea origin is refused with territory.excluded, before anything is reserved', async () => {
  for (const id of H3_IDS) {
    for (const country of ['DE', 'FR', 'gb', 'KR']) {
      const h = harness()
      await accepted(h)
      const err = await refusedWith(h, id, country, 'territory.excluded')
      assert.equal(err.httpStatus, 403)
      const details = err.toBody().details as Record<string, unknown>
      assert.equal(details.terms, 'minimax-h3')
      assert.equal(details.country, country.toUpperCase())
    }
  }
})

test('an H3 run from a US origin — the territory our own grant covers — is unaffected', async () => {
  const h = harness()
  await accepted(h)
  await reachedDispatch(h, 'minimax-h3-t2v', 'US')
})

test('an H3 run with no resolvable origin (absent, or Cloudflare\'s XX/T1 already filtered by the router) is unaffected — fail-open on no signal', async () => {
  const h = harness()
  await accepted(h)
  await reachedDispatch(h, 'minimax-h3-t2v', undefined)
})

test('a composite with an H3 step is refused from an excluded origin too', async () => {
  const h = harness()
  await accepted(h)
  await refusedWith(h, 'h3-composite', 'GB', 'territory.excluded')
})

test('a flow with no terms is untouched by the gate regardless of origin', async () => {
  const h = harness()
  await reachedDispatch(h, 'plain-flow', 'KR')
})

test('the EU-institutional sentinel Cloudflare can report, \'EU\', is excluded too', async () => {
  const h = harness()
  await accepted(h)
  await refusedWith(h, 'minimax-h3-t2v', 'EU', 'territory.excluded')
})

test('the acceptance gate still runs first: an unaccepted caller sees terms.required, not territory.excluded, even from an excluded origin', async () => {
  const h = harness()
  await refusedWith(h, 'minimax-h3-t2v', 'KR', 'terms.required')
})

// ── territoryVerdict: the pure predicate, directly ──────────────────────────────────────────

test('territoryVerdict: ok with no origin signal, ok for an unlisted (e.g. US) origin, refused for a listed one', async () => {
  const modus = essentia('minimax-h3-t2v')
  const find = async () => null

  const noSignal = await territoryVerdict({ modus, find, originCountry: undefined })
  assert.equal(noSignal.ok, true)

  const us = await territoryVerdict({ modus, find, originCountry: 'US' })
  assert.equal(us.ok, true)

  const kr = await territoryVerdict({ modus, find, originCountry: 'kr' })
  assert.equal(kr.ok, false)
  if (kr.ok) return
  assert.equal(kr.country, 'KR')
  assert.equal(kr.terms.id, 'minimax-h3')
})

test('territoryVerdict: every EU member state is excluded', async () => {
  const modus = essentia('minimax-h3-t2v')
  const find = async () => null
  for (const country of ['DE', 'FR', 'IT', 'ES', 'PL', 'IE', 'NL', 'SE']) {
    const verdict = await territoryVerdict({ modus, find, originCountry: country })
    assert.equal(verdict.ok, false, country)
  }
})

test('territoryVerdict: a flow with no licence terms is ok from any origin', async () => {
  const verdict = await territoryVerdict({ modus: PLAIN, find: async () => null, originCountry: 'KR' })
  assert.equal(verdict.ok, true)
})

// ── Collections: every write that dispatches new paid pieces asks the same question ─────────

function collectionHarness() {
  const calls: string[] = []
  const collectio = {
    id: 'col-1', by: CALLER, modusId: 'minimax-h3-t2v', status: 'agens', numerus: 10, reiectae: 0,
    tractus: [], aditusBase: {}, acta: [], completae: 0, fractae: 0, concurrentia: 3,
  }
  const consuetudinum = new MemoryConsuetudinum()
  const deps = {
    modorum: { async find(id: string) { return [...H3_IDS.map(essentia)].find(m => m.id === id) ?? null } },
    consuetudinum,
    querelae: { async countViolations() { return 0 } },
    collectiones: {
      async find(id: string) { return id === collectio.id ? collectio : null },
      async create(patch: Record<string, unknown>) { return { ...collectio, ...patch, id: 'col-new' } },
    },
    collectioCursor: {
      async start() { calls.push('start') },
      async extend() { calls.push('extend') },
      async resume() { calls.push('resume') },
      async rejectAndRevive() { calls.push('reject') },
    },
  }
  return { api: new CrystalApi(deps as unknown as CrystalApiDeps), calls }
}

const COLLECTION_VERBS: Array<[string, (api: CrystalApi, originCountry?: string) => Promise<unknown>]> = [
  ['extend', (api, originCountry) => api.extendCollection(CALLER, 'col-1', 5, originCountry)],
  ['resume', (api, originCountry) => api.resumeCollection(CALLER, 'col-1', originCountry)],
  ['reject', (api, originCountry) => api.rejectCollectionPiece(CALLER, 'col-1', 'piece-1', originCountry)],
]

test('extend, resume and reject on an H3 collection are refused from an excluded origin, once the funder has accepted the terms', async () => {
  for (const [name, verb] of COLLECTION_VERBS) {
    const h = collectionHarness()
    await h.api.acceptUseTerms(CALLER, 'minimax-h3')
    await assert.rejects(() => verb(h.api, 'GB'), (e: unknown) => e instanceof ApiError && e.code === 'territory.excluded', name)
    assert.deepEqual(h.calls, [], `${name}: nothing was dispatched`)
    await verb(h.api, 'US')
    assert.deepEqual(h.calls, [name], `${name}: goes through from an origin the licence covers`)
  }
})

test('collect() dispatching live is refused from an excluded origin before the collection starts', async () => {
  const h = collectionHarness()
  await h.api.acceptUseTerms(CALLER, 'minimax-h3')
  await assert.rejects(
    () => h.api.collect(CALLER, { modusId: 'minimax-h3-t2v', total: 1, tractus: [], originCountry: 'KR' }),
    (e: unknown) => e instanceof ApiError && e.code === 'territory.excluded',
  )
})

test('collect() as a DRAFT is not territory-checked at creation — only once fired', async () => {
  const h = collectionHarness()
  const draft = await h.api.collect(CALLER, { modusId: 'minimax-h3-t2v', draft: true, originCountry: 'KR' })
  assert.equal(draft.status, 'draft')
})

function draftHarness() {
  const draft = {
    id: 'draft-1', by: CALLER, modusId: 'minimax-h3-t2v', status: 'draft', numerus: 5, reiectae: 0,
    tractus: [{ porta: 'seed', valores: [{ value: 1 }] }], aditusBase: {}, acta: [],
    completae: 0, fractae: 0, concurrentia: 3,
  }
  const started: string[] = []
  const consuetudinum = new MemoryConsuetudinum()
  const deps = {
    modorum: { async find(id: string) { return [...H3_IDS.map(essentia)].find(m => m.id === id) ?? null } },
    consuetudinum,
    querelae: { async countViolations() { return 0 } },
    collectiones: {
      async find(id: string) { return id === draft.id ? draft : null },
      async update(_id: string, patch: Record<string, unknown>) { return { ...draft, ...patch } },
    },
    collectioCursor: { async start() { started.push('start') } },
  }
  return { api: new CrystalApi(deps as unknown as CrystalApiDeps), started }
}

test('fireCollection on an H3 draft is refused from an excluded origin before the run starts', async () => {
  const h = draftHarness()
  await h.api.acceptUseTerms(CALLER, 'minimax-h3')
  await assert.rejects(
    () => h.api.fireCollection(CALLER, 'draft-1', 'GB'),
    (e: unknown) => e instanceof ApiError && e.code === 'territory.excluded',
  )
  assert.deepEqual(h.started, [])
  await h.api.fireCollection(CALLER, 'draft-1', 'US')
  assert.deepEqual(h.started, ['start'])
})

test('patchCollectionDraft changing a FIRED collection\'s flow is refused from an excluded origin', async () => {
  const h = draftHarness()
  await h.api.acceptUseTerms(CALLER, 'minimax-h3')
  // Simulate an already-fired collection by finding it as non-draft.
  const fired = { id: 'draft-1', by: CALLER, modusId: 'minimax-h3-t2v', status: 'agens', numerus: 5, reiectae: 0,
    tractus: [{ porta: 'seed', valores: [{ value: 1 }] }], aditusBase: {}, acta: [], completae: 0, fractae: 0, concurrentia: 3 }
  const consuetudinum = new MemoryConsuetudinum()
  const deps = {
    modorum: { async find(id: string) { return [...H3_IDS.map(essentia)].find(m => m.id === id) ?? null } },
    consuetudinum,
    querelae: { async countViolations() { return 0 } },
    collectiones: {
      async find(id: string) { return id === fired.id ? fired : null },
      async update(_id: string, patch: Record<string, unknown>) { return { ...fired, ...patch } },
    },
  }
  const api = new CrystalApi(deps as unknown as CrystalApiDeps)
  await api.acceptUseTerms(CALLER, 'minimax-h3')
  await assert.rejects(
    () => api.patchCollectionDraft(CALLER, 'draft-1', { modusId: 'minimax-h3-fl2v' }, 'KR'),
    (e: unknown) => e instanceof ApiError && e.code === 'territory.excluded',
  )
  const patched = await api.patchCollectionDraft(CALLER, 'draft-1', { modusId: 'minimax-h3-fl2v' }, 'US')
  assert.equal(patched.modusId, 'minimax-h3-fl2v')
})
