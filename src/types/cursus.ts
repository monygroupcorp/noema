// =============================================================================
// CURSUS — the execution rail
// =============================================================================
//
// "Cursus" = running, course, career in Latin (4th declension masculine).
// The abstract concept of motion toward a result — not the result itself
// (that is the Actum), and not the thing being run (that is the Modus).
//
// LATIN CASE ROLES IN THIS FILE:
//   Cursor    (nominative singular) — one who runs; a single execution backend
//   Cursorum  (genitive plural)     — "of the runners"; the runner registry
//   Exitus    (nominative singular) — the exit/outcome of a run
//   Actorum   (genitive plural)     — "of the acts"; the actum store
//   Inceptio  (nominative singular) — "the undertaking"; initiation parameters
//
// EXECUTION RAIL:
//   ActumInceptor  → Cursorum.resolve(modus) → Cursor.reserve()
//                  → Signorum.lock()
//                  → Actum created { status: 'nascens' }
//
//   cursor.run(actum) → Exitus { exitus, impetus }
//
//   ActumCompletor → Actum updated { status: 'completus' }
//                  → Signorum.settle(actual)   // spends locked signa + refunds delta
//                  → Nexus.emit('execution_spend')
//
// TWO-PHASE COST CONTRACT (Cursor):
//   reserve()  — upper bound impetus, known before dispatch.
//                For pod tools: estimate based on Materia rate × expected duration.
//                For API tools: equals the fixed impetus (impetusFixum on Modus).
//   run()      — executes and returns actual impetus consumed.
//                Invariant: run().impetus ≤ reserve(). Guaranteed by each cursor.
//
// ADDING A NEW BACKEND = one Cursor file + one cursorum.register() call.
// No other changes. Self-hosted deployments register a LocalCursor.
// =============================================================================

import type { Modus } from './modus.js'
import type { Actum, ComputeStrategy, GpuClass, ModelRef } from './actum.js'
import type { Modo } from './modo.js'
import type { ArcanumSpendProof } from '../arcanum/types.js'

// ---------------------------------------------------------------------------
// CursorResult — what cursor.run() returns
// ---------------------------------------------------------------------------

/**
 * CursorResult — what cursor.run() returns.
 * sync: execution completed inline; Exitus is ready.
 * async: job submitted to external system; externusJobId is the handle for webhook correlation.
 */
export type CursorResult =
  | { kind: 'sync'; exitus: Exitus }
  | { kind: 'async'; externusJobId: string }

// ---------------------------------------------------------------------------
// Exitus — what a cursor hands back after completing execution
// ---------------------------------------------------------------------------

/**
 * Exitus — "the exit" in Latin — the outcome of a cursor run.
 *
 * Contains the actual outputs (exitus field maps to Actum.exitus),
 * the real impetus consumed (≤ the reserved amount), and timing metadata.
 */
export interface Exitus {
  /** The outputs produced — maps to Actum.exitus */
  exitus: Record<string, unknown>
  /**
   * Actual impetus consumed.
   * INVARIANT: ≤ the value returned by reserve() for the same modus + aditus.
   * This is what gets settled against the Signorum — not the reservation.
   */
  impetus: bigint
  /** Wall-clock execution time in milliseconds */
  duratio?: number
  /** FK → Materia. Which pod handled this run — absent for third-party cursors */
  materiamId?: string
}

// ---------------------------------------------------------------------------
// Cursor — one execution backend
// ---------------------------------------------------------------------------

/**
 * Cursor — "one who runs" in Latin (agent noun from currere).
 *
 * One cursor per service type: RunPodCursor, OpenAICursor, ReplicateCursor,
 * LocalCursor (self-hosted), etc. Registered in Cursorum by modus.ministerium.
 *
 * PURE EXECUTION CONTRACT:
 *   - reserve() must not have side effects (read-only cost estimate)
 *   - run() is the only method that dispatches to external systems
 *   - run().impetus ≤ reserve() — always, no exceptions
 */
export interface Cursor {
  /**
   * Upper bound on impetus for this modus + aditus combination.
   * Used by ActumInceptor for:
   *   1. Balance check before dispatch ("can this user afford this?")
   *   2. UI cost estimate ("here's the maximum you'll be charged")
   *   3. Signa selection — how much to lock from the ledger
   *
   * For fixed-cost API tools: returns Modus.impetusFixum exactly.
   * For pod tools: returns Materia.impetusPerSecond × maxExpectedSeconds.
   * For local/self-hosted: returns 0n (no cost to self).
   */
  reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint>

  /**
   * Dispatch and execute. Returns when the job is complete (or failed), or
   * submits to an external system and returns an externusJobId for async completion.
   * For sync cursors: result.exitus.impetus ≤ reserve(). Guaranteed by each cursor.
   */
  run(actum: Actum, modo?: Modo): Promise<CursorResult>
}

// ---------------------------------------------------------------------------
// Cursorum — the runner registry
// ---------------------------------------------------------------------------

/**
 * Cursorum — genitive plural "of the runners."
 * The registry that maps ministerium → Cursor.
 *
 * Analogous to Nexus for the execution rail: Nexus routes events to hooks,
 * Cursorum routes modus executions to cursors.
 *
 * Self-hosted deployments register a LocalCursor under each ministerium
 * they support. The rest of the system is unchanged.
 */
