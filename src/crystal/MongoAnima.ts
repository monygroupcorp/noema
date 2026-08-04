import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Anima, AnimaStore } from '../types/anima.js'

function fromDoc(doc: Record<string, unknown>): Anima {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Anima
}

export class MongoAnima implements AnimaStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Anima, 'id' | 'natum' | 'mutatum'>): Promise<Anima> {
    const now = new Date()
    const anima: Anima = { ...input, id: uuidv4(), natum: now, mutatum: now }
    const { custos, ...rest } = anima
    const doc = custos !== undefined ? { ...rest, custos } : rest
    await this.col.insertOne(doc)
    return anima
  }

  async find(id: string): Promise<Anima | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByCustos(custos: string): Promise<Anima | null> {
    const doc = await this.col.findOne({ custos })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async update(
    id: string,
    patch: Partial<Pick<Anima, 'nomen' | 'memoriaRef' | 'custos' | 'publicatio' | 'disputeFrozen'>>
  ): Promise<Anima> {
    const mutatum = new Date()
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Anima not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  /**
   * Tombstone the Anima — the GDPR pseudonymization act (noema-025). SEVERS the identifying
   * PII (`$unset` `custos`/`memoriaRef`/`publicatio`, blank the `nomen`) and marks the soul
   * erased with a 7-year `retentionUntil` stamp. `publicatio` is dropped whole because it
   * carries identifying handles — `wallet` (on-chain custody address), `huggingFaceAccount`,
   * `civitaiAccount`, `bucket` — whose retention would defeat the pseudonymization-sufficiency
   * claim; its non-PII sub-fields (defaultVisibility, …) are moot on a dead account. The opaque
   * `id` is deliberately KEPT so the immutable
   * financial ledger + Stripe dispute resolver keep resolving against a non-identifying anchor.
   * Idempotent: re-tombstoning an already-erased soul re-applies the same $set/$unset cleanly
   * (never errors, never double-deletes). Dedicated concrete method (NOT the whitelisted
   * `update`) so the erased fields never widen the general patch surface.
   */
  async tombstone(id: string, stamp: { erasedAt: Date; retentionUntil: Date }): Promise<void> {
    await this.col.updateOne(
      { id },
      {
        $set: {
          nomen: '',
          erased: true,
          erasedAt: stamp.erasedAt,
          retentionUntil: stamp.retentionUntil,
          mutatum: new Date(),
        },
        $unset: { custos: '', memoriaRef: '', publicatio: '' },
      },
    )
  }
}
