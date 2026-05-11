import type { Collection, MongoClient } from 'mongodb'
import type { Modus } from './types/modus.js'
import type { Actorum, Cursorum, ActumCompletor as IActumCompletor } from './types/cursus.js'
import type { Signorum } from './types/significandi.js'
import type { Modorum } from './types/modus.js'

import { MongoActorum } from './crystal/MongoActorum.js'
import { MongoModorum } from './crystal/MongoModorum.js'
import { RunPodCursor } from './crystal/RunPodCursor.js'
import { MemorySignorum } from './crystal/MemorySignorum.js'
import { SimpleCursorum } from './crystal/SimpleCursorum.js'
import { ActumCompletor } from './crystal/ActumCompletor.js'

export interface Ring {
  actorum: Actorum
  modorum: Modorum
  signorum: Signorum
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
}

export function createContainer(mongo: MongoClient, config: ContainerConfig): Ring {
  const db = mongo.db(config.dbName)

  // ── Phase 1 + 2: real ─────────────────────────────────────────────────────
  const col: Collection = db.collection(config.actaCollection ?? 'acta')
  const actorum = new MongoActorum(col)

  const modiCol: Collection = db.collection(config.modiCollection ?? 'modi')
  const modorum = new MongoModorum(modiCol)

  // ── Phase 3: in-memory stub ────────────────────────────────────────────────
  const signorum = new MemorySignorum() // → MongoSignorum in Phase 3

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

  return { actorum, modorum, signorum, cursorum, completor }
}
