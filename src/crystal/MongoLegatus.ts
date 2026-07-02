import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Legatus, LegatusStore } from '../types/legatus.js'

function fromDoc(doc: Record<string, unknown>): Legatus {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Legatus
}

/** Mongo-backed agent-sidecar registry. `agentId` MUST carry a unique index
 *  (created in ensureIndexes) — it is the provisioning idempotency key. */
export class MongoLegatus implements LegatusStore {
  constructor(private col: Collection) {}

  async findByAgentId(agentId: string): Promise<Legatus | null> {
    const doc = await this.col.findOne({ agentId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findById(id: string): Promise<Legatus | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async create(
    input: Omit<Legatus, 'id' | 'natum' | 'status'> & { status?: Legatus['status'] },
  ): Promise<Legatus> {
    const record: Legatus = {
      ...input,
      id: uuidv4(),
      status: input.status ?? 'active',
      natum: new Date(),
    }
    // insertOne throws { code: 11000 } on a duplicate agentId — the saga catches it.
    await this.col.insertOne({ ...record })
    return record
  }

  async setStatus(id: string, status: Legatus['status']): Promise<void> {
    await this.col.updateOne({ id }, { $set: { status } })
  }

  async setWorkspace(id: string, workspaceModusId: string): Promise<void> {
    await this.col.updateOne({ id }, { $set: { workspaceModusId } })
  }
}
