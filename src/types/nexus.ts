// =============================================================================
// NEXUS — the typed event bus that connects business events to ledger entries
// =============================================================================
//
// "nexus" = connection/binding in Latin (4th declension masculine)
// nexus, nexus, nexui, nexum, nexu
//
// The Nexus is NOT a data type — it is the wiring layer above the Signorum
// ledger. It decouples business events from their financial consequences:
//
//   emit(execution_spend event)
//     → hostCutHook      → [reward signum for host]
//     → spellRoyaltyHook → [reward signum for modus author]
//     → modelRoyaltyHook → [reward signa for intella authors]
//     → platformSkimHook → [reward signum for platform]
//   → Signorum commits all atomically
//
// Adding a new revenue event = one new hook registration.
// No pipeline modification. No branching. Each hook is its own file.
//
// HOOKS ARE PURE: event in → signa out. No DB calls inside hooks.
// EMIT IS ATOMIC: all signa from all hooks land together or none do.
//
// HOOKS HANDLE DISTRIBUTION ONLY. Deduction (marking signa spent) happens
// via Signorum.settle() before emit. Hooks produce what flows OUT
// to other parties as a result of the settlement.
// =============================================================================

import type { Actum } from './actum'
import type { Modo } from './modo'
import type { Signum, Signa } from './significandi'
import type { HostKey } from './hospitium'

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type SignumEventType =
  | 'execution_spend'    // a modus ran and was paid for
  | 'session_spend'      // pod-time accrued on a modo
  | 'studio_spend'       // continuous per-time host debit for a studio being alive
  | 'deposit_confirmed'  // inbound credit landed
  | 'royalty_fired'      // internal — triggers platform skim hook

// The payload each event type carries — typed per event
export interface SignumEventPayload {
  execution_spend: {
    actum: Actum
    modo?: Modo
    /** Total impetus points charged for this execution (base + warm surcharge if guest tier). */
    impetus: bigint
    /**
     * Base impetus before any hosting surcharge. hostCutHook taxes this (not
     * `impetus`) so the surcharge isn't double-compensated — the host receives
     * the surcharge separately via hospitiumHook. Stamped at dispatch on
     * `actum.executio.baseImpetus`; equals `impetus` for owner/admin tiers.
     */
    baseImpetus: bigint
    /**
     * Host of the pod this execution ran on — full HostKey so both identified
     * (animaId) and anonymous (commitment) hosts collect via the same payload.
     * Present only when the execution ran on a hosted pod with a guest-tier
     * pricing decision; absent on owner/admin/no-Hospitium paths.
     */
    modoHostKey?: HostKey
    /** animaId of the modus author — for spell royalty */
    modusAuctorAnimaId?: string
    /**
     * Model-royalty payees + their weights — who earns when this execution's models
     * are used, and in what proportion. The single who-earns answer the modelRoyalty
     * hook splits the pool across (pool × weight / Σweight). Equal credit across the
     * models' authors is just equal weights; a published rights split (a model's
     * `Editio.owners[]`, from a Sodalitas or an explicit split — publishing.md §5e)
     * is unequal weights. Populated at execution by resolving the models an actum
     * used → their authors / published split (the remaining integration, §9).
     */
    intellaRoyaltyPayees?: Array<{ animaId: string; weight: number }>
  }

  session_spend: {
    modo: Modo
    /** Seconds of pod-time being billed in this tick */
    seconds: number
    impetus: bigint
  }

  studio_spend: {
    /** The studio (Materia) being billed. */
    materiaId: string
    /** Identified or anonymous host receiving the debit. */
    hostKey: HostKey
    /**
     * Impetus to debit, **already clamped to the host's available balance** by the
     * caller (Census ticker). The hook is pure — it cannot read balance —
     * so clamping happens upstream. The ticker also decides whether a shortfall
     * (clamped < requested) should engage drainOnly mode on the Materia.
     */
    impetus: bigint
    /** Seconds of compute being billed in this tick (for diagnostics + analytics). */
    seconds: number
  }

  deposit_confirmed: {
    signum: Signum
    /** animaId of the referrer — for referral split hook */
    referrerAnimaId?: string
  }

  royalty_fired: {
    actumId: string
    /** Total royalty valor that fired — for platform skim calculation */
    royaltyValor: bigint
    /** Base impetus of the execution — platform skim is 5% of this */
    baseValor: bigint
  }
}

export interface SignumEvent<T extends SignumEventType> {
  type: T
  payload: SignumEventPayload[T]
}

// ---------------------------------------------------------------------------
// Hook type
// ---------------------------------------------------------------------------

/**
 * A SignumHook observes one event type and produces zero or more Signum
 * entries to add to the ledger.
 *
 * PURE FUNCTION CONTRACT:
 *   - No DB calls
 *   - No side effects
 *   - Same event → same signa (deterministic)
 *   - Return [] to produce no entries (e.g. condition not met)
 */
export type SignumHook<T extends SignumEventType> = (
  event: SignumEvent<T>
) => Promise<Array<Omit<Signum, 'id' | 'natum' | 'status'>>>

// ---------------------------------------------------------------------------
// Nexus interface
// ---------------------------------------------------------------------------

/**
 * Nexus — the event bus.
 *
 * Registers hooks per event type. On emit, fans the event out to all
 * registered hooks, collects their signa, and returns them for atomic
 * commit by SignorumService.
 */
export interface Nexus {
  on<T extends SignumEventType>(type: T, hook: SignumHook<T>): void
  emit<T extends SignumEventType>(event: SignumEvent<T>): Promise<Array<Omit<Signum, 'id' | 'natum' | 'status'>>>
}
