// =============================================================================
// FUNDAMENTUM — the provider-neutral compute substrate a flow runs on
// =============================================================================
//
// "fundamentum" = foundation, groundwork (Latin, 2nd decl. neuter; pl. fundamenta,
// gen. pl. fundamentorum). The THIRD layer of pod provisioning, made first-class:
//
//   the flow            — recipe (ports, template)         → Modus / Essentia
//   the substrate SPEC  — image + runtime + base weights   → Fundamentum  ← here
//   the substrate INST. — the live pod                     → Materia
//
// Before ADR-0005 the spec was mis-encoded as `Essentia.runpodSpec`: provider-named
// (a flow definition must NOT name "runpod" — that belongs on the Cursor / Materia.genus)
// and scope-conflated (it mixed the shareable environment with flow-specific form).
// `Fundamentum` is the environment half, extracted and de-provider-ized; the form half
// (workflowTemplate, seedInputKey, genFlags) stays on the Essentia.
//
// An Essentia REFERENCES a Fundamentum, version-pinned (`fundamentumId` +
// `fundamentumVersio`) — the same id+version discipline it uses for workflowTemplate.
// So a FAMILY of essentiae (flux-schnell, flux-dev, …) share one fundament:
//   - co-host key = fundamentum id equality (O(1), not a structural deep-compare)
//   - single-source edits (bump the fundament once; roll flows forward deliberately)
//   - Modus.contentHash stays meaningful ("flow-logic X on flux-comfyui@v3")
//   - the TEE attestatio signs a named, hashed substrate
//   - HOW to instantiate it (RunPod vs Vast.ai) lives in the Cursor — zero flow changes.
//
// The LoRA-compat FAMILY of a fundament (and thus the flows on it) is DERIVED from its
// base weights' `Intella.familia` — never declared here. Single source, zero drift.
// =============================================================================

import type { AuctorKey } from '../flow/types.js'

/**
 * Fundamentum — a compute-substrate specification. Provider-NEUTRAL: it says WHAT
 * environment (image + runtime + base/support weights + capacity), never WHICH provider.
 */
export interface Fundamentum {
  id: string
  /** "nomen" = name in Latin — display label (e.g. "FLUX · ComfyUI"). */
  nomen?: string
  /** Semantic version string e.g. "1.0.0". Flows pin a version (see Essentia.fundamentumVersio). */
  versio: string
  /** Content-addressed hash of the substrate definition. Locks it; the TEE attestation signs it. */
  contentHash?: string

  /** Docker image — provider-neutral OCI coordinates. e.g. imageId 'runpod/pytorch'. */
  imageId: string
  imageVersion: string

  /**
   * Pinned upstream ComfyUI ref (tag or branch) for `runtime: 'ComfyUI'` substrates — e.g.
   * "v0.26.0". Bootstrap clones this ref (`git clone --depth 1 --branch <comfyRef>`), never
   * unpinned HEAD (2026-07-10 P0: an ambient HEAD clone drifted torch-incompatible and broke
   * every ComfyUI pod). SecurePodClient falls back to a single default constant when absent.
   */
  comfyRef?: string

  /**
   * The on-pod runtime this substrate serves — 'ComfyUI' (default) | 'llama.cpp' | 'vLLM' | ….
   * Canonical home for `runtime` (ADR-0001 single-source); Materia stamps a copy at provision.
   */
  runtime?: string

  /**
   * The base/support WEIGHT manifest this substrate provisions — the shared `Intellae` a whole
   * family of flows sits on (flux = unet + vae + 2×clip; sd1.5 = the self-contained checkpoint).
   * Each entry is an `{ id, role }` ref (FK → Intella). LoRAs are NOT here — they are added per-run.
   * The fundament's (and its flows') FAMILY derives from these weights' `Intella.familia`.
   */
  intellae?: Array<{ id: string; role: string }>

  /**
   * The familiae whose LoRAs this substrate's flows will CONSUME — the compat axis, declared.
   *
   * `Intella.familia` says what a model IS; `acceptsFamiliae` says what a flow will TAKE. They are
   * separate fields because acceptance is DIRECTED: a substrate can accept LoRAs trained for a
   * neighbouring family without that family accepting its own in return, and one symmetric string
   * compared by equality cannot express a directed relation.
   *
   * Absent → `[the fundament's own derived familia]`, i.e. the existing behaviour. When present,
   * the fundament's own derived familia is ALWAYS implicitly included on top of the declaration,
   * so a declaration can only ADD acceptance and can never exclude a flow's native LoRAs.
   */
  acceptsFamiliae?: string[]

