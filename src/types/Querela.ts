// =============================================================================
// QUERELA — a user-submitted report (bug / feature / feedback)
// =============================================================================
//
// "Querela" = a complaint, a grievance (Latin, from queri: to complain). A
// Querela is the in-app report a user files when they hit a bug, want a
// feature, or just have something to say. Kind-discriminated: `bug` reports
// carry rich captured state (route, run/actum id, device, client error);
// `feature` reports carry the requested feature/route; `feedback` reports
// carry a free-text message. All three share one store, keyed on the opaque
// `ownerKey` (see `src/crystal/ownerKey.ts`) so anon reporters (a commitment
// or a bursaToken purse) can file reports too, not just identified animae.
//
// PRIVATE STORE — v1 ships no GitHub egress and no sanitizer; nothing here
// leaves the database. That is a decision, not a gap awaiting an integration.
// =============================================================================

/** Captured client state for a `bug` report — best-effort, all optional. */
export interface QuerelaCapturedState {
  /** The client route/screen the user was on when they filed the report. */
  route?: string
  /** The run this report is about, if the user was mid-generation. */
  runId?: string
  /** The actum this report is about, if the user was mid-generation. */
  actumId?: string
}

/**
 * Querela — a user-submitted report.
 *
 * "querelae" = nominative plural, the store of reports → QuerelaStore.
 */
export interface Querela {
  id: string
  /** Opaque owner id (`ownerKeyOf(AuctorKey)`) — the reporter. Anon-capable. */
  ownerKey: string
  /** What kind of report this is — shape flexes by kind (see field docs below). */
  kind: 'bug' | 'feature' | 'feedback'
  /** "new" = unreviewed; mirrors colloquium's status-field shape (a closed string union
   *  tracked via `update()` + `mutatum`). "closed" = reviewed/resolved/dismissed. */
  status: 'new' | 'closed'
  /** Free-text description of the report. Required for all kinds. */
  description: string
  /** The feature/route being requested or described. Used by `kind: 'feature'`. */
  feature?: string | null
  /** Route/run/actum captured at report time. Used by `kind: 'bug'`. */
  capturedState?: QuerelaCapturedState | null
  /** Best-effort client error surfaced by the ErrorBoundary. Nullable placeholder —
   *  the frontend wiring to populate this ships in a later item (noema-101). */
  clientError?: string | null
  /** Reporting device, e.g. `navigator.userAgent`. Captured for `bug`, useful generally. */
  device?: string | null
  userAgent?: string | null
  /** Hash of `ownerKey + kind + description + (feature ?? route)` — dedup key so N
   *  identical reports from the same owner are not persisted as separate records. */
  contentHash: string
  /** "natum" = born — when this report was filed. */
  natum: Date
  /** "mutatum" = changed — when this report was last modified. */
  mutatum: Date
}

// ---------------------------------------------------------------------------
// QuerelaStore — the Querela repository interface
// ---------------------------------------------------------------------------

/**
 * QuerelaStore — manages Querela records.
 * "querelae" = nominative plural, the store of reports.
 */
export interface QuerelaStore {
  create(input: Omit<Querela, 'id' | 'natum' | 'mutatum'>): Promise<Querela>
  find(id: string): Promise<Querela | null>
  /** Return all reports owned by the given owner key. Optionally filter by status. */
  findByOwner(ownerKey: string, status?: 'new' | 'closed'): Promise<Querela[]>
  update(id: string, patch: Partial<Pick<Querela, 'status'>>): Promise<Querela>
  /** Dedup lookup — an identical (ownerKey, contentHash) pair means "already reported". */
  findByOwnerAndHash(ownerKey: string, contentHash: string): Promise<Querela | null>
  /** ADMIN: every report across ALL owners, optionally narrowed by kind and/or status.
   *  Newest first. The read half of the admin triage surface — `findByOwner` stays
   *  scoped to one owner and does not serve this. */
  list(filter?: { kind?: Querela['kind']; status?: Querela['status'] }): Promise<Querela[]>
}