export interface Cursorum {
  /**
   * Register a cursor for a ministerium key.
   * "ministerium" must match the string on Modus.ministerium.
   */
  register(ministerium: string, cursor: Cursor): void
  /**
   * Resolve the correct cursor for a modus.
   * Throws if no cursor is registered for modus.ministerium.
   */
  resolve(modus: Modus): Cursor
}

// ---------------------------------------------------------------------------
// Actorum — the actum store
// ---------------------------------------------------------------------------

/**
 * Actorum — genitive plural "of the acts."
 * The interface for persisting Actum records.
 *
 * Follows the Signorum/Modorum/Cursorum pattern: the genitive plural names
 * the store that owns and manages its nominative type.
 *
 * Caller is responsible for generating the id (crypto.randomUUID()).
 * This allows the id to be known before the record is written,
 * which is required for Signorum.lock(signaIds, actumId).
 */
export interface Actorum {
  /** Write a new actum record. id must be pre-generated by the caller. */
  create(actum: Omit<Actum, 'inceptum'>): Promise<Actum>
  /**
   * Patch a subset of mutable fields on an existing actum.
   * Only fields that change between nascens → completus/fractus are patchable.
   * expirat may be updated to extend a deadline if execution is still in progress.
   */
  update(
    id: string,
    patch: Partial<Pick<Actum, 'status' | 'exitus' | 'error' | 'completum' | 'duratio' | 'impetus' | 'materiamId' | 'signaConsumed' | 'expirat' | 'externusJobId' | 'deploymentHash' | 'executio'>>
  ): Promise<Actum>
  findById(id: string): Promise<Actum | null>
  /** Find an actum by the external job ID assigned at submission time. */
  findByExternusJobId(externusJobId: string): Promise<Actum | null>
  /**
   * Find an actum by its nullifier — the spend proof stamped when an arcanum
   * signum was consumed. Used to reject double-spend attempts.
   */
  findByNullifier(nullifier: string): Promise<Actum | null>
  /**
   * Return all nascens actum records whose expirat is in the past.
   * These are stuck executions — the cursor never reported back.
   * Caller should call ActumCompletor.fail() on each to release locked signa.
   */
  findExpired(): Promise<Actum[]>
  /** Return all nascens/agens actums that have an externusJobId — in-flight pods. */
  findInFlight(): Promise<Actum[]>
}

// ---------------------------------------------------------------------------
// ActumCompletor — finishes an actum and settles its signa
// ---------------------------------------------------------------------------

/**
 * ActumCompletor — settles an actum after execution.
 *
 * Called by cursors (or the recovery sweep) when execution ends.
 * Updates the Actum record and settles the Signorum ledger.
 */
export interface ActumCompletor {
  /**
   * Mark an actum completus and settle its locked signa.
   * Calls Signorum.settle(actual) — user is charged exactly exitus.impetus.
   */
  complete(actum: Actum, exitus: Exitus): Promise<Actum>
  /**
   * Mark an actum fractus and release its locked signa.
   * Calls Signorum.release() — user is charged nothing.
   */
  fail(actum: Actum, error: string): Promise<Actum>
}

// ---------------------------------------------------------------------------
// Inceptio — initiation parameters
// ---------------------------------------------------------------------------

/**
 * Inceptio — "the undertaking" in Latin.
 * The parameters passed to ActumInceptor.initiate() to begin an execution.
 */
export interface Inceptio {
  modusId: string
  /** Specific version to run. Absent = latest registered version. */
  versio?: string
  aditus: Record<string, unknown>
  /**
   * Who is paying.
   *   { animaId }      — identified user; balance queried from Signorum by animaId.
   *   { commitment }   — legacy anonymous path: looks up arcanum signa by commitment hash.
   *                      Deprecated — use arcanumProof for the real unlinkable spend.
   *   { arcanumProof } — ZK Groth16 proof of Merkle note membership.
   *                      The real anonymous path: platform cannot link spend to identity.
   */
  by: { animaId: string } | { commitment: string } | { arcanumProof: ArcanumSpendProof }
  /** FK → Modo. The session this actum runs within — optional */
  modoId?: string
  /**
   * Per-run compute strategy override. Absent = use the Modus default,
   * which itself falls back to 'standard' if unset.
   * Set from the advanced settings panel on the run button.
   */
  computeStrategy?: ComputeStrategy
  /**
   * Per-run GPU class override. Only meaningful when computeStrategy is 'performance'.
   * Absent = use the Modus default.
   */
  gpuClass?: GpuClass
  /**
   * Opaque routing hint when the runner deep-linked into a specific host's pod
   * (e.g. /start pod_<token>). The cursor uses Praefectus.findByShareToken to
   * dispatch onto the host's Materia. Non-identity by construction.
   */
  shareTokenHint?: string
  /**
   * Models the host pinned onto the studio loadout via `Mod • → Add`. Stored on the Actum
   * and unioned into `spec.models` by the Compiler. Absent for ordinary `/make`.
   */
  pinnedModels?: ModelRef[]
}
