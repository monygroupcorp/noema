import type { Collection, MongoClient } from 'mongodb'
import type { Modus } from './types/modus.js'
import type { Actorum, Cursorum, ActumCompletor as IActumCompletor } from './types/cursus.js'
import type { Signorum } from './types/significandi.js'
import type { Modorum } from './types/modus.js'
import type { AnimaStore } from './types/anima.js'
import type { PersonaStore } from './types/persona.js'
import type { Vestigiorum } from './types/vestigium.js'
import type { ModoStore } from './types/modo.js'

import { MongoActorum } from './crystal/MongoActorum.js'
import { MongoModorum } from './crystal/MongoModorum.js'
import { MongoSignorum } from './crystal/MongoSignorum.js'
import { MongoAnima } from './crystal/MongoAnima.js'
import { MongoPersona } from './crystal/MongoPersona.js'
import { MongoVestigiorum } from './crystal/MongoVestigiorum.js'
import { MongoModo } from './crystal/MongoModo.js'
import { RunPodCursor } from './crystal/RunPodCursor.js'
import { TesseraCursor } from './crystal/TesseraCursor.js'
import { SimpleCursorum } from './crystal/SimpleCursorum.js'
import { ActumCompletor } from './crystal/ActumCompletor.js'

export interface Ring {
  actorum: Actorum
  modorum: Modorum
  signorum: Signorum
  animae: AnimaStore
  personae: PersonaStore
  vestigiorum: Vestigiorum
  modos: ModoStore
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
  /** Collection name for vestigia — default 'vestigia' */
  vestigiaCollection?: string
  /** Collection name for modos — default 'modos' */
  modosCollection?: string
  /**
   * Embed function for semantic search — inject the OpenAI/local model.
   * Absent: index() and search() will throw; create/findById/forIdentity still work.
   */
  embed?: (text: string) => Promise<number[]>
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

  const vestigiaCol: Collection = db.collection(config.vestigiaCollection ?? 'vestigia')
  const vestigiorum = new MongoVestigiorum(vestigiaCol, config.embed)

  const modosCol: Collection = db.collection(config.modosCollection ?? 'modos')
  const modos = new MongoModo(modosCol)

  // ── Execution rail ─────────────────────────────────────────────────────────
  const runpodCursor = new RunPodCursor(
    config.runner as Parameters<typeof RunPodCursor>[0],
    config.compile,
    modorum,
    { accountId: config.accountId },
  )

  const tesseraCursor = new TesseraCursor(runpodCursor, modos, signorum)

  const cursorum = new SimpleCursorum()
  cursorum.register('runpod', runpodCursor)
  cursorum.register('tessera', tesseraCursor)

  const completor = new ActumCompletor(actorum, signorum)

  return { actorum, modorum, signorum, animae, personae, vestigiorum, modos, cursorum, completor }
}
