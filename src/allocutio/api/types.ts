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
