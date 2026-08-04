// =============================================================================
// ANIMA — the persistent user soul
// =============================================================================
//
// "Anima" = soul/breath of life in Latin (from Greek "anemos" = wind/breath).
// An anima is the identity that persists across platforms, sessions, and pods.
// When the pod terminates, the anima survives. When the user switches from
// Telegram to Discord, the same anima is behind both.
//
// One anima, many personae — the soul beneath the mask.
// (See persona.ts for the platform-specific masks.)
//
// GROUPS ARE GRAMMAR, NOT A NEW CRYSTAL:
//   anima     → one user (nominative singular)
//   animae    → a group/team (nominative plural) — just the natural plural
//   animarum  → group parameters (genitive plural: "of the souls") → Animarum
//   animis    → group context, collective runtime (dative/ablative plural)
//
// No new "Team" or "Group" type is needed. Group behavior emerges from
// the declension of anima.
// =============================================================================

/**
 * Anima — the persistent soul of a user.
 *
 * Survives: platform changes, pod terminations, session ends.
 * Does NOT survive: user explicitly deleting their account.
 */
/**
 * PublishingPrefs — per-identity publishing defaults (docs/spec/publishing.md §5c).
 *
 * Kills the "everything → HuggingFace" hardcode: that becomes
 * `defaultDestination='huggingface', defaultCustody='ours'` — a default, not a
 * hardcode. A user with their own account flips `defaultCustody='theirs'` + a BYO
 * target below. Lives on Anima (low-churn, no new store); per-Sodalitas defaults
 * are added later only if a team needs one.
 */
export interface PublishingPrefs {
  /** Default adapter key — e.g. 'feed' | 'huggingface' | 'r2'. */
  defaultDestination?: string
  /** Default visibility surface — 'private' | 'unlisted' | 'feed' | 'marketplace'. */
  defaultVisibility?: import('./editio.js').EditioVisibility
  /** Default custody — 'ours' | 'theirs' | 'both'. */
  defaultCustody?: import('./editio.js').EditioCustody
  /** Default license tag for the caller's own publications — 'catalog' or a BYO license id. */
  defaultLicense?: string
  /** BYO custody target: the user's own HuggingFace account/namespace. */
  huggingFaceAccount?: string
  /** BYO custody target: the user's own Civitai account/username. */
  civitaiAccount?: string
  /** BYO custody target: the user's wallet address (on-chain custody). */
  wallet?: string
  /** BYO custody target: the user's own bucket. */
  bucket?: string
}

export interface Anima {
  id: string
  /** "nomen" = name in Latin — the user's chosen display name */
  nomen: string

  /**
   * Publishing defaults (visibility/custody/destination + BYO targets).
   * The single source for resolving a publish when the request omits a field.
   */
  publicatio?: PublishingPrefs

  /**
   * Pointer to this soul's memory volume on Materia.
   * Contains: RAG index, conversation history, agent memory chunks.
   * "memoria" = memory in Latin. The ref is a volume path or R2 key.
   */
  memoriaRef?: string

  /**
   * The guardian wallet address — linked via the magic-amount flow.
   * "custos" = guardian/keeper in Latin.
   * Optional: users without a wallet can still use the platform via points.
   */
  custos?: string

  /**
   * Dispute freeze (noema-082, Stripe `charge.dispute.created`, ADR-0013). When true, this soul's
   * user-initiated VALUE-OUTFLOW paths are blocked — generation spend (`CrystalApi.invokeFlow`) and
   * owned-purse minting (`purseRouter` → `mintOwnedPurse`) — while a chargeback is pending review.
   * LOGIN and value-INFLOW (purse reclaim, system transfers) are untouched. Set on a dispute, held
   * pending review; only an operator lifts it (no auto-un-freeze). Optional, defaults to unfrozen —
   * follows the type's `?`-optional-flag convention (like `custos`/`memoriaRef`).
   */
  disputeFrozen?: boolean

