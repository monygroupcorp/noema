# ADR-0007: The runner/executor split + the new-medium type extensions

- **Status:** proposed
- **Date:** 2026-06-11
- **Relates to:** ADR-0005 (`Fundamentum` — `runtime` is the per-substrate selector this ADR dispatches on),
  ADR-0001 (speak the crystal / no new nouns — the executor is **not** a new ring noun), the second-runtime
  config-ring sprint (`docs/plans/2026-06-04-second-runtime-config-ring-sprint.md:71`, which first flagged
  "comfyrunner must branch on `CompiledSpec.runtime`").
- **Grounded by:** `docs/spec/essentiae-triage.md` — the triage of 5 new models that forced this.

## Context

We are standing up 5 new models on rented RunPod pods (`docs/spec/essentiae-triage.md`):

| flow | model | direction | runtime needed |
|---|---|---|---|
| `text→music` | HeartMuLa-3B | text → `.mp3` | custom python lib (one-shot CLI) |
| `image/text→3d` | Hunyuan3D-2.1 | image\|text → `.glb` | custom python lib (multi-stage) |
| `image+text→text` | Qwen3-VL-8B | image+text → text | transformers / vLLM serving |
| `audio→text` | MOSS-Music-8B | audio+text → text | transformers / SGLang serving |
| `video/image→text` | ShotVL-7B | video\|image → text | transformers / vLLM serving |

Two coupled problems block this, both rooted in the same fact: **the platform only knows how to run ComfyUI and
only knows how to deliver images.**

**Problem 1 — the pod-side runner is a ComfyUI monolith.** `scripts/pod/comfyrunner.py` (872 lines, shipped to
each pod over SSH at bootstrap — `SecurePodClient.ts:631`) bundles two concerns:
- a **runtime-invariant shell**: the HTTP job server (`/job`, `/install`), the job queue (`_process_next`,
  `_process_job`), model provisioning (`_download_model`, `_ensure_models`, `_install_models`), the output sink
  (`_upload_to_r2`, `_send_webhook`), and progress (SSE `_write_sse`, `_append_event`, `_progress_emitter`);
- a **ComfyUI-specific executor**: `_start_comfyui`, `_wait_for_comfy_http`, `_ws_listener_thread`,
  `_check_history_complete`, `_ensure_custom_nodes`, and `_output_paths` (which parses ComfyUI's
  `images/gifs/videos` output JSON).
Adding 3 runtimes by forking this monolith 3× would triple the surface that handles billing-relevant concerns
(download locks, R2, webhooks, SSE) — exactly the drift ADR-0005/0006 fought on the ring side.

**Problem 2 — the type system only speaks pixels.** Mapping the 5 models to real `Essentia`/`Fundamentum` fields
surfaced (triage Artifact 3):
1. `EssentiaCategoria` (`src/types/essendi.ts:27`) has no `3d` — Hunyuan3D can't declare its output.
2. The port-type canon (`Porta.type`, documented at `src/types/modus.ts:37`: `text|image|video|audio|int|float`)
   has no `mesh`/`3d`; `VestigiumGenus` (`src/types/vestigium.ts:37`) is a *strict union* with the same gap.
3. Output materialization is image-only — the run-completion path stores to R2 + delivers as an inline image.
   `.mp3` and `.glb` have no delivery branch.
4. `Essentia.workflowTemplate` (`src/types/essendi.ts:87`) assumes a ComfyUI graph id — the new runtimes have no
   graph (a python-modelcard flow's form is a script+args; an LLM flow's form is a prompt+gen-params).

Problems 1 and 2 are the **same seam from two sides**: gap 4 (the Essentia form half) is the type-side of the
executor split; gaps 1–3 (output kinds) are driven by what the new executors produce. So: one ADR.

## Decision

### Part A — split the runtime-specific path from the runtime-invariant core (host **and** pod)

The ComfyUI coupling lives on **two** sides, both of which must branch on `Fundamentum.runtime`:

