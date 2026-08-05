// =============================================================================
// DEPLOYMENTUM — content-addressed compiled execution bundle
// =============================================================================
//
// "deploymentum" is the neuter singular gerundive of "deploro" adapted for
// deployment — "that which is to be deployed." A Deploymentum is the exact,
// versioned bundle that was or will be shipped to a GPU pod: image + models
// + workflow + generation flags, hashed to a SHA-256 content address.
//
// The hash is the canonical identity:
//   - Same hash → same pod requirements → warm-pool affinity
//   - Hash stored on Actum → forensic provenance (which exact bundle ran)
//   - Hash as R2 cache key → baked image promotion in Phase 6 (recipes)
//
// Deploymentum is write-once by hash (upsert is idempotent). A second compile
// of the same Essentia + aditus with the same seed produces the same hash and
// does not create a new record.
// =============================================================================

/**
 * Deploymentum — one content-addressed compiled execution bundle.
 *
 * `hash` is the SHA-256 of the canonical sorted CompiledSpec JSON, prefixed
 * "sha256:". Serves as the primary key.
 */
export interface Deploymentum {
  /** Content address — "sha256:<hex>". Primary key. */
  hash: string
  /**
   * The full compiled spec as a JSON-serializable record.
   * Stores image, models, workflow, genFlags, seed, sourceTool.
   */
  spec: Record<string, unknown>
  /** When this deployment was first stored. */
  natum: Date
}

/**
 * DeploymentumStore — persistence interface for compiled deployment records.
 */
export interface DeploymentumStore {
  /** Idempotent — safe to call multiple times for the same hash. */
  upsert(deploymentum: Deploymentum): Promise<void>
  /** Returns null if this hash has never been compiled before. */
  find(hash: string): Promise<Deploymentum | null>
}