  /**
   * GDPR right-to-erasure tombstone (noema-025, Art. 17). When true, this soul has been
   * erased via `DELETE /v1/me`: its identifying PII (`nomen`/`custos`/wallet) has been
   * SEVERED and it can no longer authenticate. The opaque `id` is deliberately RETAINED as
   * a non-identifying anchor so the append-only financial ledger (`Signum`/`deposita`/
   * `reditus`) and the Stripe dispute/refund resolver keep resolving post-erasure. Tombstoning
   * IS the pseudonymization act — the ledger is never mutated. Optional, defaults to
   * un-erased (follows the `?`-optional-flag convention like `custos`/`disputeFrozen`).
   */
  erased?: boolean
  /** When the erasure/tombstone was applied. Set together with `erased`. */
  erasedAt?: Date
  /**
   * Retention horizon = `erasedAt + 7y` (noema-025 operator ruling 2026-08-01). Stamped HERE
   * on the tombstone anchor — NOT on the untouched financial rows. A later purge job MAY remove
   * this tombstone anchor after this instant (that purge is OUT OF SCOPE for noema-025 — this
   * only STAMPS the window).
   */
  retentionUntil?: Date

  /** "natum" = born — when this soul was created */
  natum: Date
  /** "mutatum" = changed — when this soul was last modified */
  mutatum: Date
}

/**
 * AnimaStore — the Anima repository interface.
 * One implementation: MongoAnima. Possibly MemoryAnima for tests.
 */
export interface AnimaStore {
  create(input: Omit<Anima, 'id' | 'natum' | 'mutatum'>): Promise<Anima>
  find(id: string): Promise<Anima | null>
  findByCustos(custos: string): Promise<Anima | null>
  update(id: string, patch: Partial<Pick<Anima, 'nomen' | 'memoriaRef' | 'custos' | 'publicatio' | 'disputeFrozen'>>): Promise<Anima>
}

/**
 * Animae — nominative plural of anima.
 * A group or team — no new primitive needed. Groups are just grammar.
 */
export type Animae = Anima[]

// ---------------------------------------------------------------------------
// Memoria — long-term distilled agent memory
// ---------------------------------------------------------------------------

/**
 * Memoria — the distilled long-term memory of an anima.
 *
 * "Memoria" = memory, recollection (Latin). One document per anima —
 * an ever-updated summary of who the user is, what they gravitate toward,
 * and what preferences the agent has learned over time.
 *
 * Unlike conversation history (Colloquium/Dictum), Memoria is distilled —
 * a compressed, living synthesis, not a raw log.
 */
export interface Memoria {
  id: string
  /** FK → Anima. One Memoria per anima. */
  animaId: string
  /** "summarium" = summary in Latin — distilled description of who this user is */
  summarium: string
  /** "affines" = related/drawn-to things — topics and styles this user gravitates toward */
  affines: string[]
  /** "praeferentia" = preferences in Latin — structured preference map */
  praeferentia: Record<string, unknown>
  /** "natum" = born — when this memoria was first created */
  natum: Date
  /** "mutatum" = changed — when this memoria was last updated */
  mutatum: Date
}

/**
 * MemoriaStore — manages the single Memoria record per anima.
 * upsert() creates on first call and updates on subsequent calls, keyed on animaId.
 */
export interface MemoriaStore {
  /** Create or update the Memoria for an anima. One document per animaId. */
  upsert(input: Omit<Memoria, 'id' | 'natum' | 'mutatum'>): Promise<Memoria>
  findByAnima(animaId: string): Promise<Memoria | null>
}

/**
 * Animarum — genitive plural "of the souls."
 * The parameters that shape how a group's impetus flows and signa are structured.
 *
 * Not a "Team" entity — a group is described by its animae (members) and
 * its animarum (the rules governing their shared behavior).
 */
export interface Animarum {
  id: string
  /** "nomen" = name in Latin — the group's name */
  nomen: string
  /** FK[] → Anima. The members of this group. */
  animae: string[]
  /** FK → Anima. Who created and owns this group. "auctor" = author/creator */
  auctor: string

  /**
   * The parameters that shape this group's collective behavior.
   * "parametri" = parameters in Latin — the governing rules.
   */
  parametri: {
    /** Discount on impetus cost for all group members (0.0–1.0) */
    discountRate?: number
    /** If true, signa are pooled across all group members */
    sharedSigna?: boolean
    /** Maximum impetus the group can spend per day (rate limit) */
    maxImpetusPerDay?: bigint
    /** Restrict which essentiae (by id) group members can cast */
    essentiaAccess?: string[]
  }

  /** "natum" = born — when this group was created */
  natum: Date
}
