// =============================================================================
// MongoCredentum — Mongo-backed fiat-credential store, sealed by the unique email.
// =============================================================================
//
// One doc per account, `email` unique (the index is the enumeration/dup authority —
// a racing duplicate insert throws code 11000 → mapped to `EmailTakenError`). Token
// lookups are by their SHA-256 hash (a store dump never yields a usable link). See
// `src/types/credentum.ts` for the security contract.
// =============================================================================

import { Collection, MongoServerError } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { type Credentum, type CredentumStore, EmailTakenError } from '../types/credentum.js'

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

  /** Unique index on `email` — the dup guard. Idempotent; call once at wiring. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ email: 1 }, { unique: true })
    // Token lookups (sparse — most rows carry no live token).
    await this.col.createIndex({ verifyTokenHash: 1 }, { sparse: true })
    await this.col.createIndex({ resetTokenHash: 1 }, { sparse: true })
  }

  async create(input: {
    email: string
    passwordHash: string
    animaId: string
    verifyTokenHash: string
    verifyTokenExp: Date
  }): Promise<Credentum> {
    const now = this.now()
    const cred: Credentum = {
      id: uuidv4(),
      email: input.email,
      passwordHash: input.passwordHash,
      animaId: input.animaId,
      emailVerified: false,
      verifyTokenHash: input.verifyTokenHash,
      verifyTokenExp: input.verifyTokenExp,
      natum: now,
      mutatum: now,
    }
    try {
      await this.col.insertOne({ ...cred })
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) throw new EmailTakenError()
      throw err
    }
    return cred
  }

  async findByEmail(email: string): Promise<Credentum | null> {
    const doc = await this.col.findOne({ email })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByVerifyTokenHash(hash: string): Promise<Credentum | null> {
    const doc = await this.col.findOne({ verifyTokenHash: hash })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByResetTokenHash(hash: string): Promise<Credentum | null> {
    const doc = await this.col.findOne({ resetTokenHash: hash })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async markVerified(id: string): Promise<void> {
    await this.col.updateOne(
      { id },
      { $set: { emailVerified: true, mutatum: this.now() }, $unset: { verifyTokenHash: '', verifyTokenExp: '' } },
    )
  }

  async setVerifyToken(id: string, hash: string, exp: Date): Promise<void> {
    await this.col.updateOne({ id }, { $set: { verifyTokenHash: hash, verifyTokenExp: exp, mutatum: this.now() } })
  }

  async setResetToken(id: string, hash: string, exp: Date): Promise<void> {
    await this.col.updateOne({ id }, { $set: { resetTokenHash: hash, resetTokenExp: exp, mutatum: this.now() } })
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.col.updateOne(
      { id },
      { $set: { passwordHash, mutatum: this.now() }, $unset: { resetTokenHash: '', resetTokenExp: '' } },
    )
  }
}
