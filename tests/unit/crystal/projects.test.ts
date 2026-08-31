import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import type { Provincia, Provinciae, ProvinciaListOpts, ProvinciaPatch, Provinciarum } from '../../../src/types/provincia.js'
import type { Sodalitas, Sodalitates, Sodalitatum } from '../../../src/types/sodalitas.js'
import type { Dataset, DatasetListOpts } from '../../../src/types/dataset.js'

// =============================================================================
// Projects (Provincia) — account-scoped CRUD + holdings + team sharing.
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
      if (v === undefined) delete (p as unknown as Record<string, unknown>)[k]
      else (p as unknown as Record<string, unknown>)[k] = v
    }
    this.store.set(id, p)
    return p
  }
  async remove(id: string) { this.store.delete(id) }
  // The same access predicate MongoProvinciarum.list puts in the query: the caller's own
  // projects UNION the projects shared with a team the caller is a member of
  // (`opts.sodalitasIds`). With no team ids this is the bare owner filter it has always been.
  async list(opts: ProvinciaListOpts): Promise<Provinciae> {
    const teamIds = new Set(opts.sodalitasIds ?? [])
    return [...this.store.values()].filter(
      (p) => p.animaId === opts.animaId || (p.sodalitasId !== undefined && teamIds.has(p.sodalitasId)),
    )
  }
  async listByOwner(animaId: string): Promise<Provinciae> {
    return this.list({ animaId })
  }
}

/**
 * A minimal Datasets double — enough for the ONE question this suite asks of the dataset
 * surface: does reaching a project widen what its filed dataset ids resolve to? The dataset
 * gate itself (`_ownsDataset`) is exercised by `datasetsRoutes.test.ts`; this double only has
 * to be faithful about which datasets it hands back for a given owner + team set.
 */
