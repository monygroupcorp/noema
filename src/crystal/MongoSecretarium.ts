// =============================================================================
// MongoSecretarium — Mongo-backed BYO secret store, sealed at rest.
// =============================================================================
//
// One doc per `(ownerKey, provider)`. The plaintext token is sealed via `SecretBox`
// (AES-256-GCM) BEFORE it ever touches the collection; only the envelope is stored.
//
// Idle-expiry: `expiresAt` is a TTL-index target — set at `put`, pushed forward on every
// real `resolve` (a gated fetch). Seed `expiresAt` at put-time (not on first use) so a
// connected-but-never-fetched secret still ages out after its window.
//
// See `src/types/secretum.ts` for the ASYMMETRY contract: `resolve` (the only plaintext
// path) must be handed ONLY to the two server-side consumers, never to the API facade.
// =============================================================================

import { Collection } from 'mongodb'
import type { Secretarium, SecretProvider } from '../types/secretum.js'
import type { SecretBox } from './secretBox.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:secretarium')

const DAY_MS = 24 * 60 * 60 * 1000

export class MongoSecretarium implements Secretarium {
  constructor(
    private readonly col: Collection,
    private readonly box: SecretBox,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Create the unique `(ownerKey, provider)` index + the `expiresAt` TTL index. Idempotent;
   * call once at wiring. `expireAfterSeconds: 0` means "expire when `expiresAt` is reached".
   */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ ownerKey: 1, provider: 1 }, { unique: true })
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  }

  async put(ownerKey: string, provider: SecretProvider, plaintext: string, idleDays: number): Promise<{ expiresAt: Date }> {
    const now = this.now()
    const expiresAt = new Date(now.getTime() + idleDays * DAY_MS)
    const sealed = this.box.seal(plaintext)
    await this.col.updateOne(
      { ownerKey, provider },
      {
        $set: { ...sealed, idleDays, expiresAt, mutatum: now },
        $setOnInsert: { ownerKey, provider, natum: now },
        // A re-`put` is a fresh secret → drop any stale lastUsedAt.
        $unset: { lastUsedAt: '' },
      },
      { upsert: true },
    )
    return { expiresAt }
  }

  async has(ownerKey: string, provider: SecretProvider): Promise<boolean> {
    const doc = await this.col.findOne({ ownerKey, provider }, { projection: { _id: 1 } })
    return doc !== null
  }

  async remove(ownerKey: string, provider: SecretProvider): Promise<void> {
    await this.col.deleteOne({ ownerKey, provider })
  }

  async resolve(ownerKey: string, provider: SecretProvider): Promise<string | null> {
    const doc = await this.col.findOne({ ownerKey, provider })
    if (!doc) return null
    const now = this.now()
    // Belt-and-braces: TTL sweeps are lazy (up to ~60s), so honor an already-past expiry here.
    if (doc.expiresAt instanceof Date && doc.expiresAt.getTime() <= now.getTime()) return null
    let plaintext: string
    try {
      plaintext = this.box.open({ ciphertext: doc.ciphertext, iv: doc.iv, authTag: doc.authTag, keyId: doc.keyId })
    } catch (err) {
      log.warn('resolve: failed to open secret envelope', { ownerKey, provider, error: String(err) })
      return null
    }
    // Touch usage + push expiry forward by the owner's window. Fire-and-forget — a bump
    // failure must never fail the fetch that needs the token.
    const idleDays = typeof doc.idleDays === 'number' ? doc.idleDays : 90
    const expiresAt = new Date(now.getTime() + idleDays * DAY_MS)
    this.col.updateOne({ ownerKey, provider }, { $set: { lastUsedAt: now, expiresAt } }).catch(err =>
      log.warn('resolve: failed to bump lastUsedAt/expiresAt', { ownerKey, provider, error: String(err) }))
    return plaintext
  }
}
