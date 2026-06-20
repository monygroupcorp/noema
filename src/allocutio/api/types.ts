// =============================================================================
// API projection types — the public, serialization-safe shapes
// =============================================================================
//
// The internal crystal types (Actum, Modus, …) carry bigint impetus, Date
// timestamps, and Latin field names that external HTTP clients should not see.
// These projection types are the public face: JSON-safe, English-named,
// stable. Pure data — no behaviour lives here.
// =============================================================================

/** Public run status — the externalised projection of ActumStatus. */
export type RunStatus = 'pending' | 'running' | 'complete' | 'failed'

/**
 * Run — the public projection of an Actum for the HTTP API.
 *
 * JSON-safe: `cost` is a string (impetus is a bigint internally) and
 * `createdAt` is an ISO-8601 string (inceptum is a Date internally).
 */
export interface Run {
  id: string
  status: RunStatus
  modusId: string
  /** The outputs produced by the run — present only when available. */
  exitus?: Record<string, unknown>
  /** Populated only when the run failed. */
  failure?: { code: string; message: string }
  /** impetus cost, serialised as a string (bigint → string). */
  cost?: string
  /** When the run started, as an ISO-8601 string. */
  createdAt?: string
}

/** Public collection status — the externalised projection of CollectioStatus. */
export type CollectionStatus = 'pending' | 'running' | 'complete' | 'cancelled'

/**
 * Team — the public projection of a Sodalitas (a fellowship of Animae that
 * co-owns work). JSON-safe; `createdAt` is ISO-8601.
 */
export interface Team {
  id: string
  nomen: string
  /** Member Anima ids (includes the founder). */
  members: string[]
  /** The founder's Anima id. */
  founder: string
  createdAt: string
}

/**
 * Collection — the public projection of a Collectio (a generated collection /
 * batch) for the HTTP API. The internal Collectio is keyed by `numerus` /
 * `completae` / `fractae` and a Latin status; this is the JSON-safe English face.
 */
export interface Collection {
  id: string
  nomen?: string
  status: CollectionStatus
  modusId: string
  /** Target piece count (the size of the run). */
  total: number
  /** Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash. */
  provenanceHash: string
  /** Per-artifact ownership split (team-owned collections only) — animaId → weight (sum 1). */
  owners?: Array<{ animaId: string; weight: number }>
  /** Pieces completed so far (approved, when review is on). */
  completed: number
  /** Pieces that failed to generate so far. */
  failed: number
  /** Pieces a reviewer rejected so far (distinct from failed). */
  rejected: number
  /** Total impetus across completed pieces, serialised as a string. */
  cost?: string
  /** When the collection started, ISO-8601. */
  createdAt?: string
  /** When it finished (or was cancelled), ISO-8601. */
  completedAt?: string
}