**A1 — host-side: the Compiler.** `Compiler.ts` is ComfyUI-hardwired today: it **requires**
`essentia.workflowTemplate` (`Compiler.ts:134-142`, `templates.get(...)`) and **always** emits
`spec.workflow = { templateId, templateVersion, inputTemplate }` (`Compiler.ts:234-249`) — a ComfyUI graph spec.
There is no `CompiledSpec` shape for "run this prompt on a vLLM server" or "run this script with these args." The
Compiler must branch on `fundamentum.runtime`:
- `ComfyUI` → current path (template + slot-map → `spec.workflow`).
- `vLLM` / `llm` → resolve the Essentia's `llm` form (prompt template + gen params, ADR Part B item 4) → a new
  `spec.inference = { prompt, genParams }` variant; **no** template lookup.
- `python-modelcard` → resolve the script + arg-map form → `spec.script = { entry, argMap }`.
`CompiledSpec` becomes a discriminated union on `runtime` (the weight-manifest resolution and family derivation —
`Compiler.ts:151-182` — stay shared above the branch).

**A2 — pod-side: the runner.**

Extract the runtime-invariant shell into **`runner.py`** (identical on every pod) and the ComfyUI logic into one
of several **executors** behind a single interface. The shell never changes per runtime; the executor is the only
variable.

```
# Executor interface (pod-side python)
class Executor:
    def ensure_ready(self, spec) -> None      # ComfyUI: start server + custom nodes
                                              # python-modelcard: git clone + pip install -e .
                                              # vllm: load weights into the serving process
    def run(self, job_spec) -> RunResult      # produce output files on disk
    # RunResult carries: output_paths: list[str], each tagged with its kind (image|audio|video|3d|text)
    # so the SHARED R2+delivery branch knows .png vs .mp3 vs .glb without re-inspecting.
    def model_dest(self, model) -> str        # where this runtime expects weights (was ComfyUI-hardcoded)
```

Three executors cover all known flows:
- **`ComfyUIExecutor`** — the current code, extracted from the monolith. Serves flux, sd1-5 (and Hunyuan3D as a
  fallback path).
- **`PythonModelcardExecutor`** — `git clone + pip install -e . + run CLI`, collect the output file(s). Serves
  HeartMuLa and Hunyuan3D (primary).
- **`TransformersVllmExecutor`** — download weights, serve via transformers or vLLM/SGLang, run inference, return
  text. Serves Qwen3-VL, MOSS-Music, ShotVL — **one executor, one shared substrate, weights swapped per flow.**

**Dispatch key:** `Fundamentum.runtime` (ADR-0005's single-sourced field; already carried onto `CompiledSpec` at
`Compiler.ts:245`, copied onto `Materia` at provision). **Both** the Compiler (A1) and the runner (A2) branch on the
same key. The runner reads `runtime` off the job spec and selects the executor. No new selector is invented.

The two branches are symmetric: A1 produces the runtime-specific half of `CompiledSpec` (`spec.workflow` vs
`spec.inference` vs `spec.script`); A2 consumes exactly that half in the matching executor. Ship them together per
runtime — a `spec.inference` with no executor to run it (or vice-versa) is dead weight.

**Two pieces move from shell to executor** (they are NOT runtime-invariant today, despite living in the shell):
- `_output_paths` → each executor declares its own output paths + kinds (ComfyUI's JSON shape is ComfyUI's
  business).
- the ComfyUI model-path convention inside `_ensure_models` → `executor.model_dest(model)` (the download
  machinery, locks, and parallelism stay shared; only the *destination* is per-runtime).

**The executor is not a new crystal noun.** Per ADR-0001 it is the pod-side *realization* of the existing
`Fundamentum.runtime` value — infrastructure, not a ring primitive. It gets no declined-Latin name; the ring
already names the relevant roles (`Procurator` procures the pod, `Praefectus` schedules it, `Cursor` adapts the
provider). The executor lives below all of them, on the pod.

### Part B — extend the type system for the new media

