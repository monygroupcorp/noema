import { v4 as uuidv4 } from 'uuid'
import type { Modo, ModoStore } from '../types/modo.js'

export class MemoryModo implements ModoStore {
  private store = new Map<string, Modo>()

  async create(input: Omit<Modo, 'id' | 'inceptum'>): Promise<Modo> {
    const modo: Modo = { ...input, id: uuidv4(), inceptum: new Date() }
    this.store.set(modo.id, modo)
    return modo
  }

  async findById(id: string): Promise<Modo | null> {
    return this.store.get(id) ?? null
  }

  async update(id: string, patch: Partial<Pick<Modo, 'status' | 'materiamId' | 'impetusAccrued' | 'acta' | 'terminatum'>>): Promise<Modo> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`Modo '${id}' not found`)
    const updated = { ...existing, ...patch }
    this.store.set(id, updated)
    return updated
  }

  async findActive(): Promise<Modo[]> {
    return [...this.store.values()].filter(
      m => m.status === 'claiming' || m.status === 'warming' || m.status === 'active' || m.status === 'idle'
    )
  }
}
