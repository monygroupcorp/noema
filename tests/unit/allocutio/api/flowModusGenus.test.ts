// =============================================================================
// flowModusGenus — asserts `listFlows()` / `listMyFlows()` populate the new
// `modusGenus` field (noema-056) with exactly what the noema-054 resolver
// (`resolveCanonVerb`) returns for that flow's ports, derived at query time.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { resolveCanonVerb } from '../../../../src/crystal/verbResolver.js'
import {
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_FLUXI2I,
  ESSENTIA_RMBG,
  ESSENTIA_QWEN3_VL,
} from '../../../../src/crystal/seeds/essentiae.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const auctor: AuctorKey = { animaId: 'anima-1' }

// The sample covers at least: text-only make, required-image effect, image-only
// enhance, and a non-image-output chat case — the verbs the noema-054 resolver's
// own test fixtures already exercise (tests/unit/allocutio/crystal/verbResolver.test.ts).
const SAMPLE_MODI: Modus[] = [ESSENTIA_RUNMAKE_FLUX_SCHNELL, ESSENTIA_FLUXI2I, ESSENTIA_RMBG, ESSENTIA_QWEN3_VL]

function makeDeps(): CrystalApiDeps {
  const modi: Record<string, Modus> = Object.fromEntries(SAMPLE_MODI.map((m) => [m.id, m]))
  return {
    inceptor: { initiate: async () => { throw new Error('unused') } },
    modorum: {
      find: async (id: string) => modi[id] ?? null,
      register: async () => {},
      list: async (filter) =>
        Object.values(modi).filter(
          (m) =>
            (filter?.genus === undefined || m.genus === filter.genus) &&
            (filter?.canonica === undefined || m.canonica === filter.canonica),
        ),
      update: async () => { throw new Error('unused') },
    },
    cursorum: { register: () => {}, resolve: () => { throw new Error('unused') } },
    completor: { complete: async (act) => act, fail: async (act) => act },
    actorum: {
      create: async () => { throw new Error('unused') },
      update: async () => { throw new Error('unused') },
      findById: async () => null,
      findByExternusJobId: async () => null,
      findByNullifier: async () => null,
      findExpired: async () => [],
      findInFlight: async () => [],
      findByCompositum: async () => [],
    },
    signorum: { ownsAny: async () => false } as unknown as CrystalApiDeps['signorum'],
  } as unknown as CrystalApiDeps
}

test('listFlows populates modusGenus with the noema-054 resolver output for every flow', async () => {
  const api = new CrystalApi(makeDeps())
  const flows = await api.listFlows()
  assert.equal(flows.length, SAMPLE_MODI.length)
  for (const flow of flows) {
    const modus = SAMPLE_MODI.find((m) => m.id === flow.id)!
    assert.equal(flow.modusGenus, resolveCanonVerb(modus), `listFlows: ${flow.id}`)
  }
})

test('listMyFlows populates modusGenus with the noema-054 resolver output for every owned flow', async () => {
  const api = new CrystalApi(makeDeps())
  const flows = await api.listMyFlows(auctor)
  assert.equal(flows.length, SAMPLE_MODI.length)
  for (const flow of flows) {
    const modus = SAMPLE_MODI.find((m) => m.id === flow.id)!
    assert.equal(flow.modusGenus, resolveCanonVerb(modus), `listMyFlows: ${flow.id}`)
  }
})

test('listFlows: flux-schnell (text-only aditus, image output) resolves to make', async () => {
  const api = new CrystalApi(makeDeps())
  const flows = await api.listFlows()
  const flux = flows.find((f) => f.id === 'flux-schnell')!
  assert.equal(flux.modusGenus, 'make')
})

test('listFlows: rmbg (image-only aditus, no text) resolves to enhance', async () => {
  const api = new CrystalApi(makeDeps())
  const flows = await api.listFlows()
  const rmbg = flows.find((f) => f.id === 'rmbg')!
  assert.equal(rmbg.modusGenus, 'enhance')
})
