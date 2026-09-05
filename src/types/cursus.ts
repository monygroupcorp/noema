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
import type { Actum, ActumStatus, ComputeStrategy, GpuClass, ModelRef } from './actum.js'
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
 * One cursor per service type: RunPodCursor, ApiCursor (descriptor-driven —
 * OpenAI/OpenRouter/…), LocalCursor (self-hosted), etc. Registered in Cursorum
 * by modus.ministerium.
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

  /**
   * Wall-clock budget for this run, in ms, measured from initiation — how long the actum may
   * legitimately sit in {nascens,agens} before the reaper is right to call it dead.
   *
   * NOT a price, and NOT derived from reserve(): reserve() returns impetus, which for several
   * cursors is a declared price (`modus.impetusFixum`, `modus.pretium`) rather than a duration.
   * Time gets its own declaration so a cost curve can never be read as a deadline.
   *
   * Optional. A cursor that omits it gets the inceptor's DEFAULT_EXPIRAT_MS, unchanged. The
   * resolved value is clamped to MAX_TERMINUS_MS by ActumInceptor.
   */
  terminus?(modus: Modus, aditus: Record<string, unknown>): Promise<number>
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
    patch: Partial<Pick<Actum, 'status' | 'exitus' | 'error' | 'completum' | 'duratio' | 'impetus' | 'materiamId' | 'signaConsumed' | 'expirat' | 'externusJobId' | 'callbackNonce' | 'oneshotPod' | 'resumeCheckpoint' | 'deploymentHash' | 'executio' | 'progressus' | 'phaseDurations' | 'firstHeartbeatDeadlineMs' | 'podLockedAt' | 'firstPodReportAt'>>
  ): Promise<Actum>
  findById(id: string): Promise<Actum | null>
  /** Find an actum by the external job ID assigned at submission time. */
  findByExternusJobId(externusJobId: string): Promise<Actum | null>
  /**
   * Find an actum by the per-job callback nonce minted at dispatch. The inbound execution
   * webhook admits a callback only when this resolves to the same actum the reported job id
   * resolves to. Stable across a pod retry (which rotates `externusJobId`).
   */
  findByCallbackNonce(callbackNonce: string): Promise<Actum | null>
  /**
   * Find a LIVE actum by its nullifier — the spend proof stamped when an arcanum signum was
   * consumed. Used to reject double-spend attempts. Excludes FAILED (`fractus`) acta: a failed run
   * refunds its signa, voiding the spend, so the commitment is free to re-spend.
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
  /**
   * Return the child step acta of a compositus run — those whose `compositum.parentId`
   * matches. Used to derive ownership of the cost-free parent (which holds no signa of
   * its own) from its children's `signaConsumed` / bearer tokens. (ADR-0008.)
   */
  findByCompositum(parentId: string): Promise<Actum[]>
  /**
   * How many of `ids` currently hold one of `statuses` — answered by the store in ONE query
   * rather than a `findById` per id. The caller names the predicate so this method carries no
   * status opinion of its own (unlike `findInFlight`, which also requires an `externusJobId`).
   *
   * Optional, the same way `Collectionum.listOwned` is: a store may omit it and the caller
   * falls back to the per-id scan. Every store a deployment actually runs on implements it —
   * the fallback costs one database round trip per id, and its callers pass a whole
   * collection's acta.
   */
  countByIdsWithStatus?(ids: string[], statuses: ActumStatus[]): Promise<number>
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
  complete(
    actum: Actum,
    exitus: Exitus,
    /** Optional identified owner, threaded by callers who already resolved it (webhook
     *  rail, dispatchInceptio sync path). Absent for anonymous/system acta — indexing
     *  is skipped, not an error. */
    auctor?: { animaId: string } | { commitment: string },
  ): Promise<Actum>
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
   *   { bursaToken }  — bearer token for an anonymous credit purse (Bursa).
   *                      Purse was minted by redeeming an arcanumProof once; subsequent
   *                      runs present the token without re-proving.
   */
  by: { animaId: string } | { commitment: string } | { arcanumProof: ArcanumSpendProof } | { bursaToken: string }
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
  /**
   * Compositus linkage — set ONLY when this initiation is a child step of a
   * compositus run (ADR-0008). Stamped onto the created Actum as `Actum.compositum`
   * so the execution webhook can route the completed step back to the
   * CompositusCursor. Absent for ordinary single-modus runs.
   */
  compositum?: { parentId: string; ordine: number }
}
