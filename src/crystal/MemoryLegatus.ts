import { randomUUID } from 'node:crypto'
import type { Legatus, LegatusStore } from '../types/legatus.js'

/** In-memory agent-sidecar registry — the hermetic mirror of `MongoLegatus`.
 *  Enforces the unique-`agentId` contract by throwing a Mongo-shaped
 *  `{ code: 11000 }` on a duplicate, so the saga's race handling is testable. */
export class MemoryLegatus implements LegatusStore {
  private readonly byId = new Map<string, Legatus>()
  private readonly byAgentId = new Map<string, string>()

  async findByAgentId(agentId: string): Promise<Legatus | null> {
    const id = this.byAgentId.get(agentId)
    return id ? this.byId.get(id) ?? null : null
  }

  async findById(id: string): Promise<Legatus | null> {
    return this.byId.get(id) ?? null
  }

  async create(
    input: Omit<Legatus, 'id' | 'natum' | 'status'> & { status?: Legatus['status'] },
  ): Promise<Legatus> {
    if (this.byAgentId.has(input.agentId)) {
      throw Object.assign(new Error(`duplicate agentId '${input.agentId}'`), { code: 11000 })
    }
    const record: Legatus = {
      ...input,
      id: randomUUID(),
      status: input.status ?? 'active',
      natum: new Date(),
    }
    this.byId.set(record.id, record)
    this.byAgentId.set(record.agentId, record.id)
    return record
  }

  async setStatus(id: string, status: Legatus['status']): Promise<void> {
    const prev = this.byId.get(id)
    if (prev) this.byId.set(id, { ...prev, status })
  }

  async setWorkspace(id: string, workspaceModusId: string): Promise<void> {
    const prev = this.byId.get(id)
    if (prev) this.byId.set(id, { ...prev, workspaceModusId })
  }
}
