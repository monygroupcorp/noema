// =============================================================================
// SPONSIO — a standing, directed, capped funding pledge (ADR-0011 §2).
// =============================================================================
//
// "Sponsio" = a solemn pledge/guarantee in Roman law. Sponsorship is a UNIVERSAL,
// user-facing capability, not an agent privilege: a person topping up a friend, a
// collective funding a creator, and a treasury funding an agent are the SAME shape —
// "keep this account topped up on a cadence." It is fully built on the ledger
// `transfer` primitive (ADR-0011 §3); the subsidy sweep worker drips it.
//
// POOLED-SINGULAR model (owner decision 2026-07-02, simplifying the ADR): BOTH ends
// of a pledge are a single `Anima`. A "collective" is not a group beneficiary — it is
// an ordinary sponsor `Anima` that MANY backers fund by `transfer`-ing credits INTO
// it (the treasury-as-Anima pattern, ADR §1). So there is no group membership to
// enumerate, no `Animarum`/`Sodalitas` resolution, and no fan-out: the sweeper only
// ever drips account → account. Funding a whole team = one pledge per member (a thin
// snapshot helper, if ever wanted), never baked into this model.

export type SubsidyCadence = 'weekly' | 'biweekly' | 'monthly'

/**
 * SubsidyPolicy — the generalized faucet. How much to drip to the beneficiary, and
 * how often. Simplified from the ADR (no `perMemberCap`/`strategy` — those only
 * meant something for group fan-out, which this model removes).
 */
export interface SubsidyPolicy {
  /** Points to drip each cycle. */
  grant: bigint
  cadence: SubsidyCadence
  /**
   * Optional balance ceiling: don't top the beneficiary above this. A drip is
   * clamped to `balanceCap - currentBalance` (and skipped if already at/over cap),
   * so an idle beneficiary doesn't accumulate unbounded credit.
   */
  balanceCap?: bigint
}

export interface Sponsio {
  id: string
  /** The pooled sponsor account (many backers fund it via `transfer`). */
  sponsor: { animaId: string }
  /** The single beneficiary account being topped up. */
  beneficiarius: { animaId: string }
  subsidia: SubsidyPolicy
  /** Lifetime cap on total dripped via this pledge. Absent = unbounded. */
  capTotal?: bigint
  /** Running total dripped so far — enforces `capTotal`. */
  drippedTotal: bigint
  /**
   * The last cycle key this pledge dripped for (e.g. `2026-W27`). The sweeper's
   * idempotency guard: a cycle is CAS-claimed here so one drip happens per cycle
   * even under concurrent sweeps.
   */
  lastDripCycle?: string
  /** `active` drips; `paused` is held by the sponsor; `exhausted` hit `capTotal`. */
  status: 'active' | 'paused' | 'exhausted'
  natum: Date
}

/** "Sponsiones" — nominative plural. */
export type Sponsiones = Sponsio[]

export interface SponsioStore {
  create(input: Omit<Sponsio, 'id' | 'natum' | 'status' | 'drippedTotal'> & { status?: Sponsio['status'] }): Promise<Sponsio>
  find(id: string): Promise<Sponsio | null>
  /** All pledges owned by a sponsor Anima (for the user's "my sponsorships" view). */
  listBySponsor(animaId: string): Promise<Sponsiones>
  /** All `active` pledges — the sweep worker's work list. */
  listActive(): Promise<Sponsiones>
  /**
   * Atomically claim `cycle` for this pledge (compare-and-set on `lastDripCycle`).
   * Returns true iff THIS call won the slot — the caller may then drip exactly once.
   * A concurrent sweeper claiming the same cycle gets false and skips.
   */
  claimCycle(id: string, cycle: string): Promise<boolean>
  /** Undo a cycle claim (the drip failed → let a later sweep retry when funded). */
  releaseCycle(id: string, cycle: string): Promise<void>
  /** Add to `drippedTotal` (after a successful drip); flip to `exhausted` at `capTotal`. */
  recordDrip(id: string, amount: bigint): Promise<void>
  setStatus(id: string, status: Sponsio['status']): Promise<void>
}
