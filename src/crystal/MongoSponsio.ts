import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Sponsio, Sponsiones, SponsioStore } from '../types/sponsio.js'

// bigint fields stored as decimal strings (same discipline as Signum.valor / Modus.impetusFixum)
function toDoc(s: Sponsio): Record<string, unknown> {
  return {
    ...s,
    capTotal: s.capTotal !== undefined ? s.capTotal.toString() : undefined,
    drippedTotal: s.drippedTotal.toString(),
    subsidia: {
      ...s.subsidia,
      grant: s.subsidia.grant.toString(),
      balanceCap: s.subsidia.balanceCap !== undefined ? s.subsidia.balanceCap.toString() : undefined,
    },
  }
}

function fromDoc(doc: Record<string, unknown>): Sponsio {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  const s = rest as Record<string, unknown>
  const subsidia = s.subsidia as Record<string, unknown>
  return {
    ...(s as unknown as Sponsio),
    capTotal: s.capTotal !== undefined && s.capTotal !== null ? BigInt(s.capTotal as string) : undefined,
    drippedTotal: BigInt(s.drippedTotal as string),
    subsidia: {
      ...(subsidia as unknown as Sponsio['subsidia']),
      grant: BigInt(subsidia.grant as string),
      balanceCap: subsidia.balanceCap !== undefined && subsidia.balanceCap !== null ? BigInt(subsidia.balanceCap as string) : undefined,
    },
  }
}

export class MongoSponsio implements SponsioStore {
  constructor(private col: Collection) {}

  async create(
    input: Omit<Sponsio, 'id' | 'natum' | 'status' | 'drippedTotal'> & { status?: Sponsio['status'] },
  ): Promise<Sponsio> {
    const record: Sponsio = {
      ...input,
      id: uuidv4(),
      drippedTotal: 0n,
      status: input.status ?? 'active',
      natum: new Date(),
    }
    await this.col.insertOne(toDoc(record))
    return record
  }

  async find(id: string): Promise<Sponsio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listBySponsor(animaId: string): Promise<Sponsiones> {
    const docs = await this.col.find({ 'sponsor.animaId': animaId }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async listActive(): Promise<Sponsiones> {
    const docs = await this.col.find({ status: 'active' }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async claimCycle(id: string, cycle: string): Promise<boolean> {
    // CAS: only flip lastDripCycle if it isn't already this cycle. Exactly one
    // concurrent claimer matches the predicate; the rest see modifiedCount 0.
    const res = await this.col.updateOne(
      { id, lastDripCycle: { $ne: cycle } },
      { $set: { lastDripCycle: cycle } },
    )
    return res.modifiedCount === 1
  }

  async releaseCycle(id: string, cycle: string): Promise<void> {
    await this.col.updateOne({ id, lastDripCycle: cycle }, { $unset: { lastDripCycle: '' } })
  }

  async recordDrip(id: string, amount: bigint): Promise<void> {
    const doc = await this.col.findOne({ id })
    if (!doc) return
    const s = fromDoc(doc as Record<string, unknown>)
    const drippedTotal = s.drippedTotal + amount
    const exhausted = s.capTotal !== undefined && drippedTotal >= s.capTotal
    await this.col.updateOne(
      { id },
      { $set: { drippedTotal: drippedTotal.toString(), ...(exhausted ? { status: 'exhausted' } : {}) } },
    )
  }

  async setStatus(id: string, status: Sponsio['status']): Promise<void> {
    await this.col.updateOne({ id }, { $set: { status } })
  }
}
