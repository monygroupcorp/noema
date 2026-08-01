// =============================================================================
// noema-113 — pinnedModels normalization (string → canonical ModelRef) + guards
// =============================================================================
//
// A concierge GO that pins a LoRA by id, slug, OR trigger must normalize to the SAME
// canonical `ModelRef{id}` at the run boundary, and an unresolvable/forbidden pin must
// fail with a clear NON-500 error — not the Compiler's misleading `No URL for model
// 'undefined'`. These assert the resolver + the `CrystalApi.resolvePinnedModels`
// chokepoint that `invokeFlow` funnels every pinned model through. Hermetic (DB-free
// Intellarum double). See tests/unit/crystal/Compiler.privateModel.test.ts for the
// Compiler-side falsy-id guard.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolvePinnedModel } from '../../../../src/crystal/pinnedModelResolver.js'
import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import type { Intella, Intellae, Intellarum, IntellaGenus } from '../../../../src/types/intelligendi.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const auctor: AuctorKey = { animaId: 'anima-1' }

// The real klein LoRA record (seeds/intellae.ts INTELLA_IMPRESSTATION_KLEIN):
// id 'intella.impresstation-klein', slug 'impresstation_klein', trigger 'stationthis'.
const KLEIN: Intella = {
  id: 'intella.impresstation-klein',
  nomen: 'Impresstation Klein',
  genus: 'lora' as IntellaGenus,
  sources: [{ provenance: 'miladystation', uri: 'https://example.com/impresstation-klein.safetensors' }],
  dest: 'models/loras/impresstation_klein.safetensors',
  slug: 'impresstation_klein',
  trigger: 'stationthis',
  canonica: true,
  natum: new Date('2026-01-01T00:00:00Z'),
} as Intella

/** A minimal Intellarum over a fixed record set: id-only `find` (as MongoIntella) + a `list`. */
function makeStore(records: Intella[]): Intellarum {
  return {
    async find(id: string) { return records.find((r) => r.id === id) ?? null },
    async list(genus?: IntellaGenus) {
      return (genus ? records.filter((r) => r.genus === genus) : records) as Intellae
    },
    async canonical() { return records.filter((r) => r.canonica) as Intellae },
    async findByTrigger() { return [] as Intellae },
    async triggerMap() { return new Map() },
  }
}

const CANONICAL = { role: 'lora', id: 'intella.impresstation-klein', dest: 'models/loras/impresstation_klein.safetensors' }

// ── The resolver: id | slug | trigger all collapse to the same canonical ModelRef ──

test('resolvePinnedModel resolves an exact id to the canonical ModelRef', async () => {
  const res = await resolvePinnedModel(makeStore([KLEIN]), 'intella.impresstation-klein')
  assert.deepEqual(res, { ok: true, ref: CANONICAL })
})

test('resolvePinnedModel resolves a slug to the canonical ModelRef', async () => {
  const res = await resolvePinnedModel(makeStore([KLEIN]), 'impresstation_klein')
  assert.deepEqual(res, { ok: true, ref: CANONICAL })
})

test('resolvePinnedModel resolves a trigger word to the canonical ModelRef', async () => {
  const res = await resolvePinnedModel(makeStore([KLEIN]), 'stationthis')
  assert.deepEqual(res, { ok: true, ref: CANONICAL })
})

test('resolvePinnedModel passes an already-shaped ref through by its id', async () => {
  const res = await resolvePinnedModel(makeStore([KLEIN]), { role: 'lora', id: 'intella.impresstation-klein', dest: 'x' })
  assert.deepEqual(res, { ok: true, ref: CANONICAL })
})

test('resolvePinnedModel returns unresolved for an unknown token', async () => {
  const res = await resolvePinnedModel(makeStore([KLEIN]), 'nonesuch')
  assert.deepEqual(res, { ok: false, token: 'nonesuch', reason: 'unresolved' })
})

test('resolvePinnedModel returns forbidden for a private model the caller does not own', async () => {
  const priv: Intella = { ...KLEIN, id: 'intella.secret', slug: 'secret', trigger: 'hush', access: 'private', ownerAnimaId: 'anima-other' } as Intella
  const res = await resolvePinnedModel(makeStore([priv]), 'secret', 'anima:anima-1')
  assert.deepEqual(res, { ok: false, token: 'secret', reason: 'forbidden' })
})

test('resolvePinnedModel resolves an owner\'s OWN private model', async () => {
  const priv: Intella = { ...KLEIN, id: 'intella.mine', slug: 'mine', trigger: 'mine', access: 'private', ownerAnimaId: 'anima-1' } as Intella
  const res = await resolvePinnedModel(makeStore([priv]), 'mine', 'anima:anima-1')
  assert.equal(res.ok, true)
})

// ── The CrystalApi chokepoint invokeFlow uses: pinnedModels[] → canonical ModelRef[] ──

function makeApi(records: Intella[]): CrystalApi {
  return new CrystalApi({ intellarum: makeStore(records) } as unknown as CrystalApiDeps)
}

test('resolvePinnedModels normalizes id, slug, and trigger to the SAME canonical ref', async () => {
  const api = makeApi([KLEIN])
  for (const token of ['intella.impresstation-klein', 'impresstation_klein', 'stationthis']) {
    const [ref] = await api.resolvePinnedModels(auctor, [token])
    assert.deepEqual(ref, CANONICAL, `token ${token} → canonical ref`)
  }
})

test('resolvePinnedModels throws a clear NON-500 error (422) for an unresolvable pinnedModels token', async () => {
  const api = makeApi([KLEIN])
  await assert.rejects(
    () => api.resolvePinnedModels(auctor, ['nonesuch']),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, 'is an ApiError, not a Compiler 500')
      assert.equal(err.code, 'input.model_not_resolved')
      assert.equal(err.httpStatus, 422)
      assert.ok(!/undefined/.test(err.message), 'no misleading "model undefined" message')
      return true
    },
  )
})

test('resolvePinnedModels throws a 403 for a forbidden private pin', async () => {
  const priv: Intella = { ...KLEIN, id: 'intella.secret', slug: 'secret', trigger: 'hush', access: 'private', ownerAnimaId: 'anima-other' } as Intella
  const api = makeApi([priv])
  await assert.rejects(
    () => api.resolvePinnedModels(auctor, ['secret']),
    (err: unknown) => err instanceof ApiError && err.code === 'auth.forbidden' && err.httpStatus === 403,
  )
})
