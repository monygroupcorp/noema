import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import type { Provincia, Provinciae, ProvinciaPatch, Provinciarum } from '../../../src/types/provincia.js'
import type { Sodalitas, Sodalitates, Sodalitatum } from '../../../src/types/sodalitas.js'

// =============================================================================
// Projects (Provincia) — account-scoped CRUD + holdings + team-reference.
// Exercises CrystalApi's project surface against in-memory stores.
// =============================================================================

/** In-memory Provinciarum (project store) for the test. */
class MemProvinciarum implements Provinciarum {
  store = new Map<string, Provincia>()
  async find(id: string) { return this.store.get(id) ?? null }
  async create(input: Omit<Provincia, 'id' | 'natum' | 'mutatum'>) {
    const now = new Date()
    const full: Provincia = { ...input, id: randomUUID(), natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: ProvinciaPatch) {
    // Model Mongo's $set/$unset split: an undefined patch value REMOVES the key (it does not
    // store a present-but-undefined/null field). This mirrors MongoProvinciarum so the clear
    // path is faithfully asserted here too (an E2E-caught quirk: $set:{x:undefined}→null).
    const p: Provincia = { ...this.store.get(id)!, mutatum: new Date() }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (p as Record<string, unknown>)[k]
      else (p as Record<string, unknown>)[k] = v
    }
    this.store.set(id, p)
    return p
  }
  async remove(id: string) { this.store.delete(id) }
  async listByOwner(animaId: string): Promise<Provinciae> {
    return [...this.store.values()].filter((p) => p.animaId === animaId)
  }
}

/** Minimal in-memory Sodalitatum for the team-reference path. */
class MemSodalitatum implements Sodalitatum {
  store = new Map<string, Sodalitas>()
  async find(id: string) { return this.store.get(id) ?? null }
  async create(s: Omit<Sodalitas, 'id' | 'natum'>) {
    const full: Sodalitas = { ...s, id: randomUUID(), natum: new Date() }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: Partial<Pick<Sodalitas, 'membra' | 'nomen'>>) {
    const s = { ...this.store.get(id)!, ...patch }
    this.store.set(id, s)
    return s
  }
  async listByMember(animaId: string): Promise<Sodalitates> {
    return [...this.store.values()].filter((s) => s.membra.includes(animaId))
  }
}

function makeApi() {
  const provinciae = new MemProvinciarum()
  const sodalitates = new MemSodalitatum()
  const api = new CrystalApi({ provinciarum: provinciae, sodalitatum: sodalitates } as unknown as CrystalApiDeps)
  return { api, provinciae, sodalitates }
}

const ANIMA = { animaId: 'anima-1' } as const
const OTHER = { animaId: 'anima-2' } as const

test('createProject: owned by the caller, holdings start empty', async () => {
  const { api } = makeApi()
  const p = await api.createProject(ANIMA, { name: 'Dragon Game', desc: 'concept art', glyph: 'D', color: '#5b8cff' })
  assert.equal(p.owner, 'anima-1')
  assert.equal(p.name, 'Dragon Game')
  assert.equal(p.desc, 'concept art')
  assert.equal(p.glyph, 'D')
  assert.deepEqual(p.datasetIds, [])
  assert.deepEqual(p.modelIds, [])
  assert.deepEqual(p.collectionIds, [])
})

test('listProjects/getProject: owner-scoped, cross-account 404', async () => {
  const { api } = makeApi()
  const mine = await api.createProject(ANIMA, { name: 'Mine' })
  await api.createProject(OTHER, { name: 'Theirs' })

  const list = await api.listProjects(ANIMA)
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Mine')

  // The other account cannot fetch my project.
  await assert.rejects(() => api.getProject(OTHER, mine.id), /not found/i)
})

test('fileAsset/unfileAsset: idempotent holdings by kind', async () => {
  const { api } = makeApi()
  const p = await api.createProject(ANIMA, { name: 'P' })

  const a = await api.fileAsset(ANIMA, p.id, 'model', 'intella-9')
  assert.deepEqual(a.modelIds, ['intella-9'])
  // Idempotent re-file — no duplicate.
  const b = await api.fileAsset(ANIMA, p.id, 'model', 'intella-9')
  assert.deepEqual(b.modelIds, ['intella-9'])

  await api.fileAsset(ANIMA, p.id, 'dataset', 'ds-1')
  const c = await api.fileAsset(ANIMA, p.id, 'collection', 'col-1')
  assert.deepEqual(c.datasetIds, ['ds-1'])
  assert.deepEqual(c.collectionIds, ['col-1'])

  const d = await api.unfileAsset(ANIMA, p.id, 'model', 'intella-9')
  assert.deepEqual(d.modelIds, [])
  // Unfiling an absent id is a no-op, not an error.
  const e = await api.unfileAsset(ANIMA, p.id, 'model', 'intella-9')
  assert.deepEqual(e.modelIds, [])
})

test('fileAsset: unknown kind is a 400', async () => {
  const { api } = makeApi()
  const p = await api.createProject(ANIMA, { name: 'P' })
  await assert.rejects(() => api.fileAsset(ANIMA, p.id, 'widget', 'x'), /unknown holding kind/i)
})

test('updateProject: patch metadata + clear team reference', async () => {
  const { api, sodalitates } = makeApi()
  const team = await sodalitates.create({ nomen: 'Band', auctor: 'anima-1', membra: ['anima-1'] })
  const p = await api.createProject(ANIMA, { name: 'Old', teamId: team.id })
  assert.equal(p.teamId, team.id)

  const renamed = await api.updateProject(ANIMA, p.id, { name: 'New' })
  assert.equal(renamed.name, 'New')
  assert.equal(renamed.teamId, team.id) // unchanged

  const cleared = await api.updateProject(ANIMA, p.id, { teamId: null })
  assert.equal(cleared.teamId, undefined)
  assert.ok(!('teamId' in cleared), 'cleared DTO omits teamId entirely (no null)')
})

test('createProject with teamId: caller must be a member', async () => {
  const { api, sodalitates } = makeApi()
  const team = await sodalitates.create({ nomen: 'Closed', auctor: 'anima-2', membra: ['anima-2'] })
  await assert.rejects(() => api.createProject(ANIMA, { name: 'X', teamId: team.id }), /not found/i)
})

test('deleteProject: owner-only; then gone', async () => {
  const { api } = makeApi()
  const p = await api.createProject(ANIMA, { name: 'Temp' })
  await assert.rejects(() => api.deleteProject(OTHER, p.id), /not found/i)
  await api.deleteProject(ANIMA, p.id)
  assert.equal((await api.listProjects(ANIMA)).length, 0)
})

test('projects require an identified account (no commitment/anon)', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.createProject({ commitment: 'c-abc' } as never, { name: 'Anon' }),
    /identified account/i,
  )
})

test('project ops 404 when no store is wired', async () => {
  const api = new CrystalApi({} as unknown as CrystalApiDeps)
  await assert.rejects(() => api.listProjects(ANIMA), /not found/i)
})
