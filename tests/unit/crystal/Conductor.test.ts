// Conductor — the studio-lifecycle anchor (ADR-0006).
//
// Exercises conducere (provision → install → open Modo → bind), find (host→studio
// join), and claudere (release), over in-memory stores + a stub Procurator. The
// stub Procurator mirrors SecurePodClient/_parkWarm: on provisionStudio it parks a
// Materia (externusId = podId) and pairs a Hospitium when given a hostKey — so the
// host-less-studio bug is observable (a Hospitium with the right hostKey MUST exist).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Conductor } from '../../../src/crystal/Conductor.js'
import type { Procurator, StudioProvision } from '../../../src/crystal/Procurator.js'
import { TesseraCursor } from '../../../src/crystal/TesseraCursor.js'
import { MemoryModo } from '../../../src/execution/MemoryModo.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import type { Cursor } from '../../../src/types/cursus.js'
import type { Materia, MateriaStore, PodPolicy } from '../../../src/types/materia.js'
import type { Hospitium, HospitiumStore } from '../../../src/types/hospitium.js'
import type { AuctorKey } from '../../../src/flow/types.js'

// ── In-memory stores ────────────────────────────────────────────────────────
class FakeMateriae implements MateriaStore {
  byId = new Map<string, Materia>()
  private seq = 0
  async create(input: Omit<Materia, 'id'>): Promise<Materia> {
    const m = { ...input, id: `mat-${++this.seq}` } as Materia
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
  private seq = 0
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `h-${++this.seq}`, ...input }; this.records.push(h); return h
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
  async update(materiaId: string, patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>): Promise<Hospitium> {
    const h = this.records.find(r => r.materiaId === materiaId); if (!h) throw new Error('not found')
    Object.assign(h, patch); return h
  }
}

// Stub Procurator — parks a Materia (no Hospitium: the Conductor owns the studio's
// host record, and is NOT given a hostKey, so a real Procurator wouldn't pair one).
function makeProcurator(materiae: FakeMateriae, _hospitia: FakeHospitia, opts: { failAll?: boolean } = {}): Procurator & { stages: string[] } {
  const stages: string[] = []
  return {
    stages,
    async provisionStudio(o = {}, onStage): Promise<StudioProvision | null> {
      if (opts.failAll) return null
      onStage?.('provisioning'); stages.push('provisioning')
      const podId = `pod-${materiae.byId.size + 1}`
      await materiae.create({
        genus: 'runpod', externusId: podId, gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
        imageRef: 'img:1', impetusPerSecond: 4n, status: 'idle',
        warmUntil: new Date(Date.now() + (o.warmMs ?? 60_000)), bootCostImpetus: 0n,
        ...(o.runtime ? { runtime: o.runtime } : {}),
      })
      onStage?.('comfy-ready'); stages.push('comfy-ready')
      return { podId, gpuType: 'RTX 4090', costPerHr: 0.69, provisionMs: 1234 }
    },
  }
}

function makeConductor(extra: { failAll?: boolean; installLive?: (m: Materia, ids: string[]) => Promise<unknown>; terminate?: (podId: string) => Promise<void> } = {}) {
  const materiae = new FakeMateriae()
  const hospitia = new FakeHospitia()
  const modos = new MemoryModo()
  const signorum = new MemorySignorum()
  const opener = new TesseraCursor({} as unknown as Cursor, modos, signorum)
  const procurator = makeProcurator(materiae, hospitia, { ...(extra.failAll ? { failAll: true } : {}) })
  const conductor = new Conductor({
    procurator, opener, materiae, modos, hospitia,
    ...(extra.installLive ? { installLive: extra.installLive } : {}),
    ...(extra.terminate ? { terminate: extra.terminate } : {}),
  })
  return { conductor, materiae, hospitia, modos, signorum, procurator }
}

const AUCTOR: AuctorKey = { animaId: 'anima-host' }

