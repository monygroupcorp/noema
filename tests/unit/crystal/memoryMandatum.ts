// In-memory Mandatorum — a test double with the SAME claim semantics as MongoMandatum:
// a claim is exclusive for its lease, `setNextFire` releases the claim, and a `pendens: undefined`
// patch CLEARS the field rather than writing an empty one. Shared by the runner suite and the
// facade suite so both drive one behaviour, not two approximations of it.

import { randomUUID } from 'node:crypto'
import type { Mandatum, Mandata, Mandatorum, MandatumPatch } from '../../../src/types/mandatum.js'

export class MemoryMandatum implements Mandatorum {
  readonly rows = new Map<string, Mandatum>()
  private readonly leases = new Map<string, number>()

  async create(input: Omit<Mandatum, 'id' | 'natum' | 'mutatum' | 'acta' | 'ignitions'>): Promise<Mandatum> {
    const now = new Date()
    const m: Mandatum = { ...input, id: randomUUID(), acta: [], ignitions: 0, natum: now, mutatum: now }
    this.rows.set(m.id, m)
    return { ...m }
  }

  async find(id: string): Promise<Mandatum | null> {
    const m = this.rows.get(id)
    return m ? { ...m } : null
  }

  async findByActum(actumId: string): Promise<Mandatum | null> {
    for (const m of this.rows.values()) if (m.acta.includes(actumId)) return { ...m }
    return null
  }

  async list(filter?: Partial<Pick<Mandatum, 'status' | 'triggerGenus'>>): Promise<Mandata> {
    return [...this.rows.values()]
      .filter(m => !filter?.status || m.status === filter.status)
      .filter(m => !filter?.triggerGenus || m.triggerGenus === filter.triggerGenus)
      .map(m => ({ ...m }))
  }

  async update(id: string, patch: MandatumPatch): Promise<Mandatum> {
    const m = this.rows.get(id)
    if (!m) throw new Error(`Mandatum not found: ${id}`)
    const { pendens, ...rest } = patch
    const next: Mandatum = { ...m, ...rest, mutatum: new Date() }
    if ('pendens' in patch) {
      if (pendens === undefined) delete next.pendens
      else next.pendens = pendens
    }
    this.rows.set(id, next)
    return { ...next }
  }

  async due(at: Date): Promise<Mandata> {
    return [...this.rows.values()]
      .filter(m => m.status === 'active' && m.proximum !== undefined && m.proximum.getTime() <= at.getTime())
      .map(m => ({ ...m }))
  }

  async claimDue(at: Date, leaseMs: number): Promise<Mandatum | null> {
    for (const m of this.rows.values()) {
      if (m.status !== 'active') continue
      if (m.proximum === undefined || m.proximum.getTime() > at.getTime()) continue
      const lease = this.leases.get(m.id)
      if (lease !== undefined && lease > at.getTime()) continue
      this.leases.set(m.id, at.getTime() + leaseMs)
      return { ...m }
    }
    return null
  }

  async setNextFire(id: string, nextFire: Date): Promise<void> {
    const m = this.rows.get(id)
    if (!m) return
    this.rows.set(id, { ...m, proximum: nextFire, mutatum: new Date() })
    this.leases.delete(id)
  }
}
