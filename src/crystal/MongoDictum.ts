import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Dictum, DictumStore } from '../types/colloquium.js'

function fromDoc(doc: Record<string, unknown>): Dictum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Dictum
}

export class MongoDictum implements DictumStore {
  constructor(private col: Collection) {}

  /**
   * Per-turn idempotency (noema-095, MONEY CODE). The AGENT Dictum is the atomic per-turn CHARGE
   * GATE: a UNIQUE PARTIAL index on (colloquiumId, turnKey) over AGENT dicta ONLY. Because the
   * settle/debit only fires AFTER the agent Dictum is persisted, two concurrent dicta POSTs sharing
   * a caller-supplied turnKey can both run the read-only agent but only ONE persists the agent
   * Dictum — the loser's insert throws E11000 and the router returns the winner's turn WITHOUT a
   * second reserve→settle / Bursa debit (no double-charge on a retried/raced POST). The turnKey is
   * shared by the turn's USER Dictum too, so the constraint MUST be genus-scoped to 'agent'.
   *
   * The authoritative boot-time creator is src/crystal/ensureIndexes.ts (run in index.ts); this
   * method mirrors MongoMerces.ensureIndexes for parity and is idempotent (createIndex is a no-op
   * when the index already exists).
   */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ id: 1 }, { unique: true })
    await this.col.createIndex({ colloquiumId: 1, natum: 1 })
    await this.col.createIndex(
      { colloquiumId: 1, turnKey: 1 },
      { name: 'turnkey_agent_charge_gate', unique: true, partialFilterExpression: { genus: 'agent', turnKey: { $exists: true } } },
    )
  }

  async create(input: Omit<Dictum, 'id' | 'natum'>): Promise<Dictum> {
    const d: Dictum = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne({ ...d })
    return d
  }

  async findById(id: string): Promise<Dictum | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByColloquium(colloquiumId: string): Promise<Dictum[]> {
    const docs = await this.col.find({ colloquiumId }).sort({ natum: 1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async findByTurnKey(colloquiumId: string, turnKey: string): Promise<Dictum[]> {
    const docs = await this.col.find({ colloquiumId, turnKey }).sort({ natum: 1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Dictum, 'actumId' | 'signaIds'>>): Promise<Dictum> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Dictum not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