// ── conducere ────────────────────────────────────────────────────────────────
test('conducere leases a studio: binds the Modo to the pod + opens a budget tessera', async () => {
  const { conductor, signorum, modos } = makeConductor()
  const handle = await conductor.conducere(AUCTOR, { budget: 5000n, warmMs: 90_000, runtime: 'ComfyUI' })

  assert.ok(handle, 'a handle is returned')
  assert.equal(handle!.studioId, handle!.modo.id, 'studioId IS the modo id')
  assert.equal(handle!.modo.materiamId, handle!.materia!.id, 'modo bound to the materia')
  assert.equal(handle!.modo.status, 'idle', 'studio is warm + resting')
  assert.equal(handle!.provision?.podId, handle!.materia!.externusId)
  // The budget tessera is issued against the modo, valor = budget
  const budget = await signorum.sessionBudget(handle!.studioId)
  assert.equal(budget, 5000n, 'tessera budget = the requested budget')
  // The bound modo is persisted
  const persisted = await modos.findById(handle!.studioId)
  assert.equal(persisted?.materiamId, handle!.materia!.id)
})

test('conducere fixes the host-less bug: a Hospitium keyed by the auctor always exists', async () => {
  const { conductor, hospitia } = makeConductor()
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  const h = await hospitia.findByMateriaId(handle!.materia!.id)
  assert.ok(h, 'a Hospitium was paired')
  assert.deepEqual(h!.hostKey, AUCTOR, 'host is the leasing auctor — never host-less')
})

test('conducere installs the loadout live onto the parked pod', async () => {
  const installed: Array<{ materiaId: string; ids: string[] }> = []
  const { conductor } = makeConductor({
    installLive: async (m, ids) => { installed.push({ materiaId: m.id, ids }); return undefined },
  })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n, models: ['lora-a', 'lora-b'] })
  assert.equal(installed.length, 1)
  assert.equal(installed[0].materiaId, handle!.materia!.id)
  assert.deepEqual(installed[0].ids, ['lora-a', 'lora-b'])
})

test('conducere returns null when provisioning fails', async () => {
  const { conductor } = makeConductor({ failAll: true })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  assert.equal(handle, null)
})

// ── find ──────────────────────────────────────────────────────────────────────
test('find returns the auctor\'s leased studios, scoped by host', async () => {
  const { conductor } = makeConductor()
  const a = await conductor.conducere(AUCTOR, { budget: 1000n })
  const other: AuctorKey = { commitment: '0xbeef' }
  await conductor.conducere(other, { budget: 1000n })

  const mine = await conductor.find(AUCTOR)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].studioId, a!.studioId)

  const theirs = await conductor.find(other)
  assert.equal(theirs.length, 1)
  assert.notEqual(theirs[0].studioId, a!.studioId)

  const stranger = await conductor.find({ animaId: 'nobody' })
  assert.equal(stranger.length, 0)
})

test('find excludes studios whose pod (Materia) is terminated — reports LIVE studios only', async () => {
  const { conductor, materiae } = makeConductor()
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  assert.equal((await conductor.find(AUCTOR)).length, 1, 'live studio is listed')

  // Reap the pod (idle reaper / external kill) — the bound Modo stays stale-`idle`.
  await materiae.update(handle!.materia!.id, { status: 'terminated' })
  const live = await conductor.find(AUCTOR)
  assert.equal(live.length, 0, 'a terminated-pod studio is no longer listed, despite the stale Modo')
})

// ── claudere ────────────────────────────────────────────────────────────────
test('claudere releases the studio: terminates the pod + closes session/materia/hospitium', async () => {
  const terminated: string[] = []
  const { conductor, materiae, modos, hospitia } = makeConductor({ terminate: async (p) => { terminated.push(p) } })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  const podId = handle!.materia!.externusId!

  const ok = await conductor.claudere(handle!.studioId, AUCTOR)
  assert.equal(ok, true)
  assert.deepEqual(terminated, [podId], 'the pod was terminated')
  assert.equal((await modos.findById(handle!.studioId))?.status, 'terminated')
  assert.equal((await materiae.findById(handle!.materia!.id))?.status, 'terminated')
  assert.ok((await hospitia.findByMateriaId(handle!.materia!.id))?.terminatum)
})

test('claudere refuses a studio the caller does not host', async () => {
  const { conductor } = makeConductor({ terminate: async () => {} })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  const ok = await conductor.claudere(handle!.studioId, { animaId: 'intruder' })
  assert.equal(ok, false)
})

// ── conducereAsync + getStudio (the async API path) ───────────────────────────
async function settleStatus(modos: MemoryModo, id: string, want: string): Promise<void> {
  for (let i = 0; i < 100 && (await modos.findById(id))?.status !== want; i++) {
    await new Promise(r => setTimeout(r, 5))
  }
}

