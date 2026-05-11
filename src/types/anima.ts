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
export interface Anima {
  id: string
  /** "nomen" = name in Latin — the user's chosen display name */
  nomen: string

  /**
   * Soul-level tool affinities — default input overrides per modus.
   * "affines" = related/attached things in Latin — what this soul is drawn to.
   * Shape: { [modusId]: { [inputKey]: overrideValue } }
   * Precedence: cast-time input > affines > platform preferences > modus defaults
   */
  affines: Record<string, Record<string, unknown>>

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
  update(id: string, patch: Partial<Pick<Anima, 'nomen' | 'affines' | 'memoriaRef' | 'custos'>>): Promise<Anima>
}

/**
 * Animae — nominative plural of anima.
 * A group or team — no new primitive needed. Groups are just grammar.
 */
export type Animae = Anima[]

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
