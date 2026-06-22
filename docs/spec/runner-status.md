# Runner status (Nuntius) — spec

**Status:** DRAFT 2026-06-22. Proposes a crystal-owned, runner-agnostic status model so every
base-image runner (ComfyUI, TEE, training, hosting, downloading) reports progress in **one shape** that
all consumers (SSE, Telegram, bulletin, frontend, analytics) read. Not built. Build against this once
finalized.

> **Name: `Nuntius`** (FINALIZED 2026-06-22 — Latin *nuntius*: a dispatch, a report, a messenger). NOT
> `Gradus` (that already names a compositus spell's ordered steps, `Modus.gradus`).

**Decisions locked (2026-06-22):** name = `Nuntius`; **one channel** (status subsumes heartbeat, §4); **the
full timeline is persisted on the Actum** — every phase transition + key event, so states are queryable and
each step's duration is measurable (§7); the phase taxonomy is **as specific as the distinct measurable costs
demand** — pulling the fundamentum, downloading models, and loading into VRAM are SEPARATE phases (§3b).

## 1. What it is — and why we own it

> **A `Nuntius` = (a canonical phase) × (optional progress / resources / parallel sub-reports) at a moment.**
> Every runner emits a stream of them; the latest is persisted, the stream is projected to consumers.

Today our rich status comes **from ComfyUI** — `comfyrunnerClient` parses ComfyUI's ~15 SSE event types and
translates them into ad-hoc strings. We have been *blessed* by ComfyUI's richness and have not had to own a
status model. That blessing is also a dependency and a ceiling:

- it is **ComfyUI-shaped** — we inherit its vocabulary instead of defining our own;
- it is **stringly-typed** (`stage: string`, e.g. `downloading:2/5`) — no taxonomy, no type-safety, ad-hoc parse;
- it is **ephemeral** — the rich signal lives only on the bus → SSE/Telegram; nothing persists "current detailed status";
- every **non-ComfyUI runner reinvents it** — the TEE runner's `/runner/status` is a stub (`{sessionId, step}` → log + ok); training is legacy VastAI logs off to the side.

We should **own our status**: a canonical model the *fundamentum* (ComfyUI, the TEE enclave, the trainer)
maps *into*, not one we inherit from whichever runtime happens to be richest. Then the base images interface
smoothly with every consumer, and a new runner is "emit Nuntius," not "invent a status protocol."

## 2. Current state (what exists, grounded)

| Layer | Today | File |
|---|---|---|
| Persisted status (coarse) | `ActumStatus = nascens \| agens \| completus \| fractus` (4 states) | `src/types/actum.ts` |
| Post-hoc telemetry | `ActumExecutio` (provisionMs, sshReadyMs, downloadMs, modelsDownloaded/Reused, downloadBytes, executionMs, gpuType, podId, coldStart…) — written *as the job runs*, read back at the webhook | `src/types/actum.ts` |
| Live status (rich, ephemeral) | bus `actum.stage { actumId, stage: string, elapsedMs, info?: StageInfo }`; `StageInfo` = {gpuType, region, costPerHr, etaMs, podId, phaseMs, reason} | `src/lib/bus.ts` |
| Rich source | ComfyUI SSE → `comfyrunnerClient` parses `preflight-models, downloading, downloaded, models-ready, download-progress, workflow-submitted, waiting, installing-node, restarting-comfy, node, progress, uploading, complete, error` → re-emits as `actum.stage` + `emitStage()` | `src/crystal/comfyrunnerClient.ts` |
| Runner protocol | `/runner/ready`, `/runner/heartbeat`, `/runner/ended` (runner.py lifecycle), `/runner/status` (**TEE stub** — logs only) | `src/index.ts`, `CrystalApi.handleRunner*` |
| Consumers | `RunEventHub` (per-run SSE), Telegram `StatusView`/bulletin, the wide analytics event | `src/allocutio/lexicon/status/`, `src/lib/wide.ts` |

**Key insight to exploit:** the live `actum.stage` and the post-hoc `ActumExecutio` are *two encodings of the
same thing*. `ActumExecutio.downloadMs` is just **the duration of the `downloading` phase**. The canonical
phase model below **unifies them**: telemetry becomes the recorded dwell-time of each phase, derived for free
from the Nuntius stream — one model, not two.

## 3. The crystal core

### 3a. `Nuntius` — one structured status report
```
Nuntius {
  phase:      Phasis                    // the canonical, OWNED phase (3b)
  target?:    string                    // WHAT this phase acts on, for within-phase specificity:
                                        //   'fundamentum' | 'model' | 'lora' | 'dataset' | 'input' | 'vram' | 'output' | …
  progress?:  { done, total, unit }     // unit: 'items' | 'bytes' | 'steps' | 'pct'
  etaMs?:     number                    // estimated time remaining in this phase
  message?:   string                    // human detail ("loading flux1-schnell into VRAM")
  resources?: { vramUsedMb?, vramTotalMb?, gpuUtilPct?, diskUsedMb? }   // VRAM & friends; extensible
  parallel?:  Nuntius[]                 // sub-reports for concurrent work (3d)
  at:         Date
}
```
`phase` is the coarse step (for the timeline + measurement); `target` is the within-phase specificity (so a
`downloading` of a `model` is queryable apart from a `downloading` of a `dataset`, without exploding the phase
set). A runner emits a *stream* of `Nuntius`; the **whole stream is persisted** on the Actum (§7) — not just
the latest — so we can replay states and measure each step. The live stream also flows via the bus to consumers.

### 3b. `Phasis` — the canonical phase taxonomy (the OWNED vocabulary)
Runner-agnostic. Every runner maps its native events into exactly these. **Specific where the cost differs** —
the three faces of "loading" are split, because pulling a multi-GB image, downloading weights, and copying
weights into VRAM are independently slow and we want to measure each. Ordered roughly by lifecycle:
```
Phasis =
  | 'queued'        // accepted, awaiting a slot (warm-pool queue, scheduler)
  | 'provisioning'  // acquiring compute — pod/instance create (cold start)
  | 'pulling'       // fetching the RUNTIME / base image (the fundamentum) onto the host  ← "downloading fundamentum"
  | 'attesting'     // TEE attestation + secure-tunnel handshake (TEE only)
  | 'downloading'   // fetching ARTIFACTS — models / loras / datasets / media inputs (target says which)  ← "downloading models"
  | 'installing'    // installing custom nodes / deps
  | 'loading'       // copying weights into VRAM (target:'vram') — the GPU load, NOT a download  ← "loading into VRAM"
  | 'warming'       // post-load readiness (CUDA graphs, first-token warmup, sampler warmup)
  | 'executing'     // the actual work (inference steps, training steps, token stream)
  | 'uploading'     // pushing outputs out (R2, HF)
  | 'finalizing'    // settle / cleanup
  | 'cancelling'    // an in-flight cancel was requested
  | 'done'
  | 'failed'
```
These are **owned**: a richer native event never adds a `Phasis` — it maps to an existing phase, with
`target` for what it acts on and `message`/`progress` for the native detail. A new runner that needs a
genuinely new phase is a deliberate spec change (keeps the vocabulary small, shared, and measurable). The
`target` axis (§3a) absorbs the long tail of specificity (model vs lora vs dataset within `downloading`)
without multiplying phases.

### 3c. Progress is one shape across very different work
- ComfyUI model download → `{ done: 2, total: 5, unit: 'items' }` (+ a nested bytes sub-report, 3d)
- A single weight download → `{ done, total, unit: 'bytes' }`
- ComfyUI sampler → `{ done: 12, total: 20, unit: 'steps' }`
- **Training** → `{ done: epoch*stepsPerEpoch + step, total: totalSteps, unit: 'steps' }`
- TEE token stream → `{ done: tokens, total?, unit: 'items' }`

### 3d. Parallelism is first-class (`parallel: Nuntius[]`)
Concurrent work nests instead of flattening to a string. Examples:
- multi-model download: a `downloading` Nuntius whose `parallel[]` is one sub-Nuntius per file (each with its own bytes progress);
- a Collectio fan-out: an `executing` Nuntius whose `parallel[]` is one sub-report per in-flight actum;
- parallel training shards / multi-GPU.
Consumers can render the rollup (parent phase + aggregate %) or drill into the sub-reports.

## 4. The protocol — ONE channel (decided)

`POST /runner/status` is the **single** runner→platform channel. It carries the Nuntius **and** doubles as the
heartbeat — no separate status vs heartbeat split. Body + response:
```
→  { actumId? | sessionId? ,  nuntius: Nuntius }
←  { continue: boolean }          // the keep-alive / cancel signal (today's heartbeat return)
```
Every base image speaks exactly this one call: the persistent runner.py job server, comfyrunner, the TEE
enclave runner, the trainer. The platform handler (`CrystalApi.reportNuntius`):
1. **appends** the Nuntius to the Actum's persisted timeline + updates the latest (§7);
2. **emits** it to the bus (a typed `actum.nuntius` event — supersedes the stringly `actum.stage`);
3. lets the **projection** (§5) fan it out;
4. returns `{ continue }` — so the same call that reports progress also tells a runner to keep going or bail
   (subsumes `/runner/heartbeat`).

The discrete lifecycle markers fold into phases: today's `/runner/ready` ≈ a `loading`/`warming`→`executing`
Nuntius, `/runner/ended` ≈ a `done`/`failed` Nuntius. The base-image contract collapses to **"emit Nuntius,
read `continue`."** (The legacy `/runner/ready|heartbeat|ended` endpoints stay during migration, then retire.)

## 5. Projection — one mapper to every consumer

A single `NuntiusProjector` maps a Nuntius to each consumer shape, replacing the scattered stringly
translation:
- **SSE** (`RunEventHub`) — stream the Nuntius (typed) to the per-run client;
- **Telegram `StatusView`/bulletin** — a label + bar derived from `phase` + `progress` (kills the per-stage string parsing);
- **Frontend** — the same typed Nuntius (the new app renders phase/% directly);
- **Analytics / `ActumExecutio`** — accumulate phase dwell-times → the existing telemetry fields are *derived*, not separately reported (§2 insight).

Backward-compat during migration: the projector can still emit the legacy `actum.stage` string from a
Nuntius, so existing consumers keep working while they migrate.

## 6. Runner mappings (proof of runner-agnosticism — all three + more)

### 6a. ComfyUI (`comfyrunnerClient`) — retarget the existing parse
| ComfyUI SSE event | → `Phasis` | progress / detail |
|---|---|---|
| `preflight-models` | `downloading` | — (about to fetch) |
| `downloading` / `download-progress` | `downloading` | `{done,total,unit:'items'}` + `parallel[]` bytes per file; `etaMs` |
| `downloaded` / `models-ready` | `downloading` → (done) | phase boundary |
| `installing-node` / `restarting-comfy` | `installing` | message = node name |
| `workflow-submitted` | `loading` | `target:'vram'` — ComfyUI loading weights for the graph |
| `waiting` ("awaiting ComfyUI") | `loading` / `warming` | `target:'vram'`; first-node warmup |
| `node` | `executing` | message = node title |
| `progress` | `executing` | `{done:value,total:max,unit:'steps'}` |
| `uploading` | `uploading` | — |
| `complete` | `done` | — |
| `error` | `failed` | message = error |

### 6b. TEE enclave runner — give it real status (today: stub)
| TEE step | → `Phasis` | notes |
|---|---|---|
| pod create (RunPod SECURE) | `provisioning` | from `TeeProvisioner` |
| pull the `tee-runner` image | `pulling` | `target:'fundamentum'`; cold-start image fetch |
| WireGuard key exchange (`/runner/ready` `wgPublicKey`) + WS-upgrade probe | `attesting` | the secure-tunnel handshake (TEE-only phase) |
| model load into enclave | `loading` | `target:'vram'`; `resources.vramUsedMb` |
| inference / token stream | `executing` | `{done:tokens, unit:'items'}` |
| heartbeat (`gpuHours`) | (current phase, refreshed) | lifecycle channel carries a Nuntius |
| ended | `done` / `failed` | |

### 6c. Training runner (VastAI) — fold legacy phases in
| Training step | → `Phasis` | progress |
|---|---|---|
| provision VastAI instance | `provisioning` | — |
| pull the trainer image (aitoolkit) | `pulling` | `target:'fundamentum'` |
| upload dataset / fetch base model | `downloading` | `target:'dataset'`/`'model'`, `{unit:'bytes'}` |
| init model | `loading` | `target:'vram'`; `resources.vramUsedMb` |
| train | `executing` | `{done:step, total:totalSteps, unit:'steps'}`; `etaMs` |
| upload output → HF/R2 (publishing #3/#3b) | `uploading` | `{unit:'bytes'}` |
| done / stall-timeout | `done` / `failed` | |

### 6d. Hosting / downloading / VRAM
- **Hosting** (warm studio) — idle warmth + the active gen's Nuntius; `resources` surfaces VRAM headroom for the bulletin.
- **Standalone download** (model install onto a volume) — a `downloading` Nuntius with bytes progress + `parallel[]` per file.
- **VRAM and friends** ride `resources` on any phase — first-class, not bolted on.

## 7. Persistence — the full timeline on the Actum (decided)

We want **all the logs saved on the final Actum** so states are queryable later and each step's speed is
measurable. So we persist the whole stream, not just the latest:
- `Actum.nuntii: Nuntius[]` — the **ordered timeline** of every phase transition + key event, each timestamped
  (`at`). Step durations are derived by diffing consecutive `at`s (or rolled up into a `phaseDurations` summary
  on completion: `{ provisioning: ms, pulling: ms, downloading: ms, loading: ms, executing: ms, … }` —
  cross-run comparable). `Actum.nuntius` (singular) is the latest, a convenience pointer to `nuntii[last]`.
- `Modo.nuntii` / TEE-session — same, for long-lived sessions.
- `ActumExecutio` telemetry **unifies into this** — its fields (provisionMs, downloadMs, …) become the derived
  `phaseDurations`, no longer separately reported.

**Volume guard (the one thing to get right):** raw high-frequency ticks (sampler step 7→8→9, byte samples)
must NOT each become a persisted row, or a long run bloats the doc. Policy: persist **every phase/target
transition** + **error/warn events** + a **coalesced progress checkpoint** (e.g. ≤1/sec or on ≥5% change);
the fine-grained ticks stay live-only (bus/SSE) and collapse into the owning phase entry's final
`progress`/`etaMs`. (comfyrunner already throttles download samples — reuse that policy.) Deep per-tick traces,
if ever wanted, go to the analytics/`wideStore`, not the Actum doc.

## 8. Build order

1. 🟠 **Core:** `src/types/nuntius.ts` — `Nuntius` + `Phasis` + `target` + `resources`. Add `Actum.nuntii[]` (timeline) + `nuntius` (latest) + derived `phaseDurations`.
2. 🟠 **Sink + bus + projection:** `POST /runner/status` (one channel; returns `{continue}`) → `CrystalApi.reportNuntius` → append to `nuntii[]` (coalesced, §7) + `actum.nuntius` bus event → `NuntiusProjector` (with legacy `actum.stage` shim).
3. 🟠 **ComfyUI:** retarget `comfyrunnerClient` to emit `Nuntius` (6a) instead of strings.
4. 🟠 **TEE:** the enclave runner POSTs real `Nuntius` (6b) — closes the TEE status gap.
5. 🟠 **Training:** the trainer POSTs `Nuntius` (6c).
6. 🟠 **Consumers:** `StatusView`/bulletin/frontend read `Nuntius`; derive `ActumExecutio` from phase durations.

Per the build decision, the canonical model is defined once and ComfyUI + TEE + training are wired together
(#3–5) to prove runner-agnosticism before the consumer migration (#6).

## 9. Decisions + still-open

**Decided (2026-06-22):**
- **Name** = `Nuntius`.
- **One channel** — `/runner/status` carries the Nuntius and returns `{continue}`, subsuming heartbeat (§4).
- **Full timeline persisted** on `Actum.nuntii[]` (+ `nuntius` latest pointer); step durations derived /
  rolled into `phaseDurations`; `ActumExecutio` unifies in (§7).
- **Phase granularity** — split the three faces of "loading" into `pulling` (fundamentum) / `downloading`
  (artifacts) / `loading` (VRAM), + `warming`, `cancelling`; `target` absorbs finer specificity (§3b).

**Still open (resolve during the build, not blockers):**
- **Coalescing policy specifics** — the exact throttle (≤1/sec? ≥5% delta?) for the persisted progress
  checkpoints vs the live stream (§7). Tune against a real run.
- **`phaseDurations` rollup shape** — flat `{phase: ms}` vs per-`(phase,target)` (e.g. download-model vs
  download-dataset separately). Lean per-(phase,target) since that's the measurement we asked for.
- **Base-image schema versioning** — a `v` on the Nuntius so older base images degrade gracefully (unknown
  phase → nearest known; missing fields → fine). Define before the first base image ships it.
- **Does `Modo` (warm session) need its own timeline**, or is per-Actum enough + a session rollup?
