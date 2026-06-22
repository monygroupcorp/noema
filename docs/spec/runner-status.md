# Runner status (Progressus) — spec

**Status:** DRAFT 2026-06-22. Build #1 (core types) LANDED. Proposes a crystal-owned, runner-agnostic status
model so every base-image runner (ComfyUI, TEE, training, hosting, downloading) reports progress in **one
shape** that all consumers (SSE, Telegram, bulletin, frontend, analytics) read.

> **Name: `Progressus`** (Latin *progressus*: a going-forward, an advance — connotes advancing through the
> lifecycle, which a static "status" and a "message" both miss). Renamed from `Nuntius` 2026-06-22: `Nuntius`
> already names the **allocutio inbound platform message** (`src/types/allocutio.ts`, store `Nuntiorum`,
> declension *nuntii/nuntiorum*) — reusing it would collide head-on with that primitive *and* its plural in
> the same `src/types/` namespace, violating one-word-one-concept. Also NOT `Gradus` (compositus spell steps,
> `Modus.gradus`). The primitive lives at `src/types/progressus.ts`.

**Decisions locked (2026-06-22):** name = `Progressus`; **one channel** (status subsumes heartbeat, §4); **the
full timeline is persisted on the Actum** — every transition + log message + error, so states are queryable
and each step's duration is measurable (§7); the phase taxonomy is **as specific as the distinct measurable
costs demand** — pulling the fundamentum, downloading models, and loading into VRAM are SEPARATE phases (§3b);
**status is always per-Actum** — `/arm` (warm-session procurement) is its own Actum, every gen within is its
own Actum, the `Modo` has no separate timeline (§7); durations roll up **per `(phase, target)`** (§7);
schema-versioned + lenient so base images degrade gracefully (§4).

## 1. What it is — and why we own it

> **A `Progressus` = (a canonical phase) × (optional progress / resources / parallel sub-reports) at a moment.**
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
smoothly with every consumer, and a new runner is "emit Progressus," not "invent a status protocol."

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
from the Progressus stream — one model, not two.

## 3. The crystal core

### 3a. `Progressus` — one structured status report
```
Progressus {
  phase:      Phasis                    // the canonical, OWNED phase (3b)
  target?:    string                    // WHAT this phase acts on, for within-phase specificity:
                                        //   'fundamentum' | 'model' | 'lora' | 'dataset' | 'input' | 'vram' | 'output' | …
  progress?:  { done, total, unit }     // unit: 'items' | 'bytes' | 'steps' | 'pct'
  etaMs?:     number                    // estimated time remaining in this phase
  message?:   string                    // human detail ("loading flux1-schnell into VRAM")
  resources?: { vramUsedMb?, vramTotalMb?, gpuUtilPct?, diskUsedMb? }   // VRAM & friends; extensible
  parallel?:  Progressus[]                 // sub-reports for concurrent work (3d)
  at:         Date
}
```
`phase` is the coarse step (for the timeline + measurement); `target` is the within-phase specificity (so a
`downloading` of a `model` is queryable apart from a `downloading` of a `dataset`, without exploding the phase
set). A runner emits a *stream* of `Progressus`; the **whole stream is persisted** on the Actum (§7) — not just
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

### 3d. Parallelism is first-class (`parallel: Progressus[]`)
Concurrent work nests instead of flattening to a string. Examples:
- multi-model download: a `downloading` Progressus whose `parallel[]` is one sub-Progressus per file (each with its own bytes progress);
- a Collectio fan-out: an `executing` Progressus whose `parallel[]` is one sub-report per in-flight actum;
- parallel training shards / multi-GPU.
Consumers can render the rollup (parent phase + aggregate %) or drill into the sub-reports.

## 4. The protocol — ONE channel (decided)