1. **`EssentiaCategoria`** — add `'3d'`. (`audio`/`video`/`text` already exist; only `3d` is missing.)
2. **Port-type canon** — add `'3d'` (mesh) to the documented `Porta.type` canon (`src/types/modus.ts:37`) **and**
   to the `VestigiumGenus` union (`src/types/vestigium.ts:37`, the hard one — TypeScript enforces this). Add its
   anchor icon + `normalizeType()` handling so the connection-validator and the FocusDemo/Window renderers accept
   it. (`audio`/`video` are already in both — no change needed for music.)
3. **Output materialization** — branch the run-completion sink on the output kind tagged by the executor:
   - `image` → unchanged (R2 + inline preview).
   - `audio` (`.mp3`) → R2 with audio content-type + Telegram audio/document delivery. **Plumbing only** (type
     vocab already covers it).
   - `3d` (`.glb`) → R2 as a model asset + document-attachment delivery (no inline preview; optional rendered
     thumbnail later).
4. **Essentia form half** — add optional non-ComfyUI form variants parallel to `workflowTemplate`:
   - `python-modelcard` form: `{ script, argMap: aditus→CLI-flags }`
   - `llm` form: `{ promptTemplate, genParams }`
   `workflowTemplate` stays for ComfyUI flows. The compiler picks the form by `Fundamentum.runtime` (same key as
   Part A).

**What we will NOT do:** we will not add a `Studio`/`Officina`-style new noun for the executor; we will not fork
`comfyrunner.py` per runtime; we will not collapse the three understanding flows into one `Essentia` (they are
distinct catalogued operations sharing a `Fundamentum`, which the family-shares-a-fundament model already
supports — ADR-0005).

## Consequences

**Easier:**
- A 6th model is "pick an executor (or write one) + seed an `Essentia`+`Fundamentum`" — never a runner fork.
- The billing-relevant shell (download locks, R2, webhooks, SSE, the `/install` live-apply path) is written
  **once** and proven once; new runtimes inherit it.
