// =============================================================================
// Conditional licence grants — MiniMax H3 stays off the catalog unless its grant holds
// =============================================================================
//
// MiniMax authorized Mony Group LLC to use H3 on 2026-11-13, conditioned on the commitments in
// the request: users bound to the licence's use restrictions (flow-down), and safeguards with
// suspension of repeat violators. These tests pin that:
//   · the canonical H3 seeds cite that grant, not any other date;
//   · `isCatalogEligible` refuses an H3 model whatever its verdict while the conditions are not
//     live, and the public catalog listing drops it;
//   · the conditions are live only in a process that runs both safeguards: a report store that
//     counts strikes, and the run-entry terms gate's acceptance record. A terms record in code is
//     the policy, not the enforcement;
//   · every canonical flow that loads an H3 weight declares the grant's flow-down terms, so the
//     run gate binds its users.
//
// Hermetic: seeds and a fake registry, no DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  LICENCE_GRANTS,
  NO_SAFEGUARDS,
  grantConditionsLive,
  isCatalogEligible,
  type GrantSafeguards,
} from '../../../src/crystal/modelLicense.js'
import { USE_TERMS, type UseTerms } from '../../../src/crystal/useTerms.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import { CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import type { Intella, Intellae, Intellarum } from '../../../src/types/intelligendi.js'

const live = (id: string): UseTerms | undefined => USE_TERMS[id]
const absent = (): UseTerms | undefined => undefined
const noSuspension = (id: string): UseTerms | undefined =>
  USE_TERMS[id] ? { ...USE_TERMS[id], strikeLimit: 0 } : undefined

const wired: GrantSafeguards = { strikes: true, termsGate: true }

const h3Seeds = CANONICAL_INTELLAE.filter((i) => i.license === 'minimax-h3')

// ── the grant on record ──────────────────────────────────────────────────────

test('the MiniMax H3 grant is recorded as issued 2026-11-13, conditional on flow-down terms', () => {
  const grant = LICENCE_GRANTS['minimax-h3']
  assert.ok(grant, 'minimax-h3 has a grant entry')
  assert.equal(grant.grantedOn, '2026-11-13')
  assert.equal(grant.useTerms, 'minimax-h3')
})

test('the canonical H3 seeds and the register cite the 2026-11-13 grant, not 2026-09-01', () => {
  assert.ok(h3Seeds.length > 0, 'there are canonical H3 seeds')
  for (const file of ['src/crystal/seeds/intellae.ts', 'src/crystal/modelLicense.ts']) {
    const lines = readFileSync(file, 'utf8').split('\n')
    // `natum` is when a seed was added, not a licence citation.
    const stale = lines.filter((l) => l.includes('2026-09-01') && !l.includes('natum:'))
    assert.deepEqual(stale, [], `${file} still cites 2026-09-01`)
    assert.ok(lines.some((l) => l.includes('2026-11-13')), `${file} cites the 2026-11-13 grant`)
  }
})

// ── the gate ─────────────────────────────────────────────────────────────────

test('isCatalogEligible admits canonical H3 while the grant conditions are live', () => {
  assert.equal(grantConditionsLive('minimax-h3', wired, live), true)
  for (const seed of h3Seeds) assert.equal(isCatalogEligible(seed.commercialUse, seed.license, wired), true, seed.id)
})

test('isCatalogEligible refuses H3 when the flow-down terms are not published', () => {
  assert.equal(grantConditionsLive('minimax-h3', wired, absent), false)
  for (const seed of h3Seeds) assert.equal(isCatalogEligible(seed.commercialUse, seed.license, wired, absent), false, seed.id)
})

test('isCatalogEligible refuses H3 when the terms carry no repeat-violator suspension', () => {
  assert.equal(grantConditionsLive('minimax-h3', wired, noSuspension), false)
  assert.equal(isCatalogEligible('yes', 'minimax-h3', wired, noSuspension), false)
})

test('the H3 grant is not live in a process with no strike count, though its terms are published', () => {
  assert.equal(grantConditionsLive('minimax-h3', { strikes: false, termsGate: true }, live), false)
  assert.equal(isCatalogEligible('yes', 'minimax-h3', { strikes: false, termsGate: true }, live), false)
})