`POST /runner/status` is the **single** runner→platform channel. It carries the Progressus **and** doubles as the
heartbeat — no separate status vs heartbeat split. Body + response:
```
→  { v: 1 ,  actumId? | sessionId? ,  progressus: Progressus }
←  { continue: boolean }          // the keep-alive / cancel signal (today's heartbeat return)
```
**Lenient by contract (base images deploy off-cadence from the platform):** the `v` schema version + tolerant
parsing let an OLD base image and a NEW platform (or vice-versa) interoperate — an **unknown `phase` degrades
to the nearest known** (default `executing`, or `failed` if it smells terminal), an unknown `target` is just a
free string, and **missing fields are always fine** (everything but `phase`/`at` is optional). A runner is
never rejected for speaking a slightly older/newer Progressus; we never hard-fail a status report.
Every base image speaks exactly this one call: the persistent runner.py job server, comfyrunner, the TEE
enclave runner, the trainer. The platform handler (`CrystalApi.reportProgressus`):
1. **appends** the Progressus to the Actum's persisted timeline + updates the latest (§7);
2. **emits** it to the bus (a typed `actum.progressus` event — supersedes the stringly `actum.stage`);
3. lets the **projection** (§5) fan it out;
4. returns `{ continue }` — so the same call that reports progress also tells a runner to keep going or bail
   (subsumes `/runner/heartbeat`).

The discrete lifecycle markers fold into phases: today's `/runner/ready` ≈ a `loading`/`warming`→`executing`
Progressus, `/runner/ended` ≈ a `done`/`failed` Progressus. The base-image contract collapses to **"emit Progressus,
read `continue`."** (The legacy `/runner/ready|heartbeat|ended` endpoints stay during migration, then retire.)

## 5. Projection — one mapper to every consumer

A single `ProgressusProjector` maps a Progressus to each consumer shape, replacing the scattered stringly
translation:
- **SSE** (`RunEventHub`) — stream the Progressus (typed) to the per-run client;
- **Telegram `StatusView`/bulletin** — a label + bar derived from `phase` + `progress` (kills the per-stage string parsing);
- **Frontend** — the same typed Progressus (the new app renders phase/% directly);
- **Analytics / `ActumExecutio`** — accumulate phase dwell-times → the existing telemetry fields are *derived*, not separately reported (§2 insight).

Backward-compat during migration: the projector can still emit the legacy `actum.stage` string from a
Progressus, so existing consumers keep working while they migrate.

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
| heartbeat (`gpuHours`) | (current phase, refreshed) | lifecycle channel carries a Progressus |
| ended | `done` / `failed` | |

### 6c. Training runner (ostris/ai-toolkit) — read its STRUCTURED job state, not stdout

The crystal-native training runner drives **ostris/ai-toolkit** directly (FLUX.2 Klein and
friends — klein trains on a 24GB 4090 where FLUX.1's 12B OOMs; upstream even ships a
"Klein load-time VRAM spike" low-mem fix). We map from ai-toolkit's **typed SQLite `Job`
row** (`ui/prisma/schema.prisma`, written by `UITrainer`) — NOT from training stdout. The
legacy `TrainingOutputParser` (538 lines of `/step\s*(\d+)\/(\d+)/` regexes across
ai-toolkit/Kohya/generic formats) is **retired, not ported**. The Job signal is two-axis:
a typed `status` (`Literal["running","stopped","error","completed"]` + `"queued"`) × an
`info` sub-phase label, plus `step` / `speed_string` / `job_config.process[0].train.steps`.

| ai-toolkit `Job` (`status` + `info`) | → `Phasis` | progress |
|---|---|---|
| `queued` | `queued` | `queue_position` → message |
| `running` + "Loading dataset" | `downloading` | `target:'dataset'` |
| `running` + "Loading model" / "Starting" (step 0) | `loading` | `target:'vram'`; `resources.vramUsedMb` |
| `running` + "Training" (step>0) | `executing` | `{done:step, total:cfgSteps, unit:'steps'}`; `etaMs` from `speed_string` |
| `completed` | `done` | — |
| `error` | `failed` | message = `info` |
| `stopped` | `cancelling` | terminal |

