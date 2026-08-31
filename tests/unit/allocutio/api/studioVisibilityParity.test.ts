// =============================================================================
// Studio visibility parity — `/v1/me/status` vs `/v1/studios/:id`
// =============================================================================
//
// Both surfaces answer a question about the SAME caller's SAME studios, so they must
// not disagree about whether those studios exist:
//
//   `/v1/me/status`   → lexicon/status/aggregate.buildStudios (Hospitium by hostKey)
//   `/v1/studios/:id` → Conductor.getStudio                   (Hospitium by hostKey)
//
// Both are driven for real here — one CrystalApi over one set of in-memory stores, one
// identity — across every state a `Materia` can hold, so a status value that only one
// side is willing to report is a failure rather than a difference nobody looks at.
//
// The stranger half is asserted in the same breath: widening what an OWNER may read must
// not widen what anyone else can learn. A stranger's read of a real studio and their read
// of an id with nothing behind it must be the same answer (`not_found.studio`, never
// `forbidden`), or studio ids become enumerable.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { Conductor } from '../../../../src/crystal/Conductor.js'
import { MemoryModo } from '../../../../src/execution/MemoryModo.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import type { Materia, MateriaStore, MateriaStatus, PodPolicy } from '../../../../src/types/materia.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../../src/types/hospitium.js'

// Typed as `HostKey` — the host half of the AuctorKey union, which is what a Hospitium records
// and what both scoping predicates compare. Every API call below takes it as an AuctorKey.
const ALICE: HostKey = { animaId: 'anima-alice' }
const STRANGER: HostKey = { animaId: 'anima-stranger' }
/** A session id with no studio behind it — the "genuine stranger" control. */
const NO_SUCH_STUDIO = 'modo-nothing-here'

// ── In-memory stores (same shape as the Conductor's own test doubles) ────────
class FakeMateriae implements MateriaStore {
  byId = new Map<string, Materia>()
  add(m: Materia): void { this.byId.set(m.id, m) }
  async create(input: Omit<Materia, 'id'>): Promise<Materia> {
    const m = { ...input, id: `mat-${this.byId.size + 1}` } as Materia
    this.byId.set(m.id, m); return m
  }
  async findById(id: string): Promise<Materia | null> { return this.byId.get(id) ?? null }
  async update(id: string, patch: Partial<Materia>): Promise<Materia> {
    const cur = this.byId.get(id); if (!cur) throw new Error('not found')
    const next = { ...cur, ...patch }; this.byId.set(id, next); return next
  }
  async findWarm(_s: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string }): Promise<Materia | null> { return null }
  async findActive(): Promise<Materia[]> { return [...this.byId.values()].filter(m => m.status !== 'terminated') }
  async reapIdle(_now: Date): Promise<Materia[]> { return [] }
}

class FakeHospitia implements HospitiumStore {
  records: Hospitium[] = []
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `h-${this.records.length + 1}`, ...input }
    this.records.push(h); return h
  }
  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    return this.records.find(h => h.materiaId === materiaId) ?? null
  }
  async findByModoId(modoId: string): Promise<Hospitium | null> {
    return this.records.find(h => h.modoId === modoId) ?? null
  }
  async bindMateria(modoId: string, materiaId: string): Promise<Hospitium> {
    const h = this.records.find(r => r.modoId === modoId); if (!h) throw new Error('not found')
    h.materiaId = materiaId; return h
  }
  async findActive(): Promise<Hospitium[]> { return this.records.filter(h => !h.terminatum) }
  async update(materiaId: string, patch: Partial<Hospitium>): Promise<Hospitium> {
    const h = this.records.find(r => r.materiaId === materiaId); if (!h) throw new Error('not found')
    Object.assign(h, patch); return h
  }
}

/** One studio per state the pair has to agree on. `want` is the studio-facing status
 *  BOTH surfaces must report — they share `materiaStudioStatus`, so a disagreement can
 *  only come from one side refusing to report the studio at all. */
const CASES: Array<{
  name: string
  materiaStatus: MateriaStatus
  modoStatus: 'claiming' | 'warming' | 'active' | 'idle'
  drainOnly?: boolean
  want: string
  live: boolean
}> = [
  { name: 'warm',       materiaStatus: 'idle',       modoStatus: 'idle',    want: 'idle',         live: true },
  { name: 'booting',    materiaStatus: 'warming',    modoStatus: 'warming', want: 'provisioning', live: true },
  { name: 'running',    materiaStatus: 'active',     modoStatus: 'active',  want: 'running',      live: true },
  { name: 'draining',   materiaStatus: 'active',     modoStatus: 'active',  drainOnly: true, want: 'draining', live: true },
  // The reaped pod: the idle reaper / Census watchdog terminates the Materia and leaves the
  // session record stale-`idle`. The host record is never closed, so /v1/me/status keeps
  // reporting the studio — which is exactly the id an operator then tries to read.
  { name: 'reaped',     materiaStatus: 'terminated', modoStatus: 'idle',    want: 'terminated',   live: false },
]

