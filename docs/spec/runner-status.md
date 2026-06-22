# Runner status (Nuntius) — spec

**Status:** DRAFT 2026-06-22. Proposes a crystal-owned, runner-agnostic status model so every
base-image runner (ComfyUI, TEE, training, hosting, downloading) reports progress in **one shape** that
all consumers (SSE, Telegram, bulletin, frontend, analytics) read. Not built. Build against this once
finalized.

> **Naming is provisional.** This spec proposes **`Nuntius`** (Latin *nuntius* — a dispatch, a report, a
> messenger) for the status-report primitive. NOT `Gradus` — that already names a compositus spell's ordered
> steps (`Modus.gradus`). Open for finalization (§9).

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
  progress?:  { done, total, unit }     // unit: 'items' | 'bytes' | 'steps' | 'pct'
  etaMs?:     number                    // estimated time remaining in this phase
  message?:   string                    // human detail ("loading flux1-schnell")
  resources?: { vramUsedMb?, vramTotalMb?, gpuUtilPct?, diskUsedMb? }   // VRAM & friends; extensible
  parallel?:  Nuntius[]                 // sub-reports for concurrent work (3d)
  at:         Date
}
```
A runner emits a *stream* of `Nuntius`. The **latest** is persisted (`Actum.nuntius?` / `Modo.nuntius?` for
long sessions) so "current status" is queryable; the *stream* flows via the bus to live consumers.

### 3b. `Phasis` — the canonical phase taxonomy (the OWNED vocabulary)
Runner-agnostic. Every runner maps its native events into exactly these. Ordered roughly by lifecycle:
```
Phasis =
  | 'queued'        // accepted, awaiting a slot (warm-pool queue, scheduler)
  | 'provisioning'  // acquiring compute (pod/instance create, cold start)
  | 'attesting'     // TEE attestation + secure-tunnel handshake (TEE only)
  | 'downloading'   // fetching inputs onto the runner (models, datasets, media)
  | 'installing'    // installing custom nodes / deps
  | 'loading'       // loading weights into VRAM / warming
  | 'executing'     // the actual work (inference steps, training steps, token stream)
  | 'uploading'     // pushing outputs out (R2, HF)
  | 'finalizing'    // settle / cleanup
  | 'done'
  | 'failed'
```
These are **owned**: adding a richer ComfyUI event never adds a `Phasis` — it maps to an existing one (with
`message`/`progress` carrying the native detail). A new runner that needs a genuinely new phase is a spec
change, deliberately (keeps the vocabulary small and shared).

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

## 4. The protocol — one universal sink

`POST /runner/status` becomes the **canonical status sink** (generalizing today's TEE stub). Body:
```
{ actumId?  |  sessionId? ,  nuntius: Nuntius }
```
Every base image speaks it: the persistent runner.py job server, comfyrunner, the TEE enclave runner, the
trainer. The platform handler (`CrystalApi.reportNuntius`):
1. **persists** the latest Nuntius on the `Actum` (or `Modo`/TEE session);
2. **emits** it to the bus (a typed `actum.nuntius` event — supersedes the stringly `actum.stage`);
3. lets the **projection** (§5) fan it out.

The existing `/runner/ready|heartbeat|ended` stay as the *lifecycle* control channel (they gate
provisioning + billing); `/runner/status` is the *progress* channel. (A heartbeat MAY carry a Nuntius too.)

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
| `workflow-submitted` / `waiting` | `queued` / `loading` | "awaiting ComfyUI" |
| `node` | `executing` | message = node title |
| `progress` | `executing` | `{done:value,total:max,unit:'steps'}` |
| `uploading` | `uploading` | — |
| `complete` | `done` | — |
| `error` | `failed` | message = error |

### 6b. TEE enclave runner — give it real status (today: stub)
| TEE step | → `Phasis` | notes |
|---|---|---|
| pod create (RunPod SECURE) | `provisioning` | from `TeeProvisioner` |
| WireGuard key exchange (`/runner/ready` `wgPublicKey`) + WS-upgrade probe | `attesting` | the secure-tunnel handshake (TEE-only phase) |
| model load into enclave | `loading` | `resources.vramUsedMb` |
| inference / token stream | `executing` | `{done:tokens, unit:'items'}` |
| heartbeat (`gpuHours`) | (current phase, refreshed) | lifecycle channel carries a Nuntius |
| ended | `done` / `failed` | |

### 6c. Training runner (VastAI) — fold legacy phases in
| Training step | → `Phasis` | progress |
|---|---|---|
| provision VastAI instance | `provisioning` | — |
| upload dataset / fetch base model | `downloading` | `{unit:'bytes'}` |
| init model | `loading` | `resources.vramUsedMb` |
| train | `executing` | `{done:step, total:totalSteps, unit:'steps'}`; `etaMs` |
| upload output → HF/R2 (publishing #3/#3b) | `uploading` | `{unit:'bytes'}` |
| done / stall-timeout | `done` / `failed` | |

### 6d. Hosting / downloading / VRAM
- **Hosting** (warm studio) — idle warmth + the active gen's Nuntius; `resources` surfaces VRAM headroom for the bulletin.
- **Standalone download** (model install onto a volume) — a `downloading` Nuntius with bytes progress + `parallel[]` per file.
- **VRAM and friends** ride `resources` on any phase — first-class, not bolted on.

## 7. Persistence

- `Actum.nuntius?: Nuntius` — the latest report (queryable "current status"). The stream is NOT fully
  persisted (bus/SSE only); optionally a small ring of the last N for a timeline.
- `Modo.nuntius?` / TEE-session — same, for long-lived sessions.
- `ActumExecutio` telemetry is **derived** from phase dwell-times (the projector accumulates them), so we
  stop reporting it separately.

## 8. Build order

1. 🟠 **Core:** `src/types/nuntius.ts` — `Nuntius` + `Phasis` + `resources`. Persist `Actum.nuntius?`.
2. 🟠 **Sink + bus + projection:** `POST /runner/status` → `CrystalApi.reportNuntius` → persist + `actum.nuntius` bus event → `NuntiusProjector` (with legacy `actum.stage` shim).
3. 🟠 **ComfyUI:** retarget `comfyrunnerClient` to emit `Nuntius` (6a) instead of strings.
4. 🟠 **TEE:** the enclave runner POSTs real `Nuntius` (6b) — closes the TEE status gap.
5. 🟠 **Training:** the trainer POSTs `Nuntius` (6c).
6. 🟠 **Consumers:** `StatusView`/bulletin/frontend read `Nuntius`; derive `ActumExecutio` from phase durations.

Per the build decision, the canonical model is defined once and ComfyUI + TEE + training are wired together
(#3–5) to prove runner-agnosticism before the consumer migration (#6).

## 9. Open / to finalize

- **Name** — `Nuntius` vs `Progressus` vs `Status` (Latin `status, -us` is the genuine term but a generic TS
  name). `Gradus` is taken (compositus steps). Decide before the type lands.
- **Phase set** — is the §3b list complete? Candidates: a separate `warming` vs `loading`; `cancelling`.
- **Stream persistence** — latest-only (proposed) vs a bounded timeline ring on the Actum.
- **Heartbeat vs status** — keep `/runner/status` separate from `/runner/heartbeat`, or let heartbeat carry
  the Nuntius (one channel)?
- **Backpressure** — runners can emit many `progress` updates/sec; the sink should throttle/coalesce
  (comfyrunner already throttles download samples — fold that policy in).
- **Base-image contract** — version the Nuntius schema so older base images degrade gracefully (unknown phase
  → nearest known; missing fields → fine).