`message` is set for phase-meaningful sub-phases / errors but NEVER for the steady
"Training" pings — so incrementing-step reports coalesce to live-only (§7). A **local**
ai-toolkit run has no `provisioning`/`pulling` (no pod create / image pull) — its timeline
opens at `loading`; a remote training variant prepends those, mapped from the provider.
Output `uploading` → HF/R2 is the publishing arm (#3/#3b), not ai-toolkit's job state.

### 6d. Hosting / downloading / VRAM
- **Hosting** (warm studio) — idle warmth + the active gen's Progressus; `resources` surfaces VRAM headroom for the bulletin.
- **Standalone download** (model install onto a volume) — a `downloading` Progressus with bytes progress + `parallel[]` per file.
- **VRAM and friends** ride `resources` on any phase — first-class, not bolted on.

## 7. Persistence — the full timeline on the Actum (decided)

We want **all the logs saved on the final Actum** so states are queryable later and each step's speed is
measurable. So we persist the whole stream, not just the latest:
- `Actum.progressus: Progressus[]` — the **ordered timeline** of every phase transition + key event, each timestamped
  (`at`). The **latest** report is `progressus.at(-1)` — **derived, not a persisted pointer** (`Progressus` is
  4th-declension, so a singular `Actum.progressus` field would be a homograph of the array; we keep one field
  and derive latest, true to crystal-first minimalism).
- `Actum.phaseDurations` — derived on completion, **per `(phase, target)`** so the granular costs are directly
  comparable: `{ "provisioning": ms, "pulling/fundamentum": ms, "downloading/model": ms,
  "downloading/dataset": ms, "loading/vram": ms, "executing": ms, "uploading/output": ms, … }`. This is the
  "how fast is each step" substrate, cross-run queryable.
- `ActumExecutio` telemetry **unifies into this** — its fields (provisionMs, downloadMs, …) become the derived
  `phaseDurations`, no longer separately reported.

**Status is ALWAYS per-Actum — the warm session has no separate timeline.** Procuring a warm studio via
`/arm` (agent twin: `provisionStudio`) is **its own Actum**, which owns the expensive cold-start phases
(`provisioning` → `pulling` the fundamentum → `attesting` → `loading` VRAM) — measured ONCE, on the arm
Actum. Every gen run inside the warm session is **its own Actum** with its own `progressus` (near-zero
provisioning/pulling, since warm — so cold-vs-warm cost falls straight out of the data). The `Modo` (session)
keeps only its `acta: string[]`; "session status" is the **rollup** of its Acta's timelines, not a fourth
copy of the data. (So: no `Modo.progressus`.)

**Volume guard — what's persisted vs live (resolves the coalescing question):**
- **Persisted verbatim** (this IS "all the logs"): every **phase/target transition**, every **log message**
  (`message`), every **error/warn**. Bounded — a run has ~dozens, not thousands.
- **NOT persisted per-tick:** pure numeric progress (sampler 7→8→9, byte samples). These stay **live-only**
  (bus/SSE for the moving bar) and collapse into the owning phase entry's terminal `progress`/`etaMs`. A
  phase's *duration* (the thing we measure) comes from its transition timestamps, not from the ticks.
- Optional intra-phase progress checkpoints, if ever wanted for a graph, are coalesced to **≤1/sec**
  (comfyrunner already throttles download samples — reuse that). Deep per-tick traces go to `wideStore`, never
  the Actum doc.

## 8. Build order

1. ✅ **Core (LANDED 2026-06-22):** `src/types/progressus.ts` — `Progressus` + `Phasis` + `target` + `resources` + `PhaseDurations` (pure declarations). Roll-up logic (`rollupPhaseDurations`/`phaseKey`) lives in the execution rail, `src/execution/progressus.ts` (mirrors `projectExitus`; `src/types/` stays declaration-only). Added `Actum.progressus[]` (timeline; latest derived via `.at(-1)`) + derived `phaseDurations` (per `phase/target`), wired into the `Actorum.update` Pick (interface + Mongo + Memory). Unit-tested (`tests/unit/crystal/progressus.test.ts`). (Status is per-Actum — no `Modo` timeline; the arm Actum owns cold-start phases.)
2. ✅ **Sink + bus + projection (LANDED 2026-06-22):** `POST /runner/status` (one channel; returns `{continue}`; lenient — legacy `{sessionId,step}` folds into an `executing` report) → `CrystalApi.reportProgressus` → append to `progressus[]` **coalesced** (transitions + messages + terminals persisted; per-tick progress live-only, §7) + roll up `phaseDurations` on terminal + `actum.progressus` bus event + legacy `actum.stage` shim (`progressusToStage`) so existing SSE/Telegram consumers keep working. Pure transforms (`normalizeProgressus`/`coercePhase`/`shouldPersist`/`progressusToStage`) in `src/execution/progressus.ts`. Tests: `tests/unit/crystal/progressusSink.test.ts` (15). Note: the `/runner/status` response shape went `{ok}`→`{continue}` — safe, the TEE runner posts fire-and-forget (`curl … || true`, ignores the body).
3. ✅ **ComfyUI (LANDED 2026-06-22):** `comfyrunnerClient`'s SSE parse now builds a typed `Progressus` per §6a and persists the timeline through an **in-process recorder seam** (`src/execution/progressusSink.ts` — an ambient registration mirroring `bus`, wired at startup to `CrystalApi.recordProgressus`; the crystal rail is constructed before `CrystalApi`, so no HTTP loopback). `recordProgressus` is the in-process twin of the HTTP sink: it shares `_persistAndEmit` (coalesced append + `phaseDurations` rollup on terminal + typed `actum.progressus` event) but emits **no** legacy `actum.stage` shim — comfyrunner still emits the legacy stage vocabulary itself via the **untouched** `emitStage` (consumers like `PodSession.onStage` parse those exact strings: `inferring`/`installing-nodes`/`downloading:n/m` — changing them is build #6, not now). Only phase transitions / messages / terminals record (§7); per-tick sampler/byte progress stays live-only on the bus (no `findById`-per-tick). Records awaited inline so reports apply in order and the terminal lands before the stream resolves. **Scope boundary:** cold-start phases (`provisioning`/`pulling`/`bootstrapping`/`comfy-ready`) live in `SecurePodClient.emitStage` and carry pod-control `StageInfo` (podId/gpuType) — they are NOT yet recorded to the timeline, so a cold ComfyUI run's `progressus[]` opens at `downloading`; `provisionMs` etc. still live in `ActumExecutio`. Folding cold-start into the timeline is part of #6's unification. Tests: `tests/unit/crystal/comfyrunnerProgressus.test.ts` (3, the event→Progressus mapping).
4. ✅ **TEE (LANDED 2026-06-22):** the enclave runner POSTs real `Progressus` (6b) over the universal `/runner/status` channel, closing the TEE status gap. Two halves: **(a) runner-side** — `runner.py` gained `signal_status(phase, target?, message?)` (fire-and-forget; the heartbeat still owns the stop signal) emitting the in-enclave phases the platform can't see from outside the tunnel: `downloading`/`model` (gguf pull), `loading`/`vram` (process launch = model load), `warming` (readyProbe). **(b) platform-side** — the TEE lifecycle the platform DOES observe maps to `Phasis` directly on the session: `provisioning` (provision) → `attesting` (WG handshake + WS-upgrade probe) → `done`/`failed` (clean exit vs budget-kill / crash / probe-give-up). `reportProgressus` now routes a `sessionId`-bound report (no actumId) onto the live session — reflected as `TeeSessionView.phase`, the browser's cold-start progress on its existing poll — and returns `continue:false` once the session ended (replacing the heartbeat's bail role for status posts). **Scope boundary (§9):** this is the *latest* phase as live session status, NOT a persisted timeline — the warm session has no Actum yet, so there's nothing to roll into `phaseDurations`; full timeline persistence lands when the arm Actum (`provisionStudio`) is minted. The in-enclave `executing`/token-stream phase isn't emitted (inference is transparently proxied through `/infer/*` — no clean per-token hook runner-side; folds into the arm-Actum work). Tests: `tests/unit/crystal/progressusSink.test.ts` (+2 — session-phase reflection + ended-bail).
5. 🟡 **Training (projector LANDED + ground-truth-validated 2026-06-22; runner pending):** crystal-native — drive **ostris/ai-toolkit** directly and read its typed SQLite `Job` row, retiring the legacy `TrainingOutputParser` regex slop entirely (decided: no legacy VastAI wrap). The pure §6c projector `aitkJobToProgressus(job, cfgSteps)` (`src/execution/aitkProgressus.ts`) maps ai-toolkit's two-axis `status`×`info` job state → `Progressus`, including `executing {done:step,total,steps}` + `etaMs` parsed from `speed_string` (both `iter/sec` and `sec/iter`), and is coalescing-aware (steady "Training" pings carry no `message`, so ticks stay live-only §7). **Validated against real ground truth:** a local **FLUX.2 Klein-4B** smoke (60 steps, the `stationthis` style LoRA on the 4090, `ui_trainer` → SQLite `Job` rows) ran end-to-end; the actual emitted timeline (`Starting`→`Loading Qwen3`→`Quantizing Qwen3`→`Loading model`→`Loading dataset`→`Generating baseline`→`Training`→`Training completed`) projects to a clean `loading → downloading → executing → done` shape — the projector handled klein-specific load substates it never hardcoded. Orchestration (image, config, launcher, preflight, runbook) at `~/projects/ai/training/stationthis-klein/`. Tests: `tests/unit/crystal/aitkProgressus.test.ts` (14, incl. the captured ground-truth timeline). **Still pending:** the crystal-native training **runner** (a Cursor that writes the Job row + spawns ai-toolkit, polls `aitk_db.db`, emits Progressus to its training **Actum** — so unlike TEE, the full timeline + `phaseDurations` persist).
6. 🟠 **Consumers:** `StatusView`/bulletin/frontend read `Progressus`; derive `ActumExecutio` from phase durations.

Per the build decision, the canonical model is defined once and ComfyUI + TEE + training are wired together
(#3–5) to prove runner-agnosticism before the consumer migration (#6).

## 9. Decisions + still-open

**Decided (2026-06-22):**
- **Name** = `Progressus`.
- **One channel** — `/runner/status` carries the Progressus and returns `{continue}`, subsuming heartbeat (§4).
- **Full timeline persisted** on `Actum.progressus[]` (latest derived via `.at(-1)`); step durations derived /
  rolled into `phaseDurations`; `ActumExecutio` unifies in (§7).
- **Phase granularity** — split the three faces of "loading" into `pulling` (fundamentum) / `downloading`
  (artifacts) / `loading` (VRAM), + `warming`, `cancelling`; `target` absorbs finer specificity (§3b).

**Resolved 2026-06-22 (was open):**
- **Coalescing** — don't persist per-tick numeric progress at all; persist transitions + log messages + errors
  verbatim ("all logs"), measure durations from transition timestamps. Per-tick is live-only; optional
  checkpoints coalesce ≤1/sec (§7).
- **`phaseDurations` rollup** — per-`(phase, target)` (download-model vs download-dataset measured apart) — §7.
- **Base-image versioning** — `v` on the POST envelope + lenient parsing; unknown phase → nearest known,
  missing fields fine; a status report never hard-fails (§4).
- **Warm session timeline** — none. Status is per-Actum; `/arm` is its own Actum (owns cold-start phases),
  each gen its own Actum; the `Modo`'s status is the rollup of its `acta` (§7).

**Genuinely still open (small, tune in build):**
- The exact "nearest known phase" fallback table for unknown phases.
- Whether the arm Actum needs a distinct `genus`/marker so cold-start measurements are trivially filterable
  from gen runs (likely yes — but it's an Actum-shape question, decide when wiring `provisionStudio`).
