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
  byMateria = new Map<string, Hospitium>()
  private seq = 0
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `h-${++this.seq}`, ...input }; this.byMateria.set(h.materiaId, h); return h
  }
  async findByMateriaId(materiaId: string): Promise<Hospitium | null> { return this.byMateria.get(materiaId) ?? null }
  async findActive(): Promise<Hospitium[]> { return [...this.byMateria.values()].filter(h => !h.terminatum) }
  async update(materiaId: string, patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>): Promise<Hospitium> {
    const cur = this.byMateria.get(materiaId); if (!cur) throw new Error('not found')
    const next = { ...cur, ...patch }; this.byMateria.set(materiaId, next); return next
  }
}

// Stub Procurator — parks a Materia + Hospitium just like the real provision-park.
function makeProcurator(materiae: FakeMateriae, hospitia: FakeHospitia, opts: { failAll?: boolean } = {}): Procurator & { stages: string[] } {
  const stages: string[] = []
  return {
    stages,
    async provisionStudio(o = {}, onStage): Promise<StudioProvision | null> {
      if (opts.failAll) return null
      onStage?.('provisioning'); stages.push('provisioning')
      const podId = `pod-${materiae.byId.size + 1}`
      const materia = await materiae.create({
        genus: 'runpod', externusId: podId, gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
        imageRef: 'img:1', impetusPerSecond: 4n, status: 'idle',
        warmUntil: new Date(Date.now() + (o.warmMs ?? 60_000)), bootCostImpetus: 0n,
        ...(o.runtime ? { runtime: o.runtime } : {}),
      })
      if (o.provisioningContext?.hostKey) {
        await hospitia.create({ materiaId: materia.id, hostKey: o.provisioningContext.hostKey, inceptum: new Date() })
      }
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
  assert.equal(handle!.modo.materiamId, handle!.materia.id, 'modo bound to the materia')
  assert.equal(handle!.modo.status, 'idle', 'studio is warm + resting')
  assert.equal(handle!.provision?.podId, handle!.materia.externusId)
  // The budget tessera is issued against the modo, valor = budget
  const budget = await signorum.sessionBudget(handle!.studioId)
  assert.equal(budget, 5000n, 'tessera budget = the requested budget')
  // The bound modo is persisted
  const persisted = await modos.findById(handle!.studioId)
  assert.equal(persisted?.materiamId, handle!.materia.id)
})

test('conducere fixes the host-less bug: a Hospitium keyed by the auctor always exists', async () => {
  const { conductor, hospitia } = makeConductor()
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  const h = await hospitia.findByMateriaId(handle!.materia.id)
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
  assert.equal(installed[0].materiaId, handle!.materia.id)
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
  await materiae.update(handle!.materia.id, { status: 'terminated' })
  const live = await conductor.find(AUCTOR)
  assert.equal(live.length, 0, 'a terminated-pod studio is no longer listed, despite the stale Modo')
})

// ── claudere ────────────────────────────────────────────────────────────────
test('claudere releases the studio: terminates the pod + closes session/materia/hospitium', async () => {
  const terminated: string[] = []
  const { conductor, materiae, modos, hospitia } = makeConductor({ terminate: async (p) => { terminated.push(p) } })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  const podId = handle!.materia.externusId!

  const ok = await conductor.claudere(handle!.studioId, AUCTOR)
  assert.equal(ok, true)
  assert.deepEqual(terminated, [podId], 'the pod was terminated')
  assert.equal((await modos.findById(handle!.studioId))?.status, 'terminated')
  assert.equal((await materiae.findById(handle!.materia.id))?.status, 'terminated')
  assert.ok((await hospitia.findByMateriaId(handle!.materia.id))?.terminatum)
})

test('claudere refuses a studio the caller does not host', async () => {
  const { conductor } = makeConductor({ terminate: async () => {} })
  const handle = await conductor.conducere(AUCTOR, { budget: 1000n })
  const ok = await conductor.claudere(handle!.studioId, { animaId: 'intruder' })
  assert.equal(ok, false)
})
