// =============================================================================
// MongoErasedDenylist — the erased-account (session-revocation) denylist (noema-025).
// =============================================================================
//
// Keyed by `animaId`. `eraseMe` ADDS an erased soul; `verifyJwt` CONSULTS `has()` on the
// auth path and rejects any session JWT whose subject is listed (a 401/invalid), closing the
// stateless-JWT gap where a tombstoned Anima's live token would otherwise still authenticate.
// Persistent (survives restarts) and shared by construction — the SAME instance is wired into
// both the acceptors and the eraser, so an erase is visible to the auth path immediately.
// The collection is tiny (only erased/banned souls), so the `animaId`-unique index keeps the
// per-request membership check a cheap point lookup.
// =============================================================================

import { Collection } from 'mongodb'
import type { ErasedDenylistStore } from '../types/erasure.js'

export class MongoErasedDenylist implements ErasedDenylistStore {
  constructor(private readonly col: Collection) {}

  /** Idempotent unique index on `animaId`. Call once at wiring. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ animaId: 1 }, { unique: true })
  }

  async add(animaId: string): Promise<void> {
    // Upsert → idempotent: re-adding an already-listed soul is a no-op, never a dup-key throw.
    await this.col.updateOne(
      { animaId },
      { $setOnInsert: { animaId, erasedAt: new Date() } },
      { upsert: true },
    )
  }

  async has(animaId: string): Promise<boolean> {
    const doc = await this.col.findOne({ animaId }, { projection: { _id: 1 } })
    return doc !== null
  }
}