- The understanding track is one executor + one shared substrate for 3 flows — the cheapest to ship (text out →
  Part B items 1–3 don't even apply to it).

**Harder / costs:**
- Extracting cleanly means genuinely de-ComfyUI-ing the shell (`_output_paths`, `model_dest`) — the real work of
  the split, not a rename.
- Part B item 2 touches a strict union (`VestigiumGenus`) → the compiler will surface every exhaustive `switch`
  that must handle `3d`. Good (forcing function), but it's a spreading change.
- Two output-delivery branches (audio, mesh) per adapter (Telegram + API) — modest but real plumbing.

**Enforcement / follow-ups:**
- The executor interface is the contract; a pod-side smoke test per executor (`ensure_ready` + a trivial `run`)
  guards it.
- `Fundamentum.runtime` becomes load-bearing for dispatch — a registry/whitelist of known runtime→executor
  mappings, with an explicit error on an unknown runtime (no silent ComfyUI fallback).
- Build order (revised after the Compiler finding):
  1. **Seed the understanding catalog** — `qwen-vl-vllm` fundamentum + 3 Intellae + 3 Essentiae (`categoria:'text'`).
     **DONE 2026-06-11** (catalog-first, discoverable; cannot run until 2+3 land). Typecheck + compiler tests green.
  2. **Understanding runtime** — the symmetric pair:
     - **A1 (host) — DONE 2026-06-11.** `CompiledSpec` is now a structural union
       (`ComfyUICompiledSpec | InferenceCompiledSpec`, hash-stable ComfyUI member + `isInferenceSpec` guard);
       `Essentia.inferentia` form half added; `Compiler.compile` dispatches on `fundamentum.runtime`
       (`vLLM`/`llm` → `_compileInference`; unknown → `UNKNOWN_RUNTIME` throw). 12 new unit tests +
       13/13 ComfyUI regression + clean typecheck. (`src/crystal/Compiler.ts`, `src/types/essendi.ts`,
       `tests/unit/crystal/Compiler.inference.test.ts`.)
     - **A2.1 (pod, build) — DONE 2026-06-11.** `scripts/pod/runner.py`: the runtime-invariant shell
       (HTTP job server, queue, parallel download w/ per-dest locks + progress, R2, webhook, SSE) split from
       the `Executor` interface (`model_root`/`is_present`/`fetch_one`/`preflight`/`run→[{kind,path?/text?}]`),
       with `ComfyUIExecutor` (logic preserved from comfyrunner.py) + `VllmExecutor` (consumes `spec.inference`,
       builds an OpenAI chat-completions call, returns inline text). One executor per pod, selected at boot by
       `RUNNER_RUNTIME`. Output delivery branches on `kind` (file→R2 with audio/mesh content-types, text→inline).
       11 hermetic stdlib tests (`scripts/pod/test_runner.py`, fake executor — no GPU) + `py_compile` green.
       **`comfyrunner.py` left untouched** — still the live gen path.
     - **Compiler `repo` enrichment — DONE 2026-06-11.** Inference model refs now carry the HF `repo`
       (`sources[0].meta.repo`) for the vLLM executor's `huggingface-cli download`. Inference-path only —
       the ComfyUI spec stays byte-identical (proven: the sd15 test's base Intella carries `meta.repo`, yet
       its checkpoint entry has no `repo` key → hash-stable).
     - **A2.2a (host glue) — DONE 2026-06-11.** Guard split (finding #1, done as a *split* not a rename):
       `isCompiledSpec` is now the broad either-kind guard; added narrow `isComfyUISpec`/`isInferenceSpec`
       (comfyrunnerClient). `submitToRunner` routes by kind (`workflow` vs `inference` body, `models` w/ `repo`,
       `runtime`). `SecurePodClient`: `runtime` threaded into `_bootstrap` → `_bootstrapComfyUI` (byte-identical,
       live-safe) vs `_bootstrapVllm` (installs vllm+hf_hub, ships `runner.py`, `RUNNER_RUNTIME=vLLM`); the two
       broad-guard call sites (image/runtime reads) simplified. 8 new TS tests + clean typecheck.
     - **A2.2b (VRAM-budget harness manager) — DONE 2026-06-11.** `runner.py` rewritten from a single-executor
       dispatcher into a **multi-harness manager**: holds an `Executor` per runtime (`EXECUTORS`, vLLM/llm share
       one), runs as many harnesses as fit a VRAM budget, dispatching each job to its runtime's harness.
       The whole manager = `_pick_next_runnable` (pure decision) + `_schedule`/`_run_job`: evict idle-LRU-to-fit,
       never evict a busy harness (waiters queue), jobs run against whatever's resident (concurrency across
       distinct harnesses falls out free), wait queue ordered **shortest-expected-first with aging** (EWMA seeded
       priors; a fast vLLM request flies past a long ComfyUI job without starving it). `VllmExecutor` now owns its
       lifecycle (`load` downloads repo → `vllm serve` → wait; pins one model, relaunches on mismatch; `unload`
       frees VRAM). Executor lifecycle generalized to `load`/`run`/`unload` + `vram_gb`/`state`/`busy`. 18 hermetic
       tests (pure scheduler decisions + delivery + lifecycle), `py_compile` + `tsc` green. `_bootstrapVllm` env
       corrected (drop dead `RUNNER_RUNTIME`).
     - **A2.2c (cutover) — pending, GATED on a GPU pod.** Tune exact `vllm serve` flags + real VRAM/footprint
       numbers; FLUX/sd15 regression on `runner.py`; provision a vLLM pod → verify Qwen3-VL. Co-residency (both
       stacks on one pod) is a provisioning mode (install both) layered after.
  3. **Generation runtime** — `PythonModelcardExecutor` (A2) + Compiler `python-modelcard` branch + `script` form (A1).
  4. **Part B items 1–3** — `3d` categoria + `mesh` port/`VestigiumGenus` + audio/mesh delivery (gate Hunyuan3D).
  5. **Seed the 2 generation Essentiae + fundamenta + their `Intella` records** (incl. companions).
- **Note (the over-optimism corrected):** the triage called the understanding track "no type work, ships fastest."
  Half-right — it skips the *output*-type work (Part B 1–3), but the host-side Compiler is as ComfyUI-coupled as the
  pod, so it still needs the A1 branch + `llm` form. "Fastest" yes; "no type work" no.
