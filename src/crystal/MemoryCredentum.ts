// =============================================================================
// MemoryCredentum — in-memory fiat-credential store for tests/dev.
// =============================================================================
//
// Same semantics as MongoCredentum (unique email, token-hash lookups) without Mongo.
// =============================================================================

import { v4 as uuidv4 } from 'uuid'
import { type Credentum, type CredentumStore, EmailTakenError } from '../types/credentum.js'

export class MemoryCredentum implements CredentumStore {
  private readonly byId = new Map<string, Credentum>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  private find(pred: (c: Credentum) => boolean): Credentum | null {
    for (const c of this.byId.values()) if (pred(c)) return c
    return null
  }

  async create(input: {
    email: string
    passwordHash: string
    animaId: string
    verifyTokenHash: string
    verifyTokenExp: Date
  }): Promise<Credentum> {
    if (this.find(c => c.email === input.email)) throw new EmailTakenError()
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
    this.byId.set(cred.id, cred)
    return { ...cred }
  }

  async findByEmail(email: string): Promise<Credentum | null> {
    const c = this.find(c => c.email === email)
    return c ? { ...c } : null
  }

  async findByVerifyTokenHash(hash: string): Promise<Credentum | null> {
    const c = this.find(c => c.verifyTokenHash === hash)
    return c ? { ...c } : null
  }

  async findByResetTokenHash(hash: string): Promise<Credentum | null> {
    const c = this.find(c => c.resetTokenHash === hash)
    return c ? { ...c } : null
  }

  async markVerified(id: string): Promise<void> {
    const c = this.byId.get(id)
    if (!c) return
    c.emailVerified = true
    delete c.verifyTokenHash
    delete c.verifyTokenExp
    c.mutatum = this.now()
  }

  async setVerifyToken(id: string, hash: string, exp: Date): Promise<void> {
    const c = this.byId.get(id)
    if (!c) return
    c.verifyTokenHash = hash
    c.verifyTokenExp = exp
    c.mutatum = this.now()
  }

  async setResetToken(id: string, hash: string, exp: Date): Promise<void> {
    const c = this.byId.get(id)
    if (!c) return
    c.resetTokenHash = hash
    c.resetTokenExp = exp
    c.mutatum = this.now()
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    const c = this.byId.get(id)
    if (!c) return
    c.passwordHash = passwordHash
    delete c.resetTokenHash
    delete c.resetTokenExp
    c.mutatum = this.now()
  }
}
