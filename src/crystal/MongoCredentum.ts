// =============================================================================
// MongoCredentum — Mongo-backed fiat-credential store, sealed by the unique username.
// =============================================================================
//
// One doc per account, `username` unique (the index is the enumeration/dup authority —
// a racing duplicate insert throws code 11000 → mapped to `UsernameTakenError`). See
// `src/types/credentum.ts` for the security contract. NO email/verification/reset — the
// clean-swap from the email rail purges any legacy email-only docs on ensureIndexes.
// =============================================================================

import { Collection, MongoServerError } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { type Credentum, type CredentumStore, UsernameTakenError } from '../types/credentum.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:credentum')

function fromDoc(doc: Record<string, unknown>): Credentum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Credentum
}

export class MongoCredentum implements CredentumStore {
  constructor(
    private readonly col: Collection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Unique index on `username` — the dup guard. Idempotent; call once at wiring.
   *
   * One-time clean-swap from the retired email rail, and SELF-DISABLING: the destructive
   * step runs ONLY while the legacy unique `email` index is still present (i.e. this DB
   * predates username auth). It drops that index and purges the legacy email-only docs
   * (they'd collide on a null `username` key and can't be logged in anyway), then never
   * runs again — steady-state boots do no deleteMany, just the idempotent createIndex.
   * Both steps are load-bearing until the cutover runs once, so this can't simply be removed.
   */
  async ensureIndexes(): Promise<void> {
    const indexes = await this.col.indexes().catch(() => [] as { name?: string }[])
    if (indexes.some(i => i.name === 'email_1')) {
      await this.col.dropIndex('email_1')
      const purged = await this.col.deleteMany({ username: { $exists: false } })
      log.warn('credenta: migrated off the email rail', { purgedLegacyCredentials: purged.deletedCount })
    }
    await this.col.createIndex({ username: 1 }, { unique: true })
  }

  async create(input: {
    username: string
    passwordHash: string
    animaId: string
  }): Promise<Credentum> {
    const now = this.now()
    const cred: Credentum = {
      id: uuidv4(),
      username: input.username,
      passwordHash: input.passwordHash,
      animaId: input.animaId,
      natum: now,
      mutatum: now,
    }
    try {
      await this.col.insertOne({ ...cred })
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) throw new UsernameTakenError()
      throw err
    }
    return cred
  }

  async findByUsername(username: string): Promise<Credentum | null> {
    const doc = await this.col.findOne({ username })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  /**
   * The caller's OWN credential row by `animaId` — for the GDPR self-export. Returns the
   * username + timestamps but NEVER the `passwordHash` (projected out at the DB, so the
   * secret never even leaves Mongo). `animaId` owns exactly one row, so this is unambiguous.
   */
  async findByAnimaId(animaId: string): Promise<Omit<Credentum, 'passwordHash'> | null> {
    const doc = await this.col.findOne({ animaId }, { projection: { passwordHash: 0, _id: 0 } })
    return doc ? (doc as unknown as Omit<Credentum, 'passwordHash'>) : null
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.col.updateOne({ id }, { $set: { passwordHash, mutatum: this.now() } })
  }
}
