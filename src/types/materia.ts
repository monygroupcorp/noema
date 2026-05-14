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
 * GpuClass — the hardware tier a user requests for a generation.
 *
 * 'standard'    — platform-chosen GPU (RTX 4090 class); default for most workflows.
 * 'performance' — high-end datacenter GPU (A100/A40 class); faster, higher cost.
 * 'ultra'       — flagship GPU (H100 class); maximum throughput, highest cost.
 *
 * The actual RunPod GPU ID for each class is resolved at dispatch time
 * based on availability and Modus compatibility requirements.
 */
export type GpuClass = 'standard' | 'performance' | 'ultra'

/**
 * PodPolicy — what happens to a warm pod after a job completes.
 *
 * 'private'  — pod is torn down immediately; no piggybacking allowed.
 * 'economy'  — pod joins the economy pool; idle capacity is offered to
 *              economy-queue jobs. The original user pays only their own
 *              wall-clock time; platform routes economy riders onto the margin.
 * 'link'     — pod is addressable via a shareToken; anyone with the link
 *              can dispatch against it while it remains idle. Host pays
 *              pod time; riders pay execution + a host fee.
 */
export type PodPolicy = 'private' | 'economy' | 'link'

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
   * Docker image this pod was provisioned with — e.g. 'stationthis/flux-comfyui:v1'.
   * Praefectus matches incoming jobs against this: a job can only be routed to a
   * warm pod running the same image (models are baked into the image).
   */
  imageRef?: string

  /** SSH host for direct pod access (RunPod SECURE provides a public IP). */
  sshHost?: string
  /** SSH port (RunPod maps a random public port to the pod's port 22). */
  sshPort?: number

  /**
   * Cost of this pod in impetus points per second.
   * 1 point = $0.000337 = 1 second of RunPod SECURE pod-time.
   * This is what the session host is billed at-cost (no platform markup on compute).
   */
  impetusPerSecond: bigint

  status: MateriaStatus

  /**
   * GPU class this pod was provisioned for.
   * Recorded at provision time so Praefectus can match economy/link riders
   * against the class they requested.
   */
  gpuClass?: GpuClass

  /**
   * Post-job sharing policy for this pod.
   * Set when the pod is provisioned based on the spawning user's preference.
   * Absent: treated as 'standard' (warm pool eligible, no link sharing).
   */
  podPolicy?: PodPolicy

  /**
   * Opaque token for link-share pods.
   * When podPolicy is 'link', this token is included in the share URL.
   * Anyone with the token can dispatch against this pod while it is idle.
   */
  shareToken?: string

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

/**
 * MateriaStore — persistence interface for Materia (GPU pod) records.
 */
export interface MateriaStore {
  create(input: Omit<Materia, 'id'>): Promise<Materia>
  findById(id: string): Promise<Materia | null>
  update(id: string, patch: Partial<Pick<Materia, 'status' | 'sshHost' | 'sshPort' | 'imageRef' | 'terminatum' | 'podPolicy' | 'shareToken'>>): Promise<Materia>
  /**
   * Return the first idle Materia matching the given spec.
   *
   * Standard routing: { imageRef } — any idle pod running that image.
   * Economy routing:  { imageRef, podPolicy: 'economy' } — only economy-pool pods.
   * Link routing:     { shareToken } — the specific pod behind a share link.
   *
   * Returns null when no matching pod is available.
   */
  findWarm(spec: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string }): Promise<Materia | null>
}
