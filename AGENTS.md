# AGENTS.md — start here

This repo (`noema-crystal`) is built on a small, deliberate domain model called **the crystal**
(Latin-declined nouns). Most drift comes from inventing parallel vocabulary in the adapter layer.
**Your job: speak the crystal, add no new nouns.**

## Start here (read in order)

1. `docs/north-star.md` — the principles ("build for the full case; the simple case is a config").
2. `docs/crystal-master-plan.md` — the canonical primitives + ring architecture.
3. `src/types/index.ts` — the Latin declension rules (store names = genitive plural).
4. `docs/adr/` — the durable decisions (naming, boundaries) you must honor.
5. `docs/agent-tasks/INDEX.md` — the task board; pick a task, follow its spec.

> Note: `docs/plans/` is **local scratch (gitignored)** — not authoritative. Durable decisions live
> in `docs/adr/`; executable work lives in `docs/agent-tasks/`.

## The crystal dictionary (use these words, only these)

| Word | Crystal type | Means |
|---|---|---|
| **model** | `Intella` / `Intellarum` | a weight (base / lora / embedding) |
| **flow** | `Essentia` / `Modus` (a `Modorum` entry) | an executable workflow — `/make`, `/run` target |
| **studio** | `Materia` (+ `Hospitium`) | a warm GPU pod with installed models |
| **studio base** | adapter `StudioBase` (today `ArmPreset` — rename pending) | what `/arm` composes: image + runtime + base/support `Intella`e |
| **run** | `Actum` | one flow execution |
| **runtime** | `string`, **canonical on `RunpodSpec.runtime`** | the on-pod server (ComfyUI / llama.cpp / …) |
| **dispatch** | `Cursor` / `Cursorum` | the execution backend (RunPod, OpenAI, …) |
| **compile** | `Compiler` → `CompiledSpec` | flow + `aditus` → pod job |

**Rules:** "flow" means an `Essentia`/`Modus` — never a UI preset. Do **not** introduce a
`Workflow`/`Blueprint`/`Studio` *type*; `studio`=`Materia`, `flow`=`Essentia`. See ADR-0001.

## Module boundaries

- `src/crystal/` — the ring core, **platform-neutral**. Must **NOT** import `src/allocutio/`.
  (Enforced by `tests/unit/architecture/boundaries.test.ts`.)
- `src/allocutio/` — platform adapters (Telegram, …). Translates platform ↔ crystal. May hold
  presentation projections (`PendingModel`, `Loadout`, `ModelDetail`, `PickerState`) — not domain.
- See ADR-0002.

## The hermetic verify loop (no live DB, no secrets) — the agent gate

Run before claiming done — this is the gate CI's `verify` job runs:

```bash
npm run typecheck       # tsc --noEmit (src/)
npm run test:hermetic   # adapter + architecture/boundary + template/install guards — NO live DB
```

**Reality check (verified 2026-06-05):** the *full* crystal/ledger suite is **NOT** hermetic — much of
it needs a live MongoDB via `.env` (`npm run test:crystal` runs it through `scripts/run-with-env.sh`;
`tests/integration` likewise). So those are NOT part of the agent gate — run them locally with a
real `.env`, and CI's integration job covers them. The hermetic gate above is what an agent verifies
autonomously. Fake-mode bot (manual E2E): `./scripts/run-fake.sh` (needs `.env.fake`).

## How to pick up a task

Tasks live in `docs/agent-tasks/` and follow `TEMPLATE.md`: **Read-these-files → Deliverables →
Acceptance (hermetic) → Verify (commands) → Out-of-scope/gated.** A task is done when its hermetic
acceptance passes — anything needing a real GPU/pod is explicitly out of scope (staging).

## Orchestration recipe (Claude Code workflows/subagents)

For a multi-part sprint:
1. **Decompose** into file-scoped units (e.g. one flow per agent).
2. **Fan out** parallel subagents — use `isolation: worktree` when they mutate files concurrently.
3. Each subagent **verifies via the hermetic loop** + any task-specific test (e.g. the
   workflow-template integrity test) before returning.
4. **Synthesize/integrate**, then a final full-sweep verify.

Worked example: the **gen-workflow** fan-out — one agent per flow (SD1.5 first; SDXL/Illustrious as
weights land), each emitting an `Essentia` + a `workflows/<id>-v<v>.json` template, gated by
`tests/unit/crystal/workflowTemplates.test.ts`. The output is *artifacts that pass hermetic checks* —
real gen correctness is validated on staging (a GPU), never claimed from a hermetic run.