test('the H3 grant is not live in a process with no run-entry terms gate, though its terms are published', () => {
  assert.equal(grantConditionsLive('minimax-h3', { strikes: true, termsGate: false }, live), false)
  assert.equal(isCatalogEligible('yes', 'minimax-h3', { strikes: true, termsGate: false }, live), false)
})

test('a caller that does not say what is wired claims no safeguards', () => {
  assert.equal(isCatalogEligible('yes', 'minimax-h3'), false)
  assert.equal(grantConditionsLive('minimax-h3', NO_SAFEGUARDS, live), false)
})

test('a licence with no grant entry is unaffected by grant conditions', () => {
  assert.equal(isCatalogEligible('yes', 'apache-2.0', NO_SAFEGUARDS, absent), true)
  assert.equal(isCatalogEligible('conditional', 'krea-community', NO_SAFEGUARDS, absent), true)
  assert.equal(isCatalogEligible('yes', undefined, NO_SAFEGUARDS, absent), true)
  assert.equal(isCatalogEligible('no', 'flux-1-dev-nc'), false)
})

// ── the catalog listing ──────────────────────────────────────────────────────

function registry(fixtures: Intella[]): Intellarum {
  return ({
    find: async (id: string) => fixtures.find((i) => i.id === id) ?? null,
    list: async (): Promise<Intellae> => fixtures,
    canonical: async (): Promise<Intellae> => fixtures.filter((i) => i.canonica),
    publicCatalog: async (): Promise<Intellae> => fixtures.filter((i) => i.canonica || i.access === 'public'),
  } as unknown) as Intellarum
}

// The two stores the safeguards read. Their contents do not matter to the listing, only that the
// process has them.
const querelae = { countViolations: async () => 0 }
const consuetudinum = { resolveGeneratio: async () => undefined }
const other = CANONICAL_INTELLAE.find((i) => i.license !== 'minimax-h3' && i.genus === 'model')!

function api(extra: Partial<Record<'querelae' | 'consuetudinum', unknown>>): CrystalApi {
  return new CrystalApi(({ intellarum: registry([...h3Seeds, other]), ...extra } as unknown) as CrystalApiDeps)
}
const listedBy = async (a: CrystalApi) => (await a.listModels({ includeAdult: true, limit: 1000 })).map((m) => m.intellaId)

for (const [missing, extra] of [
  ['report store (strike count)', { consuetudinum }],
  ['run-entry terms gate', { querelae }],
  ['report store and terms gate', {}],
] as const) {
  test(`listModels drops H3 in a process with no ${missing}`, async () => {
    const listed = await listedBy(api(extra))
    for (const seed of h3Seeds) assert.ok(!listed.includes(seed.id), `${seed.id} hidden without the ${missing}`)
    assert.ok(listed.includes(other.id), 'other models stay listed')
  })
}

test('listModels drops H3 from the public catalog while its grant conditions are not live', async () => {
  const wiredApi = api({ querelae, consuetudinum })
  const listed = () => listedBy(wiredApi)

  const withGrant = await listed()
  for (const seed of h3Seeds) assert.ok(withGrant.includes(seed.id), `${seed.id} listed while live`)

  const saved = USE_TERMS['minimax-h3']
  try {
    delete USE_TERMS['minimax-h3']
    const without = await listed()
    for (const seed of h3Seeds) assert.ok(!without.includes(seed.id), `${seed.id} hidden when not live`)
    assert.ok(without.includes(other.id), 'other models stay listed')
  } finally {
    USE_TERMS['minimax-h3'] = saved
  }
})

// ── the flows bind their users ───────────────────────────────────────────────

test('every canonical flow that loads a granted-licence weight declares the grant\'s flow-down terms', () => {
  const licenceOf = new Map(CANONICAL_INTELLAE.map((i) => [i.id, i.license]))
  let checked = 0
  for (const e of CANONICAL_ESSENTIAE) {
    for (const w of e.intellae ?? []) {
      const grant = LICENCE_GRANTS[licenceOf.get(w.id) ?? '']
      if (!grant) continue
      checked++
      assert.ok((e.useTerms ?? []).includes(grant.useTerms), `${e.id} loads ${w.id} but does not declare ${grant.useTerms}`)
    }
  }
  assert.ok(checked > 0, 'at least one canonical flow loads an H3 weight')
})