test('conducereAsync returns immediately (claiming, no pod) then binds in the background', async () => {
  const { conductor, modos, hospitia } = makeConductor()
  const handle = await conductor.conducereAsync(AUCTOR, { budget: 2000n })

  // Immediately: a studioId + claiming session, no pod yet — but already owner-scoped.
  assert.equal(handle.studioId, handle.modo.id)
  assert.equal(handle.modo.status, 'claiming')
  assert.equal(handle.materia, undefined, 'no pod bound yet')
  const hostRec = await hospitia.findByModoId(handle.studioId)
  assert.deepEqual(hostRec?.hostKey, AUCTOR, 'host record exists before the pod parks (owner-scopable in-flight)')

  // The background boot settles → bound + idle.
  await settleStatus(modos, handle.studioId, 'idle')
  const settled = await modos.findById(handle.studioId)
  assert.equal(settled?.status, 'idle')
  assert.ok(settled?.materiamId, 'modo bound to a materia')
  assert.ok((await hospitia.findByModoId(handle.studioId))?.materiaId, 'host record got its materiaId bound')
})

test('conducereAsync marks the studio terminated when provisioning fails', async () => {
  const { conductor, modos } = makeConductor({ failAll: true })
  const handle = await conductor.conducereAsync(AUCTOR, { budget: 1000n })
  await settleStatus(modos, handle.studioId, 'terminated')
  assert.equal((await modos.findById(handle.studioId))?.status, 'terminated')
})

test('getStudio is owner-scoped by studioId — in-flight included, strangers refused', async () => {
  const { conductor } = makeConductor()
  const handle = await conductor.conducereAsync(AUCTOR, { budget: 1000n })
  const mine = await conductor.getStudio(handle.studioId, AUCTOR)
  assert.ok(mine, 'owner reads their provisioning studio')
  assert.equal(mine!.studioId, handle.studioId)
  assert.equal(await conductor.getStudio(handle.studioId, { animaId: 'intruder' }), null, 'stranger gets nothing — no leak')
})

// ── getStudio: liveness vs addressability ────────────────────────────────────
// `find` and run-targeting ask whether a studio is LIVE; reading one by id asks whether it
// is the caller's. Those are different questions over the same owner gate, and only the
// liveness one may hide a studio the caller hosts.

test('getStudio reads back an owned studio whose pod was reaped; find still lists live only', async () => {
  const { conductor, materiae } = makeConductor()
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })

  // The idle reaper / Census watchdog kills the pod; the session record stays stale-`idle`.
  await materiae.update(handle!.materia!.id, { status: 'terminated' })

  assert.equal(await conductor.getStudio(handle!.studioId, AUCTOR), null,
    'the liveness question still answers no — a run may not bind a dead studio')
  const read = await conductor.getStudio(handle!.studioId, AUCTOR, { includeTerminal: true })
  assert.ok(read, 'the owner can still address the studio by id')
  assert.equal(read!.materia?.status, 'terminated', 'it reports the terminal state rather than absence')
  assert.equal((await conductor.find(AUCTOR)).length, 0, 'the live list is unchanged')
})

test('getStudio reads back an owned studio after claudere closed it', async () => {
  const { conductor } = makeConductor({ terminate: async () => {} })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  assert.equal(await conductor.claudere(handle!.studioId, AUCTOR), true)

  const read = await conductor.getStudio(handle!.studioId, AUCTOR, { includeTerminal: true })
  assert.ok(read, 'DELETE returned a terminal view; a following read must not contradict it')
  assert.equal(read!.modo.status, 'terminated')
  assert.equal(await conductor.getStudio(handle!.studioId, AUCTOR), null, 'still not a live studio')
})

test('reading a terminal studio stays owner-only — a stranger cannot tell it from nothing', async () => {
  const { conductor, materiae } = makeConductor()
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  await materiae.update(handle!.materia!.id, { status: 'terminated' })
  const intruder: AuctorKey = { animaId: 'intruder' }

  assert.equal(await conductor.getStudio(handle!.studioId, intruder, { includeTerminal: true }), null,
    'another host\'s terminated studio is as absent as it ever was')
  assert.equal(await conductor.getStudio('modo-nothing-here', intruder, { includeTerminal: true }), null,
    'and an id with no studio behind it answers identically')
  assert.equal(await conductor.getStudio('modo-nothing-here', AUCTOR, { includeTerminal: true }), null,
    'the owner gets the same answer for an id they do not host — reading is not enumerating')
})