  /** Minimum VRAM in GB the substrate needs — drives GPU/pod selection (capacity hint). */
  vramGb?: number

  /**
   * Bootstrap commands run once before launch on bare-metal or non-image paths.
   * In production (Docker) this is empty — the image already has everything.
   * In local dev, this is what you would type into a blank terminal to prepare
   * the environment: pip installs, git clones, etc.
   * e.g. ["pip install vllm==0.9.0", "pip install flash-attn --no-build-isolation"]
   */
  install?: string[]

  /**
   * The command that starts the inference server. Variables filled from the
   * Essentia at runtime — the runner does string interpolation, nothing else.
   * Available vars: {model} (intellae[0].id resolved), {port}, {vramGb}
   * e.g. "python -m vllm.entrypoints.openai.api_server --model {model} --port {port}"
   * e.g. "llama-server --model {model} -ngl -1 --port {port}"
   * e.g. "python /opt/ComfyUI/main.py --listen 0.0.0.0 --port {port}"
   * Required for pod-hosted fundamenta. Absent for API-hosted (OpenAI, Replicate).
   */
  launchTemplate?: string

  /**
   * How the runner knows the server is ready to accept requests.
   * Polled after launch until it returns 200 (HTTP) or exits 0 (shell command).
   * e.g. "GET http://localhost:{port}/health"
   * e.g. "GET http://localhost:{port}/v1/models"
   * Absent: runner waits a fixed delay (fallback, not recommended).
   */
  readyProbe?: string

  /**
   * How long this substrate may take to come up before the runner is declared stuck, in ms
   * (noema-392). Absent → the platform default (5 min).
   *
   * A DECLARATION, not a derivation: unlike pod disk (`podDiskGbFor`, arithmetic over the weight
   * manifest) there is no quantity to compute this from. What has to happen inside the window is
   * a fact about the substrate — comfyrunner starts ComfyUI, which imports the substrate's custom
   * node packs and initialises their backends. MiniMax H3 enumerates `comfy-kitchen`'s CUDA
   * backends and loads `comfy-aimdo`; a flux pod does neither.
   *
   * Resist raising the platform default instead. A flux pod that has not answered in five minutes
   * is genuinely stuck, and a larger global budget makes every such failure slower without making
   * a single one rarer.
   */
  readyTimeoutMs?: number

  /**
   * How long ONE queued job may run on this substrate before the pod aborts it, in ms
   * (noema-392). Absent → the pod-side default (900 s).
   *
   * Separate from `readyTimeoutMs` because it bounds a disjoint phase with different economics:
   * readiness is bounded by an import graph and has a pod retry behind it, while the job window
   * is bounded by model load + sampling and has NOTHING behind it — it fires at the very end,
   * after provisioning and the whole weight pull have already been paid for.
   *
   * On an offloading substrate this is dominated by model load, not by the sample: MiniMax H3
   * pushes 48 GB of weights through a 24 GB card before the first node runs, so a 4-step turbo
   * sample sits behind ~700 s of loading. Size it from a measured job, with a multiple for
   * pod-to-pod load variance — not from the sample step count.
   */
  jobTimeoutMs?: number

  /** True = platform-canonical fundament. False = a user-authored one (the /arm custom path). */
  canonica: boolean
  /** "auctor" = author/creator — owner of a user-authored fundament. Canonical ones leave it undefined. */
  auctor?: AuctorKey

  /** "natum" = born — when this fundament was first registered. */
  natum: Date
  /** "mutatum" = changed — when this fundament was last modified. */
  mutatum: Date
}

/** "Fundamenta" — nominative plural of fundamentum. */
export type Fundamenta = Fundamentum[]

/**
 * Fundamentorum — genitive plural "of the foundations." The registry that owns, stores,
 * and resolves all substrate specs. Mirrors Modorum's shape (find/register/list).
 */
export interface Fundamentorum {
  /** Resolve a fundament by id (and optional pinned versio). */
  find(id: string, versio?: string): Promise<Fundamentum | null>
  /** Persist (upsert) a fundament. */
  register(fundamentum: Fundamentum): Promise<void>
  /** List fundamenta, optionally filtered by canonical/owner. */
  list(filter?: Partial<Pick<Fundamentum, 'canonica' | 'auctor'>>): Promise<Fundamenta>
}
