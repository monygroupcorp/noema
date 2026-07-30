// =============================================================================
// COLLOQUIUM — the conversation thread
// =============================================================================
//
// "Colloquium" = a conversation, conference, dialogue (Latin, from colloqui:
// to speak together, from com- + loqui). In Roman usage, a colloquium was a
// formal or informal gathering of speech — a dialogue between parties.
//
// A Colloquium is the persistent thread that holds together a sequence of turns
// (Dicta). Unlike a Modo (session), which is bound to execution rails and
// compute context, a Colloquium is purely communicative — it records what was
// said between a user and the agent, independent of how execution happened.
//
// One Colloquium, many Dicta — the thread beneath the turns.
//
// DECLENSION:
//   colloquium  — the thread (nominative singular)
//   colloquia   — the threads / the store (nominative plural) → ColloquiumStore
//   dicta       — the said things / the turns (nominative plural, from dicere)
//   dictum      — one thing said / one turn (nominative singular)
//
// PRIVACY: A Colloquium is owned by an opaque `ownerKey` (see `src/crystal/ownerKey.ts`),
// derived from whichever identity the caller presented — an identified anima, or an anon
// commitment/bursaToken. This mirrors the rest of the anon-capable stores (Secretarium,
// Intella): ownership is structural, not identity-kind-specific, so anon callers can hold
// conversation threads too.
// =============================================================================

/**
 * Colloquium — a conversation thread.
 *
 * Binds a sequence of Dicta (turns) to an owner over time.
 * Optionally associated with a canvas workspace (tabulaId) or session (modoId).
 */
export interface Colloquium {
  id: string
  /** Opaque owner id (`ownerKeyOf(AuctorKey)`) — the owner of this conversation. */
  ownerKey: string
  /** "active" = ongoing; "archived" = concluded, kept for memory */
  status: 'active' | 'archived'
  /** FK → Tabula. Optional canvas workspace this conversation is bound to. */
  tabulaId?: string
  /** FK → Modo. Optional session this conversation runs within. */
  modoId?: string
  /** "titulus" = title in Latin — optional user-given display name for this thread */
  titulus?: string
  /** "natum" = born — when this thread was created */
  natum: Date
  /** "mutatum" = changed — when this thread was last modified */
  mutatum: Date
}

/**
 * Dictum — one turn in a conversation.
 *
 * "Dictum" = something said, a saying (Latin, from dicere: to say).
 * A single utterance or response within a Colloquium. Immutable once created —
 * conversation history must not be rewritten.
 */
export interface Dictum {
  id: string
  /** FK → Colloquium. Which thread this turn belongs to. */
  colloquiumId: string
  /**
   * "genus" = kind/type in Latin — who spoke this turn.
   *   'user'    — the human anima
   *   'agent'   — the platform AI
   *   'systema' — system-injected context (hidden prompt, tool result, etc.)
   */
  genus: 'user' | 'agent' | 'systema'
  /** "corpus" = body in Latin — the text content of this turn */
  corpus: string
  /** FK → Actum. If this turn spawned an execution, the resulting actum. */
  actumId?: string
  /** FK[] → Signum. Credit events tied to this turn (e.g. tokens consumed). */
  signaIds: string[]
  /**
   * Caller-supplied idempotency key for the turn that produced this Dictum (noema-095).
   * A concierge dicta POST carries a client-chosen `turnKey`; both the user and the agent
   * Dictum of that turn are stamped with it, so a retried POST with the SAME key is a no-op
   * (the persisted agent Dictum is returned instead of re-running the agent or re-charging).
   * Mirrors the R5 Stripe-event-id idempotency discipline. Absent on turns created before
   * the concierge endpoint (and on any non-concierge Dictum). Immutable once set.
   */
  turnKey?: string
  /** "natum" = born — when this turn was recorded */
  natum: Date
}

// ---------------------------------------------------------------------------
// ColloquiumStore — the Colloquium repository interface
// ---------------------------------------------------------------------------

/**
 * ColloquiumStore — manages Colloquium records.
 * "colloquia" = nominative plural, the store of conversation threads.
 */
export interface ColloquiumStore {
  create(input: Omit<Colloquium, 'id' | 'natum' | 'mutatum'>): Promise<Colloquium>
  find(id: string): Promise<Colloquium | null>
  /**
   * Return all colloquia owned by the given owner key.
   * Optionally filter by status.
   */
  findByOwner(ownerKey: string, status?: 'active' | 'archived'): Promise<Colloquium[]>
  update(id: string, patch: Partial<Pick<Colloquium, 'status' | 'modoId' | 'titulus'>>): Promise<Colloquium>
  /** Convenience: sets status to 'archived'. */
  archive(id: string): Promise<Colloquium>
}

// ---------------------------------------------------------------------------
// DictumStore — the Dictum repository interface
// ---------------------------------------------------------------------------

/**
 * DictumStore — manages Dictum records.
 * "dicta" = nominative plural "the things said", the store of turns.
 */
export interface DictumStore {
  create(input: Omit<Dictum, 'id' | 'natum'>): Promise<Dictum>
  findById(id: string): Promise<Dictum | null>
  /** Return all turns in a colloquium, ordered by natum ascending. */
  listByColloquium(colloquiumId: string): Promise<Dictum[]>
  /**
   * Return the Dicta of one colloquium stamped with a given caller-supplied `turnKey`,
   * ordered by natum ascending (noema-095 per-turn idempotency). A completed concierge
   * turn yields a user + an agent Dictum sharing the key; the endpoint keys idempotent
   * replay on the AGENT Dictum's presence (the turn settled only once its agent Dictum
   * was persisted). Empty when no turn has used the key in this colloquium.
   */
  findByTurnKey(colloquiumId: string, turnKey: string): Promise<Dictum[]>
  update(id: string, patch: Partial<Pick<Dictum, 'actumId' | 'signaIds'>>): Promise<Dictum>
}
