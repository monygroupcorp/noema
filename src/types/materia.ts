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
   * Cost of this pod in impetus points per second — a COARSE display/legacy figure
   * (`impetusPerSecondFromHourly` ceils to a whole point/sec). Kept for back-compat
   * and as the warm-billing fallback for pods with no stored `costPerHr`; the
   * accurate charge is computed per-window from `costPerHr` (see below).
   */
  impetusPerSecond: bigint

  /**
   * The pod's real hourly USD cost (from the provider at provision time). The
   * SOURCE OF TRUTH for warm-time billing: `Census` charges
   * `impetusForPodMs(secondsElapsed × 1000, costPerHr)` — rounded once per tick, so
   * the host pays the actual pod cost without the per-second `ceil` skew. Absent on
   * legacy pods → Census falls back to `impetusPerSecond`.
   */
  costPerHr?: number

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

  /**
   * Idle deadline — when an idle pod should be reaped (terminated) if not reused.
   * Stamped to now + warm-TTL each time the pod goes idle after a job. The idle
   * reaper terminates pods past this time. Default TTL is 1 minute past delivery;
   * a user may extend it at commission time.
   */
  warmUntil?: Date

  // ── Hosting metadata (identity-blind half) ─────────────────────────────────
  // Stamped at warm-park. The identity-bearing fields (hostAnimaId, adminAnimaIds)
  // live OUT of Materia by design — see Hospitium — so the pod's own operational
  // record never carries anima identifiers (preserves the "Materia has no animaId"
  // invariant above). The Materia carries only chat context, boot economics, and
  // the user-toggled openToNonAdmins flag.

  /**
   * Platform group identifier when the pod was provisioned in a group chat
   * (e.g. a Telegram chat id). Absent for DM provisioning. Combined with the
   * paired Hospitium.adminAnimaIds to recognize the group's admins at dispatch.
   */
  groupChatId?: string

  /**
   * Whether the group host has opened the pod to non-admins. When true, members of
   * `groupChatId` beyond the Hospitium's admin set may dispatch at guest pricing
   * (base + bootShare). Independent of `podPolicy` (which governs external sharing).
   */
  openToNonAdmins?: boolean

  /**
   * The cold-start cost the host paid, denominated in impetus points (= seconds of
   * pod-time at the documented rate). Stamped once at warm-park from
   * `billedMs × costPerHr` of the provisioning actum. Drives the guest
   * boot-amortization surcharge: `bootShare = ceil(bootCostImpetus / BOOT_AMORTIZE_OVER)`.
   */
  bootCostImpetus?: bigint

  /**
   * Running tally of `bootShare` credited back to the host across guest runs. Once
   * `bootRecovered >= bootCostImpetus`, the surcharge stops (host has been made
   * whole on the boot). Absent ≡ 0.
   */
  bootRecovered?: bigint

  /**
   * Drain-mode flag set when the host's balance can no longer cover continuous
   * studio billing. While true, new guest gens are refused at admission; any
   * in-flight gens are allowed to finish; the idle reaper terminates the studio
   * when the queue drains. Default = false / absent.
   */
  drainOnly?: boolean

  /**
   * Hard drain deadline — the instant a draining pod is reaped whatever its status.
   * Stamped alongside `drainOnly`, and never extended.
   *
   * "It drains, then the reaper takes it once it goes idle" holds only while
   * something still moves the pod back to idle. A pod whose release path never ran
   * — the process died mid-job, the runner went away, the completion webhook was
   * lost — stays `active` forever, and `active` is billable: it accrues host cost on
   * every Census tick and burns real provider spend, with no status the idle arm of
   * the reaper can ever match. This deadline is what makes the drain terminal. Past
   * it the reaper takes the pod from `active` too; a genuinely in-flight gen has the
   * whole grace window to finish first.
   */
  drainUntil?: Date

  // ── Inventory (Phase D wrap-up) ────────────────────────────────────────────
  // What's actually downloaded onto this studio's persistent volume. Maintained
  // by the completion webhook from `ActumExecutio.modelsInstalled` reports, then
  // surfaced in the bulletin's `Mod • → View loadout` and on `/status` studio rows.
  // No identity flows through here — these are content identifiers (intellaIds).

  /** intellaIds present on the studio's volume. Set-union semantics on merge. */
  installedModels?: string[]
  /** The on-pod runtime this studio serves ('ComfyUI' | 'llama.cpp' | …). Stamped at provision; a
   *  warm pod is only reusable by gens of the same runtime. RESERVED: recorded now, consumed by the
   *  runner dispatch in a GPU sprint. */
  runtime?: string
  /** Sum of intella sizes currently on disk (GB), for bulletin "X% used" displays. */
  volumeUsedGb?: number
  /** Disk ceiling for this pod type. Stamped at provision; informs eviction policy later. */
  volumeCapGb?: number
}

/** "Materiae" — nominative plural of materia */
export type Materiae = Materia[]

/**
 * MateriaStore — persistence interface for Materia (GPU pod) records.
 */
export interface MateriaStore {
  create(input: Omit<Materia, 'id'>): Promise<Materia>
  findById(id: string): Promise<Materia | null>
  update(id: string, patch: Partial<Pick<Materia,
    | 'status' | 'sshHost' | 'sshPort' | 'imageRef' | 'terminatum'
    | 'podPolicy' | 'shareToken' | 'warmUntil'
    | 'groupChatId' | 'openToNonAdmins'
    | 'bootCostImpetus' | 'bootRecovered'
    | 'drainOnly' | 'drainUntil'
    | 'installedModels' | 'volumeUsedGb' | 'volumeCapGb'
  >>): Promise<Materia>
  /**
   * Atomically claim an idle Materia matching the given spec, transitioning it
   * to 'active' in a single findOneAndUpdate. Prevents two concurrent requests
   * from both winning the same warm pod.
   *
   * Standard routing: { imageRef } — any idle pod running that image.
   * Economy routing:  { imageRef, podPolicy: 'economy' } — only economy-pool pods.
   * Link routing:     { shareToken } — the specific pod behind a share link.
   * Studio routing:   { materiaId } — claim THIS exact pod (a studio's bound pod).
   *
   * Returns null when no matching pod is available.
   */
  findWarm(spec: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string; materiaId?: string }): Promise<Materia | null>
  /** Return all Materiae that are not terminated — used for graceful shutdown teardown. */
  findActive(): Promise<Materia[]>
  /**
   * Atomically reap pods that should no longer be billing: an idle pod past its
   * `warmUntil` deadline or already draining, and a draining pod of ANY status past
   * its `drainUntil` hard deadline (the stranded-`active` case — see `drainUntil`).
   * Transitions each to 'terminated' (one findOneAndUpdate per pod, so a concurrent
   * claim via findWarm can't lose) and returns them so the caller can destroy the pods.
   */
  reapIdle(now: Date): Promise<Materia[]>
}
