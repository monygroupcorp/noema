import { Collection, MongoServerError } from 'mongodb'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Delegatio, DelegatioDraft, Delegationum } from '../types/delegatio.js'

// bigints (impetus points) → decimal strings, same convention as MongoSponsio/MongoSignorum.
function toDoc(d: Delegatio): Record<string, unknown> {
  const { spendCapPoints, spentPoints, ...rest } = d
  return { ...rest, spentPoints: spentPoints.toString(), ...(spendCapPoints !== undefined ? { spendCapPoints: spendCapPoints.toString() } : {}) }
}
function fromDoc(doc: Record<string, unknown>): Delegatio {
  const { _id, spendCapPoints, spentPoints, ...rest } = doc as Record<string, unknown> & { _id: unknown; spentPoints: string; spendCapPoints?: string }
  return {
    ...rest,
    spentPoints: BigInt(spentPoints),
    ...(spendCapPoints !== undefined ? { spendCapPoints: BigInt(spendCapPoints) } : {}),
  } as Delegatio
}

/** A shareable invite token — url-safe, unguessable. */
function mintToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Mongo delegation-token store. `token` carries a unique index (created in ensureIndexes) —
 * the redeem key. `recordSpend` is a compare-and-swap on `spentPoints` (with the cap + active
 * + expiry guards) so concurrent runs under one delegation cannot overspend the cap.
 */
export class MongoDelegatio implements Delegationum {
  constructor(private col: Collection) {}

  async create(draft: DelegatioDraft): Promise<Delegatio> {
    // Unique-token retry: a base64url(24) collision is astronomically unlikely, but E11000-safe.
    for (let i = 0; i < 3; i++) {
      const d: Delegatio = {
        id: randomUUID(),
        agentId: draft.agentId,
        token: mintToken(),
        ...(draft.label !== undefined ? { label: draft.label } : {}),
        ...(draft.spendCapPoints !== undefined ? { spendCapPoints: draft.spendCapPoints } : {}),
        spentPoints: 0n,
        ...(draft.expiresAt !== undefined ? { expiresAt: draft.expiresAt } : {}),
        status: 'active',
        natum: new Date(),
      }
      try {
        await this.col.insertOne(toDoc(d))
        return d
      } catch (err) {
        if (err instanceof MongoServerError && err.code === 11000) continue
        throw err
      }
    }
    throw new Error('Delegatio: could not mint a unique token')
  }

  async find(id: string): Promise<Delegatio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByToken(token: string): Promise<Delegatio | null> {
    const doc = await this.col.findOne({ token })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByAgent(agentId: string): Promise<Delegatio[]> {
    const docs = await this.col.find({ agentId }).sort({ natum: -1 }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async setStatus(id: string, status: Delegatio['status']): Promise<void> {
    await this.col.updateOne({ id }, { $set: { status } })
  }

  async recordSpend(id: string, points: bigint, now: Date): Promise<Delegatio | null> {
    if (points <= 0n) return this.find(id)   // nothing to charge
    for (let attempt = 0; attempt < 8; attempt++) {
      const d = await this.find(id)
      if (!d || d.status !== 'active') return null
      if (d.expiresAt && d.expiresAt <= now) return null
      const next = d.spentPoints + points
      if (d.spendCapPoints !== undefined && next > d.spendCapPoints) return null   // would breach the cap
      // CAS on the exact spentPoints — a concurrent run that bumped it fails this and we retry.
      const res = await this.col.updateOne(
        { id, status: 'active', spentPoints: d.spentPoints.toString() },
        { $set: { spentPoints: next.toString() } },
      )
      if (res.modifiedCount === 1) return { ...d, spentPoints: next }
    }
    return null   // lost the race repeatedly — refuse rather than risk an overspend
  }
}
