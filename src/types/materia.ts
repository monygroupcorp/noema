// =============================================================================
// MATERIA — the raw compute substrate
// =============================================================================
//
// Aristotle's hyle (ὕλη) — the formless matter that receives form (modus)
// to produce a result (actum). Hyle was translated into Latin as "materia"
// by medieval scholars; we use that Latin form here.
//
// Materia is the physical pod: GPU hardware, RAM, the OS environment.
// It is what a Modo (session) is bound to and what an Actum runs on.
//
// For privacy: Materia has no animaId. The pod does not know who is using it —
// only that a session is running. The attestatio (TEE quote) proves the
// environment is what it claims to be, without revealing the user.
// =============================================================================

export type MateriaGenus =
  | 'runpod'    // RunPod SECURE — current primary provider
  | 'vastai'    // Vast.ai — alternative provider
  | 'local'     // local machine — development/testing only

export type MateriaStatus =
  | 'idle'        // provisioned, no session bound
  | 'warming'     // session claimed it, models loading
  | 'active'      // session running, models loaded, accepting actum
  | 'terminated'  // destroyed — volume may persist, pod does not

/**
 * Materia — a single compute pod instance.
 *
 * "materia" = matter/material in Latin (Aristotle's hyle).
 * The substance on which modus imposes form to produce actum.
 */
export interface Materia {
  id: string
  genus: MateriaGenus

  /** The provider's native pod identifier (e.g. RunPod pod ID) */
  externusId: string
  /** GPU model — e.g. 'A100-80GB', 'H100-80GB', 'RTX4090' */
  gpu: string
  /** Video RAM in GB — determines max model size loadable */
  vramGb: number
  /** System RAM in GB */
  ramGb: number

  /**
   * Cost of this pod in impetus points per second.
   * 1 point = $0.000337 = 1 second of RunPod SECURE pod-time.
   * This is what the session host is billed at-cost (no platform markup on compute).
   */
  impetusPerSecond: bigint

  status: MateriaStatus

  /**
   * TEE (Trusted Execution Environment) attestation quote.
   * The enclave signs: image hash + weights hash + config hash +
   * ephemeral WireGuard public key generated inside the enclave.
   * The user verifies this quote against the public menu before sending
   * any prompts. Ensures the environment is exactly what was advertised.
   * Present on H100 confidential compute / AMD SEV-SNP / Intel TDX pods.
   */
  attestatio?: string

  /** "inceptum" = begun in Latin — when this pod was provisioned */
  inceptum?: Date
  /** "terminatum" = terminated — when this pod was destroyed */
  terminatum?: Date
}

/** "Materiae" — nominative plural of materia */
export type Materiae = Materia[]
