import { randomUUID } from 'node:crypto'
import type { Collection } from 'mongodb'
import type { Bursa, Bursarum, BursaCreateOpts } from '../types/bursa.js'
import { InsufficientBursaCreditsError } from '../types/bursa.js'

function fromDoc(doc: Record<string, unknown>): Bursa {
  return {
    id: doc.token as string,
    credits: BigInt(doc.credits as string),
    createdAt: doc.createdAt as Date,
    ...(doc.ownerAnimaId ? { owner: { animaId: doc.ownerAnimaId as string } } : {}),
    ...(doc.label !== undefined ? { label: doc.label as string } : {}),
    ...(doc.status !== undefined ? { status: doc.status as Bursa['status'] } : {}),
    ...(doc.redeemedAt !== undefined ? { redeemedAt: doc.redeemedAt as Date } : {}),
  }
}

export class MongoBursarium implements Bursarum {
  constructor(private readonly col: Collection) {}

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ token: 1 }, { unique: true })
    await this.col.createIndex({ ownerAnimaId: 1 }, { sparse: true })   // the owner dashboard
  }

  async create(credits: bigint, opts?: BursaCreateOpts): Promise<Bursa> {
    const token = randomUUID()
    const createdAt = new Date()
    const doc: Record<string, unknown> = { token, credits: credits.toString(), createdAt }
    if (opts?.owner) { doc.ownerAnimaId = opts.owner.animaId; doc.status = 'active' }
    if (opts?.label !== undefined) doc.label = opts.label
    await this.col.insertOne(doc)
    return fromDoc(doc)
  }

  async findByToken(token: string): Promise<Bursa | null> {
    const doc = await this.col.findOne({ token })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByOwner(animaId: string): Promise<Bursa[]> {
    const docs = await this.col.find({ ownerAnimaId: animaId }).sort({ createdAt: -1 }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async setStatus(token: string, status: NonNullable<Bursa['status']>): Promise<void> {
    await this.col.updateOne({ token }, { $set: { status } })
  }

  // The redemption claim — ONE conditional update, so exactly one caller can win it.
  // `status: 'active'` is the compare; only an OWNED purse carries a status at all, and the
  // `ownerAnimaId` term states that requirement in the filter rather than relying on it.
  // No redeemer identity is written: the row records THAT it converted and WHEN, nothing more.
  async claimForRedemption(token: string, at: Date): Promise<Bursa | null> {
    const claimed = await this.col.findOneAndUpdate(
      { token, ownerAnimaId: { $exists: true }, status: 'active' },
      { $set: { status: 'redeemed', redeemedAt: at } },
      { returnDocument: 'after' },
    )
    return claimed ? fromDoc(claimed as Record<string, unknown>) : null
  }

  // Compensation for a failure after the claim: the purse goes back to active and the
  // conversion stamp is removed, so the credits stay reachable.
  async releaseRedemptionClaim(token: string): Promise<void> {
    await this.col.updateOne({ token, status: 'redeemed' }, { $set: { status: 'active' }, $unset: { redeemedAt: '' } })
  }

  // OCC debit: read → check → CAS update. Retries on concurrent debit (rare).
  async debit(token: string, amount: bigint): Promise<Bursa> {
    const MAX_RETRIES = 10
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const doc = await this.col.findOne({ token })
      if (!doc) throw new Error('Bursa not found')

      const current = BigInt(doc.credits as string)
      if (current < amount) throw new InsufficientBursaCreditsError(current, amount)

      const updated = await this.col.findOneAndUpdate(
        { token, credits: current.toString() },
        { $set: { credits: (current - amount).toString() } },
        { returnDocument: 'after' },
      )

      if (updated) {
        return fromDoc(updated as Record<string, unknown>)
      }
      // CAS miss — concurrent debit won the race; retry
    }
    throw new Error('Bursa debit failed after max retries (concurrent contention)')
  }

  async credit(token: string, amount: bigint): Promise<void> {
    const doc = await this.col.findOne({ token })
    if (!doc) return  // purse vanished — nothing to restore to
    const restored = (BigInt(doc.credits as string) + amount).toString()
    await this.col.updateOne({ token }, { $set: { credits: restored } })
  }
}
