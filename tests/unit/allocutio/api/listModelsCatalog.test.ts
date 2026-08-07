// =============================================================================
// listModels — the PUBLIC CATALOG read
// =============================================================================
//
// The catalog surface is everything publicly visible: platform-canonical intellae PLUS
// models a user has published (`access: 'public'`). These tests pin four things:
//   · a published, non-canonical model is on the catalog;
//   · another owner's private model never is, with or without an auctor in scope;
//   · a registry that does not implement `publicCatalog` still works (canonical fallback);
//   · `sort` orders the whole result set BEFORE the `limit` slice;
//   · the adult-content partition still applies to the widened set.
//
// Hermetic: fake registry, no DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import type { Intella, Intellae, Intellarum } from '../../../../src/types/intelligendi.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const caller: AuctorKey = { animaId: 'anima-caller' }

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

const seeded = makeIntella({ id: 'seeded-model', nomen: 'Seeded model', canonica: true })
// A model a user published: not platform-canonical, publicly visible.
const published = makeIntella({
  id: 'published-model',
  nomen: 'Published model',
  canonica: false,
  access: 'public',
})
// A private model belonging to somebody other than the caller.
const strangersPrivate = makeIntella({
  id: 'strangers-private-model',
  nomen: 'Stranger private model',
  canonica: false,
  access: 'private',
  ownerAnimaId: 'anima-stranger',
})

/** A registry that serves the public catalog directly (the MongoIntella shape). */
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

/** A registry that predates `publicCatalog` — the facade must fall back to `canonical()`. */
function legacyRegistry(fixtures: Intella[]): Intellarum {
  return ({
    find: async (id: string) => fixtures.find((i) => i.id === id) ?? null,
    list: async (): Promise<Intellae> => fixtures,
    canonical: async (): Promise<Intellae> => fixtures.filter((i) => i.canonica),
  } as unknown) as Intellarum
}

function apiWith(intellarum: Intellarum): CrystalApi {
  return new CrystalApi(({ intellarum } as unknown) as CrystalApiDeps)
}

const ids = (models: Array<{ intellaId: string }>): string[] => models.map((m) => m.intellaId)

test('listModels includes a user-published model that is not platform-canonical', async () => {
  const api = apiWith(catalogRegistry([seeded, published]))

  const models = await api.listModels()
  assert.deepEqual(ids(models).sort(), ['published-model', 'seeded-model'])
})

test('listModels never returns another owner\'s private model, with or without an auctor', async () => {
  const api = apiWith(catalogRegistry([seeded, published, strangersPrivate]))

  const anon = await api.listModels()
  assert.equal(anon.some((m) => m.intellaId === 'strangers-private-model'), false)

  const scoped = await api.listModels({ auctor: caller })
  assert.equal(scoped.some((m) => m.intellaId === 'strangers-private-model'), false)
})

test('listModels falls back to canonical() against a registry without publicCatalog', async () => {
  const api = apiWith(legacyRegistry([seeded, published]))

  const models = await api.listModels()
  assert.deepEqual(ids(models), ['seeded-model'])
})

test('listModels sort:name is case-insensitive and is applied before the limit slice', async () => {
  // Store order deliberately disagrees with name order, so a sort applied AFTER the slice
  // would return a different first page.
  const fixtures = [
    makeIntella({ id: 'z', nomen: 'zebra weights' }),
    makeIntella({ id: 'a', nomen: 'Alpha weights' }),
    makeIntella({ id: 'm', nomen: 'middle weights' }),
  ]
  const api = apiWith(catalogRegistry(fixtures))

  const sorted = await api.listModels({ sort: 'name' })
  assert.deepEqual(ids(sorted), ['a', 'm', 'z'])

  const firstPage = await api.listModels({ sort: 'name', limit: 1 })
  assert.deepEqual(ids(firstPage), ['a'])

  // An unrecognised ordering degrades to the default rather than erroring.
  const fallback = await api.listModels({ sort: 'not-an-ordering' })
  assert.equal(fallback.length, 3)
})

test('listModels keeps excluding adult-rated entries from the widened public set', async () => {
  const suggestive = makeIntella({
    id: 'published-suggestive',
    nomen: 'Published suggestive',
    canonica: false,
    access: 'public',
    contentRating: 'suggestive',
  })
  const explicit = makeIntella({
    id: 'published-explicit',
    nomen: 'Published explicit',
    canonica: false,
    access: 'public',
    contentRating: 'explicit',
  })
  const api = apiWith(catalogRegistry([seeded, published, suggestive, explicit]))

  const sfw = await api.listModels()
  assert.deepEqual(ids(sfw).sort(), ['published-model', 'seeded-model'])

  const adult = await api.listModels({ includeAdult: true })
  assert.equal(adult.length, 4)
})
