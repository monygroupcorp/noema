// =============================================================================
// MemoryCredentum — in-memory fiat-credential store for tests/dev.
// =============================================================================
//
// Same semantics as MongoCredentum (unique username) without Mongo.
// =============================================================================

import { v4 as uuidv4 } from 'uuid'
import { type Credentum, type CredentumStore, UsernameTakenError } from '../types/credentum.js'

export class MemoryCredentum implements CredentumStore {
  private readonly byId = new Map<string, Credentum>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  private find(pred: (c: Credentum) => boolean): Credentum | null {
    for (const c of this.byId.values()) if (pred(c)) return c
    return null
  }

  async create(input: {
    username: string
    passwordHash: string
    animaId: string
  }): Promise<Credentum> {
    if (this.find(c => c.username === input.username)) throw new UsernameTakenError()
    const now = this.now()
    const cred: Credentum = {
      id: uuidv4(),
      username: input.username,
      passwordHash: input.passwordHash,
      animaId: input.animaId,
      natum: now,
      mutatum: now,
    }
    this.byId.set(cred.id, cred)
    return { ...cred }
  }

  async findByUsername(username: string): Promise<Credentum | null> {
    const c = this.find(c => c.username === username)
    return c ? { ...c } : null
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    const c = this.byId.get(id)
    if (!c) return
    c.passwordHash = passwordHash
    c.mutatum = this.now()
  }
}
