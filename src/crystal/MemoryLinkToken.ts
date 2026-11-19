// =============================================================================
// MemoryLinkToken — in-memory one-time link/recovery codes for tests/dev.
// =============================================================================
//
// Same semantics as MongoLinkToken (hash-keyed, single-use, TTL) without Mongo.
// =============================================================================

import { type LinkTokenStore, type LinkTokenKind } from '../types/linkToken.js'
import { makeLinkToken, hashLinkToken } from './sessionToken.js'

interface Row { animaId: string | null; kind: LinkTokenKind; expiresAt: number }

export class MemoryLinkToken implements LinkTokenStore {
  private readonly byHash = new Map<string, Row>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  async issue(animaId: string, kind: LinkTokenKind, ttlSeconds: number): Promise<string> {
    const { plaintext, hash } = makeLinkToken()
    this.byHash.set(hash, { animaId, kind, expiresAt: this.now().getTime() + ttlSeconds * 1000 })
    return plaintext
  }

  async consume(code: string, kind: LinkTokenKind): Promise<string | null> {
    const hash = hashLinkToken(code)
    const row = this.byHash.get(hash)
    if (!row || row.kind !== kind || row.animaId === null) return null
    this.byHash.delete(hash)   // single-use
    if (row.expiresAt <= this.now().getTime()) return null
    return row.animaId
  }

  async claim(key: string, kind: LinkTokenKind, ttlSeconds: number): Promise<boolean> {
    const hash = hashLinkToken(key)
    const row = this.byHash.get(hash)
    // Like Mongo's unique index: a claimed key stays taken until its row expires.
    if (row && row.expiresAt > this.now().getTime()) return false
    this.byHash.set(hash, { animaId: null, kind, expiresAt: this.now().getTime() + ttlSeconds * 1000 })
    return true
  }
}
