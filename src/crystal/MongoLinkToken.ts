// =============================================================================
// MongoLinkToken — Mongo-backed one-time link/recovery codes (see types/linkToken.ts).
// =============================================================================
//
// One doc per outstanding code: `{ codeHash, animaId, kind, expiresAt }`. A TTL index on
// `expiresAt` sweeps stale rows; redemption is `findOneAndDelete` (single-use). Only the
// SHA-256 of the code is stored — a store dump never yields a usable code.
// =============================================================================

import { Collection } from 'mongodb'
import { type LinkTokenStore, type LinkTokenKind } from '../types/linkToken.js'
import { makeLinkToken, hashLinkToken } from './sessionToken.js'

export class MongoLinkToken implements LinkTokenStore {
  constructor(
    private readonly col: Collection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** TTL sweep on `expiresAt` + a lookup index on the hash. Idempotent; call once at wiring. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await this.col.createIndex({ codeHash: 1 }, { unique: true })
  }

  async issue(animaId: string, kind: LinkTokenKind, ttlSeconds: number): Promise<string> {
    const { plaintext, hash } = makeLinkToken()
    await this.col.insertOne({
      codeHash: hash,
      animaId,
      kind,
      expiresAt: new Date(this.now().getTime() + ttlSeconds * 1000),
    })
    return plaintext
  }

  async consume(code: string, kind: LinkTokenKind): Promise<string | null> {
    const doc = await this.col.findOneAndDelete({ codeHash: hashLinkToken(code), kind })
    if (!doc) return null
    const rec = doc as unknown as { animaId: string; expiresAt: Date }
    // Belt-and-braces: the TTL sweep can lag, so reject an expired-but-not-yet-swept row.
    if (rec.expiresAt.getTime() <= this.now().getTime()) return null
    return rec.animaId
  }
}
