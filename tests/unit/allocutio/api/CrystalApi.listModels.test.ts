// =============================================================================
// listModels — the adult gate governs LISTING, not a caller's own shelf
// =============================================================================
//
// The adult-content partition (`ADULT_CONTENT_RATINGS`) hides {suggestive, explicit} from
// the catalog unless the caller has spicy mode on. That gate is about what gets LISTED
// publicly; a model a caller imported for their own private use is not a listing, so it is
// exempt when — and only when — the caller passes `auctor` and owns the record.
//
// These tests pin both directions:
//   · the caller's own adult-rated model IS returned to them with `includeAdult: false`;
//   · another owner's adult-rated model is NOT, under the same call;
//   · the public catalog path is unchanged, with or without an `auctor`;
//   · with no `auctor`, every rating behaves exactly as before;
//   · spicy mode on still returns everything it did.
//
// Hermetic: fake registry, no DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import type { Intella, Intellae, Intellarum } from '../../../../src/types/intelligendi.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const owner: AuctorKey = { animaId: 'anima-owner' }
const stranger: AuctorKey = { animaId: 'anima-stranger' }

function makeIntella(over: Partial<Intella> = {}): Intella {
  return {
    id: 'base-model',
    nomen: 'Base model',
    genus: 'model',
    architectura: 'dit',
    parametri: 1_000_000_000,
    sources: [],
    dest: 'unet/base.safetensors',
    sizeGb: 2,
    versio: '1.0.0',
    canonica: true,
    familia: 'flux',
    ...over,
  } as Intella
}

// A platform-canonical, unrated model — always visible to everyone.
const canonicalSfw = makeIntella({ id: 'canonical-sfw', nomen: 'Canonical sfw' })

// A canonical model carrying an adult rating: the public path, which the exemption must
// never touch.
const canonicalExplicit = makeIntella({
  id: 'canonical-explicit',
  nomen: 'Canonical explicit',
  contentRating: 'explicit',
})

// The caller's own private import, adult-rated by the origin signal.
const ownExplicit = makeIntella({
  id: 'own-explicit',
  nomen: 'Own explicit',
  canonica: false,
  access: 'private',
  ownerAnimaId: 'anima-owner',
  contentRating: 'explicit',
})

// The caller's own private import, suggestive — the other half of the gated set.
const ownSuggestive = makeIntella({
  id: 'own-suggestive',
  nomen: 'Own suggestive',
  canonica: false,
  access: 'private',
  ownerAnimaId: 'anima-owner',
  contentRating: 'suggestive',
})

// Somebody else's private adult-rated import. Must never reach the caller.
const strangerExplicit = makeIntella({
  id: 'stranger-explicit',
  nomen: 'Stranger explicit',
  canonica: false,
  access: 'private',
  ownerAnimaId: 'anima-stranger',
  contentRating: 'explicit',
})

/** A registry serving the public catalog directly (the MongoIntella shape). */
function catalogRegistry(fixtures: Intella[]): Intellarum {
  return ({
    find: async (id: string) => fixtures.find((i) => i.id === id) ?? null,
    list: async (): Promise<Intellae> => fixtures,
    canonical: async (): Promise<Intellae> => fixtures.filter((i) => i.canonica),
    publicCatalog: async (): Promise<Intellae> =>
      fixtures.filter((i) => i.canonica || i.access === 'public'),
    listByOwner: async (ownerKey: string): Promise<Intellae> =>
      fixtures.filter((i) => i.ownerKey === ownerKey || `anima:${i.ownerAnimaId}` === ownerKey),
  } as unknown) as Intellarum
}

function apiWith(intellarum: Intellarum): CrystalApi {
  return new CrystalApi(({ intellarum } as unknown) as CrystalApiDeps)
}

const ids = (models: Array<{ intellaId: string }>): string[] => models.map((m) => m.intellaId).sort()

const allFixtures = [canonicalSfw, canonicalExplicit, ownExplicit, ownSuggestive, strangerExplicit]

// --- the hole that must not open -------------------------------------------------------

test('listModels does not return another owner\'s adult-rated model to an auctor', async () => {
  const api = apiWith(catalogRegistry(allFixtures))

  const asOwner = await api.listModels({ auctor: owner, includeAdult: false })
  assert.equal(asOwner.some((m) => m.intellaId === 'stranger-explicit'), false)

  // Symmetric: the stranger does not get the caller's models either. An exemption keyed on
  // anything but the resolved owner (e.g. "any private record") would fail here.
  const asStranger = await api.listModels({ auctor: stranger, includeAdult: false })
  assert.equal(asStranger.some((m) => m.intellaId === 'own-explicit'), false)
  assert.equal(asStranger.some((m) => m.intellaId === 'own-suggestive'), false)
})

test('listModels keeps the adult gate on the public catalog even for a caller with an auctor', async () => {
  const api = apiWith(catalogRegistry(allFixtures))

  const asOwner = await api.listModels({ auctor: owner, includeAdult: false })
  // The canonical adult-rated record is not owned by anyone, so the gate still drops it.
  assert.equal(asOwner.some((m) => m.intellaId === 'canonical-explicit'), false)
})

// --- the fix ---------------------------------------------------------------------------

test('listModels returns a caller\'s own adult-rated models to that caller with spicy mode off', async () => {
  const api = apiWith(catalogRegistry(allFixtures))

  const asOwner = await api.listModels({ auctor: owner, includeAdult: false })
  assert.deepEqual(ids(asOwner), ['canonical-sfw', 'own-explicit', 'own-suggestive'])
})

test('listModels still applies every other filter axis to a caller\'s own adult-rated models', async () => {
  const api = apiWith(catalogRegistry(allFixtures))

  // The exemption is scoped to the adult predicate only: a non-matching genus still excludes
  // an owned record.
  const wrongGenus = await api.listModels({ auctor: owner, includeAdult: false, genus: 'lora' })
  assert.deepEqual(ids(wrongGenus), [])

  // …as does a non-matching free-text query.
  const wrongQuery = await api.listModels({ auctor: owner, includeAdult: false, q: 'no-such-token' })
  assert.deepEqual(ids(wrongQuery), [])

  // …and a non-matching base family.
  const wrongBasis = await api.listModels({ auctor: owner, includeAdult: false, basis: 'sd15' })
  assert.deepEqual(ids(wrongBasis), [])
})

// --- unchanged behaviour ----------------------------------------------------------------

test('listModels with no auctor filters every adult rating exactly as before', async () => {
  const api = apiWith(catalogRegistry(allFixtures))

  const anon = await api.listModels({ includeAdult: false })
  assert.deepEqual(ids(anon), ['canonical-sfw'])

  // Default filter (no `includeAdult` key at all) behaves the same.
  const bare = await api.listModels()
  assert.deepEqual(ids(bare), ['canonical-sfw'])
})

test('listModels with spicy mode on returns the adult set it returned before', async () => {
  const api = apiWith(catalogRegistry(allFixtures))

  const anon = await api.listModels({ includeAdult: true })
  assert.deepEqual(ids(anon), ['canonical-explicit', 'canonical-sfw'])

  const asOwner = await api.listModels({ auctor: owner, includeAdult: true })
  assert.deepEqual(ids(asOwner), [
    'canonical-explicit',
    'canonical-sfw',
    'own-explicit',
    'own-suggestive',
  ])
})