async function seed(): Promise<{ api: CrystalApi; conductor: Conductor }> {
  const materiae = new FakeMateriae()
  const hospitia = new FakeHospitia()
  const modos = new MemoryModo()
  const signorum = new MemorySignorum()

  for (const c of CASES) {
    const materia = await materiae.create({
      genus: 'runpod', externusId: `pod-${c.name}`, gpu: 'NVIDIA RTX 4090', vramGb: 24, ramGb: 32,
      imageRef: `noema/${c.name}:1`, impetusPerSecond: 1n, status: c.materiaStatus,
      ...(c.drainOnly ? { drainOnly: true } : {}),
    })
    const modo = await modos.create({
      status: c.modoStatus, materiamId: materia.id, impetusAccrued: 0n, acta: [], idleWarmthSec: 300,
    })
    await hospitia.create({ modoId: modo.id, materiaId: materia.id, hostKey: ALICE, inceptum: new Date() })
  }
  // A studio belonging to somebody else — it must never surface on Alice's side of either endpoint.
  const theirs = await materiae.create({
    genus: 'runpod', externusId: 'pod-theirs', gpu: 'NVIDIA H100', vramGb: 80, ramGb: 200,
    imageRef: 'noema/theirs:1', impetusPerSecond: 1n, status: 'idle',
  })
  const theirModo = await modos.create({
    status: 'idle', materiamId: theirs.id, impetusAccrued: 0n, acta: [], idleWarmthSec: 300,
  })
  await hospitia.create({ modoId: theirModo.id, materiaId: theirs.id, hostKey: STRANGER, inceptum: new Date() })

  const unused = (name: string) => new Proxy({}, {
    get: () => () => { throw new Error(`${name} is not exercised by the studio-visibility tests`) },
  })
  const conductor = new Conductor({
    procurator: unused('procurator') as never,
    opener: unused('opener') as never,
    materiae, modos, hospitia,
  })
  const deps = ({
    inceptor: unused('inceptor'), modorum: unused('modorum'), cursorum: unused('cursorum'),
    completor: unused('completor'), actorum: unused('actorum'), fundamentorum: unused('fundamentorum'),
    signorum, hospitia, materiae, modos, conductor,
  } as unknown) as CrystalApiDeps
  return { api: new CrystalApi(deps), conductor }
}

const isNotFoundStudio = (e: unknown): boolean => e instanceof ApiError && e.code === 'not_found.studio'

// ── The pair ─────────────────────────────────────────────────────────────────

test('every studio /v1/me/status reports for the owner reads back on /v1/studios/:id', async () => {
  const { api } = await seed()

  const reported = (await api.status(ALICE)).studios as Array<{ studioId: string; status: string }>
  assert.equal(reported.length, CASES.length, 'the owner\'s studios, one row per state under test')

  for (const row of reported) {
    const studio = await api.getStudio(ALICE, row.studioId)
    assert.equal(studio.studioId, row.studioId, `${row.status}: the id /v1/me/status hands out is the id that resolves`)
    assert.equal(studio.status, row.status, `${row.status}: both surfaces report the same state`)
  }

  const states = new Set(reported.map(r => r.status))
  for (const c of CASES) assert.ok(states.has(c.want), `the ${c.want} state is covered`)
})

test('the live list stays live-only, and dropping off it does not make a studio unreadable', async () => {
  const { api } = await seed()

  const listed = (await api.listStudios(ALICE)).map(s => s.status)
  assert.equal(listed.length, CASES.filter(c => c.live).length, 'GET /v1/studios lists live studios only')
  assert.ok(!listed.includes('terminated'), 'a terminated studio is not a live studio')

  const terminated = ((await api.status(ALICE)).studios as Array<{ studioId: string; status: string }>)
    .find(s => s.status === 'terminated')
  assert.ok(terminated, '/v1/me/status still reports it')
  assert.equal((await api.getStudio(ALICE, terminated!.studioId)).status, 'terminated',
    'and GET /v1/studios/:id reports its state instead of claiming it does not exist')
})

// ── Stranger closure ─────────────────────────────────────────────────────────

test('a stranger cannot tell one of the owner\'s studios from an id that has no studio', async () => {
  const { api } = await seed()

  const reported = (await api.status(ALICE)).studios as Array<{ studioId: string; status: string }>
  for (const row of reported) {
    await assert.rejects(() => api.getStudio(STRANGER, row.studioId), isNotFoundStudio,
      `${row.status}: another host's studio is not_found, never forbidden`)
  }
  await assert.rejects(() => api.getStudio(STRANGER, NO_SUCH_STUDIO), isNotFoundStudio,
    'an id with nothing behind it answers identically — the two are indistinguishable')
  await assert.rejects(() => api.getStudio(ALICE, NO_SUCH_STUDIO), isNotFoundStudio,
    'and the owner gets the same answer for an id they do not host — reading is not enumerating')
})

test('a stranger\'s own surfaces show only their own studio', async () => {
  const { api } = await seed()

  const theirs = (await api.status(STRANGER)).studios as Array<{ studioId: string }>
  assert.equal(theirs.length, 1, 'the host key scopes /v1/me/status the same way on both sides')

  const aliceIds = new Set(((await api.status(ALICE)).studios as Array<{ studioId: string }>).map(s => s.studioId))
  assert.ok(!aliceIds.has(theirs[0].studioId), 'no cross-host bleed')
  await assert.rejects(() => api.getStudio(ALICE, theirs[0].studioId), isNotFoundStudio)
})
