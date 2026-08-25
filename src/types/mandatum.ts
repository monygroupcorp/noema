// =============================================================================
// MANDATUM — the autonomous instruction
// =============================================================================
//
// "Mandatum" = mandate, charge, instruction (Latin, from mandare: to entrust,
// to commission). In Roman law, a mandatum was a commission given to an agent
// to act on the principal's behalf. The agent (mandatarius) acts autonomously
// within the scope of the mandate.
//
// A Mandatum is a standing instruction to execute a Modus when a trigger fires.
// It persists between executions — unlike an Actum, which records one run,
// a Mandatum can fire many times. An agent IS a Mandatum: autonomous, scoped,
// potentially self-scheduling (a Mandatum whose exitus creates new Mandatora).
//
// PRIVACY: A Mandatum can be anonymous. When by.commitment is set, the
// autonomous actor has no identity — the same privacy partition as Modo.
// An anonymous agent is a standing commitment to act, funded by a ZK balance.
//
// Trigger types:
//   'schedula'  — fires on a cron schedule ("every hour", "at 09:00 UTC")
//   'eventus'   — fires when a named platform event occurs
//   'manualis'  — fires only when explicitly triggered by the holder
//   'catena'    — fires when a parent Actum completes (chained execution)
// =============================================================================

export type MandatumTriggerGenus = 'schedula' | 'eventus' | 'manualis' | 'catena'

export type MandatumStatus =
  | 'active'      // enabled, will fire on trigger
  | 'dormiens'    // sleeping — trigger paused, not firing
  | 'exhaustus'   // exhausted — ran out of budget or max-runs reached
  | 'revocatum'   // revoked — permanently disabled

/**
 * Causa — why a mandatum reached a terminal status. A CODE, never prose: the surface
 * that renders it owns the words, so copy can change without a data migration and no
 * reader ever has to parse a sentence to learn what happened.
 *
 *   'impletum'   — fulfilled: a run succeeded and there is nothing left to do.
 *   'defectus'   — stopped on a real answer: a failure asking again cannot fix.
 *   'consumptum' — the window closed or the attempts ran out without a success.
 *   'revocatum'  — the holder cancelled it.
 */
export type MandatumCausa = 'impletum' | 'defectus' | 'consumptum' | 'revocatum'

/**
 * Schedula — the schedule definition for a 'schedula' trigger.
 * "schedula" = a small note/schedule in late Latin.
 */
export interface Schedula {
  /** Cron expression (UTC) — e.g. "0 * * * *" (every hour) */
  cron: string
  /** Timezone for cron evaluation — default UTC */
  zona?: string
  /** Maximum number of times this mandatum may fire. Absent = unlimited. */
  maxRuns?: number
}

/**
 * Mandatum — a standing autonomous instruction.
 *
 * When the trigger fires, ActumInceptor is called with the stored modusId,
 * aditus, and by. The resulting Actum is recorded in acta[].
 * The mandatum continues to exist after execution — it fires again on the
 * next trigger unless status reaches 'exhaustus' or 'revocatum'.
 */
export interface Mandatum {
  id: string
  /** "nomen" = name in Latin — optional human label */
  nomen?: string

  /** FK → Modus. What to execute when the trigger fires */
  modusId: string
  /** The inputs to pass — may include template expressions for dynamic values */
  aditus: Record<string, unknown>
  /** Who pays — identified (animaId) or anonymous (commitment) */
  by: { animaId: string } | { commitment: string }

  /** What causes this mandatum to fire */
  triggerGenus: MandatumTriggerGenus
  /**
   * Schedule definition — required when triggerGenus is 'schedula'.
   * Absent for event-driven and manual triggers.
   */
  schedula?: Schedula
  /**
   * Event name — required when triggerGenus is 'eventus'.
   * Platform event that triggers execution (e.g. 'deposit_confirmed', 'modo_active').
   */
  eventus?: string
  /**
   * Parent actum — required when triggerGenus is 'catena'.
   * This mandatum fires when the referenced actum reaches 'completus'.
   */
  parentActumId?: string

  status: MandatumStatus
  /** Why it reached a terminal status. Set exactly once, with the terminal write. */
  causa?: MandatumCausa

  /**
   * "finis" = the end. The wall-clock deadline of the whole order: past it the mandatum
   * stops, whatever attempts remain. A standing order is bounded in TIME as well as in
   * count so a persistently broken dependency cannot keep asking indefinitely.
   */
  finis?: Date
  /**
   * "proximum" = the next one. When this mandatum is next due to be looked at. The store's
   * due-query reads exactly this field, so a mandatum with no `proximum` is never picked up.
   */
  proximum?: Date
  /**
   * "pendens" = hanging, awaiting outcome. FK → Actum: the attempt whose result the order is
   * waiting on. While set, the runner WATCHES (it reads that actum's outcome) rather than
   * firing; cleared once the outcome is known. This is what keeps one order to one in-flight
   * attempt — the runner cannot start a second run while the first is still going.
   */
  pendens?: string
  /**
   * Dispatch options the ORIGINAL request carried that the resulting Actum does not persist,
   * kept here so every later attempt is dispatched on the same terms as the first — most
   * importantly the spend cap, which must keep applying to attempts the holder is not
   * watching.
   */
  invocatio?: {
    /** Hard admission cap, serialised (bigint → string) to stay JSON/BSON-safe. */
    maxImpetus?: string
    computeStrategy?: string
    gpuClass?: string
  }

  /** FK[] → Actum. All executions triggered by this mandatum */
  acta: string[]
  /** How many times this mandatum has fired */
  ignitions: number

  /** "natum" = born — when this mandatum was created */
  natum: Date
  /** "mutatum" = changed — when this mandatum was last modified */
  mutatum: Date
  /** When this mandatum last fired */
  ignitum?: Date
}

/** "Mandata" — nominative plural of mandatum (neuter 2nd declension) */
export type Mandata = Mandatum[]

/**
 * Mandatorum — genitive plural "of the mandates."
 * The mandate store — all standing autonomous instructions.
 */
export type MandatumPatch = Partial<
  Pick<Mandatum, 'status' | 'causa' | 'acta' | 'ignitions' | 'ignitum' | 'mutatum' | 'proximum' | 'pendens' | 'finis'>
> & {
  /** Explicit clear for `pendens` — the order is no longer waiting on an attempt. */
  pendens?: string | undefined
}

export interface Mandatorum {
  find(id: string): Promise<Mandatum | null>
  list(filter?: Partial<Pick<Mandatum, 'status' | 'triggerGenus'>>): Promise<Mandata>
  create(mandatum: Omit<Mandatum, 'id' | 'natum' | 'mutatum' | 'acta' | 'ignitions'>): Promise<Mandatum>
  update(id: string, patch: MandatumPatch): Promise<Mandatum>
  /** Returns all active mandata due to fire at or before the given time */
  due(at: Date): Promise<Mandata>
  /**
   * Claim ONE due mandatum for exclusive handling, atomically, holding it for `leaseMs`.
   * The store IS the queue (the shape `PublicationWorker` already runs on): the claim is a
   * single conditional write, so two runners — or one runner and its own overlapping tick —
   * can never work the same order, and a runner that dies mid-handle releases it when the
   * lease lapses rather than stranding it. Returns null when nothing is claimable.
   */
  claimDue(at: Date, leaseMs: number): Promise<Mandatum | null>
  /** The mandatum that owns a given attempt (the actum id appears in its `acta`). */
  findByActum(actumId: string): Promise<Mandatum | null>
  /** Set when this mandatum is next due to be looked at. */
  setNextFire(id: string, nextFire: Date): Promise<void>
}
