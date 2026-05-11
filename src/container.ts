import type { Collection, MongoClient } from 'mongodb'
import type { Modus } from './types/modus.js'
import type { Actorum, Cursorum, ActumCompletor as IActumCompletor } from './types/cursus.js'
import type { Signorum } from './types/significandi.js'
import type { Modorum } from './types/modus.js'
import type { AnimaStore } from './types/anima.js'
import type { PersonaStore } from './types/persona.js'

import { MongoActorum } from './crystal/MongoActorum.js'
import { MongoModorum } from './crystal/MongoModorum.js'
import { MongoSignorum } from './crystal/MongoSignorum.js'
import { MongoAnima } from './crystal/MongoAnima.js'
import { MongoPersona } from './crystal/MongoPersona.js'
import { RunPodCursor } from './crystal/RunPodCursor.js'
import { SimpleCursorum } from './crystal/SimpleCursorum.js'
import { ActumCompletor } from './crystal/ActumCompletor.js'

export interface Ring {
  actorum: Actorum
  modorum: Modorum
  signorum: Signorum
  animae: AnimaStore
  personae: PersonaStore
  cursorum: Cursorum
  completor: IActumCompletor
}

export interface ContainerConfig {
  /** Atlas URI or local connection string */
  mongoUri: string
  /** MongoDB database name — never 'noema' or 'noemaplane' in tests */
  dbName: string
  /** RunPod accountId forwarded to GenerationRunner */
  accountId: string
  /**
   * Compile a Modus + aditus into a GenerationRunner deployment object.
   * Injected so the container doesn't depend directly on the JS Compiler.
   * Phase 2: replace with MongoModorum-backed Compiler.
   */
  compile: (modus: Modus, aditus: Record<string, unknown>) => Promise<unknown>
  /**
   * A GenerationRunner-compatible runner.
   * Injected so the container can be wired with the existing JS GenerationRunner
   * without importing it (avoids circular ESM ↔ CJS boundary issues in Phase 1).
   */
  runner: {
    runDeployment(args: { deployment: unknown; accountId: string; jobId: string }): Promise<unknown>
  }
  /** Collection name for acta — default 'acta' */
  actaCollection?: string
  /** Collection name for modi — default 'modi' */
  modiCollection?: string
  /** Collection name for signa — default 'signa' */
  signaCollection?: string
  /** Collection name for animae — default 'animae' */
  animaeCollection?: string
  /** Collection name for personae — default 'personae' */
  personaeCollection?: string
}

export function createContainer(mongo: MongoClient, config: ContainerConfig): Ring {
  const db = mongo.db(config.dbName)

  // ── Phase 1 + 2: real ─────────────────────────────────────────────────────
  const col: Collection = db.collection(config.actaCollection ?? 'acta')
  const actorum = new MongoActorum(col)

  const modiCol: Collection = db.collection(config.modiCollection ?? 'modi')
  const modorum = new MongoModorum(modiCol)

  const signaCol: Collection = db.collection(config.signaCollection ?? 'signa')
  const signorum = new MongoSignorum(signaCol)

  const animaeCol: Collection = db.collection(config.animaeCollection ?? 'animae')
  const animae = new MongoAnima(animaeCol)

  const personaeCol: Collection = db.collection(config.personaeCollection ?? 'personae')
  const personae = new MongoPersona(personaeCol)

  // ── Execution rail ─────────────────────────────────────────────────────────
  const runpodCursor = new RunPodCursor(
    config.runner as Parameters<typeof RunPodCursor>[0],
    config.compile,
    modorum,
    { accountId: config.accountId },
  )

  const cursorum = new SimpleCursorum()
  cursorum.register('runpod', runpodCursor)

  const completor = new ActumCompletor(actorum, signorum)

  return { actorum, modorum, signorum, animae, personae, cursorum, completor }
}
