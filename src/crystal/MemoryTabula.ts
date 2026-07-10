import { v4 as uuidv4 } from 'uuid'
import type { AuctorKey, Tabula, Tabulae, Tabularum } from '../types/tabula.js'

// =============================================================================
// MemoryTabula — hermetic in-process twin of MongoTabula. Same semantics
// (including the AuctorKey discriminant match on `list`/ownership), no I/O —
// backs the route/compile unit tests without a live Mongo.
// =============================================================================

function sameAuctor(a: AuctorKey, b: AuctorKey): boolean {
  if ('animaId' in a && 'animaId' in b) return a.animaId === b.animaId
  if ('commitment' in a && 'commitment' in b) return a.commitment === b.commitment
  if ('bursaToken' in a && 'bursaToken' in b) return a.bursaToken === b.bursaToken
  return false
}

export class MemoryTabula implements Tabularum {
  private readonly store = new Map<string, Tabula>()

  async create(input: Omit<Tabula, 'id' | 'natum' | 'mutatum' | 'nodi' | 'vincula'>): Promise<Tabula> {
    const now = new Date()
    const t: Tabula = { ...input, id: uuidv4(), nodi: [], vincula: [], natum: now, mutatum: now }
    this.store.set(t.id, t)
    return t
  }

  async find(id: string): Promise<Tabula | null> {
    return this.store.get(id) ?? null
  }

  async list(filter?: Partial<Pick<Tabula, 'auctor' | 'status' | 'visibilitas'>>): Promise<Tabulae> {
    let all = Array.from(this.store.values())
    if (filter?.status !== undefined) all = all.filter(t => t.status === filter.status)
    if (filter?.visibilitas !== undefined) all = all.filter(t => t.visibilitas === filter.visibilitas)
    if (filter?.auctor !== undefined) all = all.filter(t => sameAuctor(t.auctor, filter.auctor as AuctorKey))
    return all
  }

  async update(id: string, patch: Partial<Pick<Tabula, 'nomen' | 'descriptio' | 'nodi' | 'vincula' | 'status' | 'visibilitas' | 'modusId' | 'mutatum'>>): Promise<Tabula> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`Tabula not found: ${id}`)
    const updated: Tabula = { ...existing, ...patch, mutatum: new Date() }
    this.store.set(id, updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id)
  }

  async fork(id: string, newAuctor: AuctorKey): Promise<Tabula> {
    const original = this.store.get(id)
    if (!original) throw new Error(`Tabula not found: ${id}`)
    const now = new Date()
    const forked: Tabula = {
      ...original,
      id: uuidv4(),
      auctor: newAuctor,
      status: 'draft',
      fonteId: original.id,
      modusId: undefined,
      natum: now,
      mutatum: now,
    }
    this.store.set(forked.id, forked)
    return forked
  }

  async listDerived(templateId: string): Promise<Tabulae> {
    return Array.from(this.store.values()).filter(t => t.templateId === templateId)
  }
}
