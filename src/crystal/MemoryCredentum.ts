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

  /** The caller's OWN row by animaId — username + timestamps, NEVER the passwordHash
   *  (stripped here so the export path can't leak it). Mirrors MongoCredentum.findByAnimaId. */
  async findByAnimaId(animaId: string): Promise<Omit<Credentum, 'passwordHash'> | null> {
    const c = this.find(c => c.animaId === animaId)
    if (!c) return null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _omit, ...rest } = c
    return { ...rest }
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    const c = this.byId.get(id)
    if (!c) return
    c.passwordHash = passwordHash
    c.mutatum = this.now()
  }
}