class MemDatasets {
  store = new Map<string, Dataset>()
  async find(id: string) { return this.store.get(id) ?? null }
  async create(input: Omit<Dataset, 'id' | 'natum' | 'mutatum'>): Promise<Dataset> {
    const now = new Date()
    const full: Dataset = { ...input, id: randomUUID(), natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
  private _readable(opts: DatasetListOpts): Dataset[] {
    const teamIds = new Set(opts.sodalitasIds ?? [])
    return [...this.store.values()].filter(
      (d) => d.owner === opts.owner || (d.sodalitasId !== undefined && teamIds.has(d.sodalitasId)),
    )
  }
  async list(opts: DatasetListOpts) { return { entries: this._readable(opts) } }
  async listSummaries(opts: DatasetListOpts) {
    return { entries: this._readable(opts).map((d) => ({ id: d.id, name: d.name, images: d.media.length })) }
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
  const datasets = new MemDatasets()
  const api = new CrystalApi({
    provinciarum: provinciae, sodalitatum: sodalitates, datasets,
  } as unknown as CrystalApiDeps)
  return { api, provinciae, sodalitates, datasets }
}

const ANIMA = { animaId: 'anima-1' } as const
const OTHER = { animaId: 'anima-2' } as const
/** In the team with ANIMA wherever a suite seeds one; never the owner of anything. */
const MEMBER = { animaId: 'anima-3' } as const

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

// ── Team sharing (noema-381) ─────────────────────────────────────────────────
//
// `Provincia.sodalitasId` is stored, validated on write and projected as `teamId`. This block
// is what it GRANTS: `Collectio`/`Dataset`'s overlay reused, not a second sharing vocabulary.
// One test per claim the design makes, and one per claim it deliberately does NOT make — a
// member reads and files, the verbs that remove stay with the owner, a non-member is closed out
// of every route, and reaching a project widens nothing about the assets it files.

/** Owner (ANIMA) + a team holding MEMBER + a project shared with it. OTHER is in neither. */
async function seedShared() {
  const kit = makeApi()
  const team = await kit.sodalitates.create({
    nomen: 'House look', auctor: ANIMA.animaId, membra: [ANIMA.animaId, MEMBER.animaId],
  })
  const project = await kit.api.createProject(ANIMA, { name: 'Shared lens', teamId: team.id })
  return { ...kit, team, project }
}

test('a team member reads a shared project on the list route and through getProject', async () => {
  const { api, project, team } = await seedShared()

  const resolved = await api.getProject(MEMBER, project.id)
  assert.equal(resolved.id, project.id)
  assert.equal(resolved.owner, ANIMA.animaId, 'reading it does not make the member its owner')
  assert.equal(resolved.teamId, team.id)

  const list = await api.listProjects(MEMBER)
  assert.deepEqual(list.map((p) => p.id), [project.id])
})

test('a team member may file an asset into a shared project, but not unfile one', async () => {
  // The line noema-374 drew on the Dataset overlay, drawn again here: additive verbs widen to
  // members, the verbs that remove stay with the owner.
  const { api, project } = await seedShared()

  const filed = await api.fileAsset(MEMBER, project.id, 'model', 'intella-of-member')
  assert.deepEqual(filed.modelIds, ['intella-of-member'], 'a member contributes to the shared lens')

  await assert.rejects(
    () => api.unfileAsset(MEMBER, project.id, 'model', 'intella-of-member'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
  )
  // A 404 can be returned after a write — assert the holding is untouched.
  assert.deepEqual((await api.getProject(ANIMA, project.id)).modelIds, ['intella-of-member'])

  // The owner can still do it — the refusal is about WHO, not a route that stopped working.
  assert.deepEqual((await api.unfileAsset(ANIMA, project.id, 'model', 'intella-of-member')).modelIds, [])
})

test('a team member may not patch or delete a shared project', async () => {
  // `teamId` IS the sharing decision, so patching is not on the member side of any line: a
  // member reaching it could re-point the project at a team of their own or clear the reference
  // and lock every other member out.
  const { api, project, sodalitates, team } = await seedShared()
  const mine = await sodalitates.create({ nomen: "Member's own", auctor: MEMBER.animaId, membra: [MEMBER.animaId] })

  const refused: Array<[string, () => Promise<unknown>]> = [
    ['rename', () => api.updateProject(MEMBER, project.id, { name: 'renamed by a member' })],
    ['re-point the team', () => api.updateProject(MEMBER, project.id, { teamId: mine.id })],
    ['clear the team', () => api.updateProject(MEMBER, project.id, { teamId: null })],
    ['delete', () => api.deleteProject(MEMBER, project.id)],
  ]
  for (const [name, call] of refused) {
    await assert.rejects(
      call,
      (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
      `${name}: a member reads as absent on the owner's verbs, not forbidden`,
    )
  }

  const after = await api.getProject(ANIMA, project.id)
  assert.equal(after.name, 'Shared lens', 'no refused call left a trace')
  assert.equal(after.teamId, team.id, 'the share still points where the owner put it')
})

test('a NON-member is refused on every route of a team-shared project', async () => {
  // The closure assertion restated against a project that is genuinely shared rather than
  // private: sharing with a named fellowship is not publishing. Always not_found rather than
  // forbidden, so ids stay non-enumerable.
  const { api, project } = await seedShared()

  assert.deepEqual(await api.listProjects(OTHER), [], "a non-member's own list stays empty")
  const refused: Array<[string, () => Promise<unknown>]> = [
    ['getProject', () => api.getProject(OTHER, project.id)],
    ['updateProject', () => api.updateProject(OTHER, project.id, { name: 'renamed by a stranger' })],
    ['deleteProject', () => api.deleteProject(OTHER, project.id)],
    ['fileAsset', () => api.fileAsset(OTHER, project.id, 'model', 'intella-of-other')],
    ['unfileAsset', () => api.unfileAsset(OTHER, project.id, 'model', 'intella-of-other')],
  ]
  for (const [name, call] of refused) {
    await assert.rejects(
      call,
      (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
      `${name}: a non-member reads as absent, not forbidden`,
    )
  }

  const after = await api.getProject(ANIMA, project.id)
  assert.equal(after.name, 'Shared lens')
  assert.deepEqual(after.modelIds, [], "the stranger's fileAsset attempt left no trace")
})

test('an unshared project stays owner-only for a team-mate of the owner', async () => {
  // The overlay is opt-in per project, not per person: being in a team with someone does not
  // open the projects they did NOT share with it. This is what keeps `sodalitasId: undefined` —
  // every project written before this field was consulted — closed.
  const { api, sodalitates } = makeApi()
  await sodalitates.create({ nomen: 'House look', auctor: ANIMA.animaId, membra: [ANIMA.animaId, MEMBER.animaId] })
  const priv = await api.createProject(ANIMA, { name: 'Private lens' })
  assert.equal(priv.teamId, undefined, 'no teamId means no overlay')

  assert.deepEqual(await api.listProjects(MEMBER), [])
  await assert.rejects(
    () => api.getProject(MEMBER, priv.id),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
  )
  await assert.rejects(
    () => api.fileAsset(MEMBER, priv.id, 'model', 'intella-of-member'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
  )
})

test('removing a member from the team closes the project to them again', async () => {
  // Membership is read live off the Sodalitas, never snapshotted onto the project — that is what
  // makes the team store the single source of who may read, and what makes a removal take effect
  // without touching every project the team shares.
  const { api, sodalitates, team, project } = await seedShared()
  assert.equal((await api.listProjects(MEMBER)).length, 1)

  await sodalitates.update(team.id, { membra: [ANIMA.animaId] })

  assert.deepEqual(await api.listProjects(MEMBER), [])
  await assert.rejects(
    () => api.getProject(MEMBER, project.id),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
  )
  await assert.rejects(
    () => api.fileAsset(MEMBER, project.id, 'model', 'intella-of-member'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
  )
})

test('a shared project does not lend the datasets it files — the asset keeps its own gate', async () => {
  // THE TRAP. A project shared with a team may file datasets that are NOT shared with that team;
  // that is a coherent state, and reaching the project must not resolve them. A holding is a
  // reference — a NAME for an asset — and the store that owns the asset keeps its own gate.
  const { api, datasets, team, project } = await seedShared()

  const unshared = await datasets.create({
    owner: ANIMA.animaId, name: 'Owner-only set', modality: 'image', custody: 'local',
    media: [], captionsets: [], versions: [],
  })
  const alsoShared = await datasets.create({
    owner: ANIMA.animaId, sodalitasId: team.id, name: 'Team set', modality: 'image', custody: 'local',
    media: [], captionsets: [], versions: [],
  })
  await api.fileAsset(ANIMA, project.id, 'dataset', unshared.id)
  await api.fileAsset(ANIMA, project.id, 'dataset', alsoShared.id)

  // The member reaches the project and sees both ids — holdings are the project's content.
  const seen = await api.getProject(MEMBER, project.id)
  assert.deepEqual(seen.datasetIds, [unshared.id, alsoShared.id])

  // And the id buys nothing. The dataset the team does NOT hold stays absent to the member, on
  // the id-resolving read and on the list route both.
  await assert.rejects(
    () => api.getDataset(MEMBER, unshared.id),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.dataset',
    'a filed reference does not resolve a dataset the team was never given',
  )
  const listed = await api.listDatasets(MEMBER)
  assert.deepEqual(listed.datasets.map((d) => d.id), [alsoShared.id],
    'only the dataset shared with the team is listed — the project is not a second grant')

  // The discrimination is real, not a blanket refusal: the same member resolves the dataset that
  // IS shared with the team, through the dataset's own overlay and not through the project.
  assert.equal((await api.getDataset(MEMBER, alsoShared.id)).id, alsoShared.id)

  // And the owner is unaffected by any of it.
  assert.equal((await api.getDataset(ANIMA, unshared.id)).id, unshared.id)
})

test('the account export stays owner-only — it does not inherit the team overlay', async () => {
  // `listByOwner` is the seam MeExporter reads: an export is what the account OWNS, never what a
  // team lent it. It is deliberately narrower than `list` and has no `sodalitasIds` seam at all.
  const { provinciae, team } = await seedShared()
  assert.deepEqual(await provinciae.listByOwner(MEMBER.animaId), [])
  assert.deepEqual((await provinciae.listByOwner(ANIMA.animaId)).map((p) => p.sodalitasId), [team.id])
})

test('with no team store wired a project shares nothing', async () => {
  // FAIL CLOSED. With no `sodalitatum` dep there is nothing that can affirm membership, so the
  // overlay grants no read at all — the convention `_ownedStudio` follows with no Conductor.
  const provinciae = new MemProvinciarum()
  const api = new CrystalApi({ provinciarum: provinciae } as unknown as CrystalApiDeps)

  // A project already carrying an overlay is unreadable by a would-be member, not readable.
  const stored = await provinciae.create({
    animaId: ANIMA.animaId, sodalitasId: 'team-1', nomen: 'Legacy shared',
    datasetIds: [], modelIds: [], collectionIds: [],
  })
  await assert.rejects(
    () => api.getProject(MEMBER, stored.id),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.project',
  )
  assert.deepEqual(await api.listProjects(MEMBER), [])

  // And a team cannot be named when no team store can affirm it.
  await assert.rejects(
    () => api.createProject(ANIMA, { name: 'Shared', teamId: 'team-1' }),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.team',
  )
})
