# AGENTS.md — start here

This repo (`noema-crystal`) is built on a small, deliberate domain model called **the crystal**
(Latin-declined nouns). Most drift comes from inventing parallel vocabulary in the adapter layer.
**Your job: speak the crystal, add no new nouns.**

## Start here (read in order)

1. `docs/north-star.md` — the principles ("build for the full case; the simple case is a config").
2. `src/types/index.ts` — the Latin declension rules (store names = genitive plural).
3. `docs/adr/` — the durable decisions (naming, boundaries) you must honor.
4. `docs/capability-map.md` — the signature matrix + canon verbs (command surface + gen-flow backlog).

> Note: durable decisions live in `docs/adr/` — those are the ones you must honor. A task spec is
> supplied with the assignment; it is not authoritative over an ADR.

## The crystal dictionary (use these words, only these)

| Word | Crystal type | Means |
|---|---|---|
| **model** | `Intella` / `Intellarum` | a weight (base / lora / embedding) |
| **flow** | `Essentia` / `Modus` (a `Modorum` entry) | an executable workflow — `/make`, `/run` target |
| **studio** | `Materia` (+ `Hospitium`) | a warm GPU pod — the live *instance* of a `Fundamentum` |
| **fundament** | `Fundamentum` / `Fundamentorum` | provider-neutral compute substrate: image + runtime + base/support `Intella`e + capacity (ADR-0005). A flow references one version-pinned; a family shares it |
| **studio base** | adapter view-model `StudioBase` — a presentation projection *of* a `Fundamentum` | what `/arm` shows: a card for a fundament, projected from the `Fundamentorum` registry |
| **run** | `Actum` | one flow execution |
| **runtime** | `string`, **canonical on `Fundamentum.runtime`** | the on-pod server (ComfyUI / llama.cpp / …) |
| **dispatch** | `Cursor` / `Cursorum` | the execution backend (RunPod, OpenAI, …) |
| **compile** | `Compiler` → `CompiledSpec` | flow + `aditus` → pod job |

**Rules:** "flow" means an `Essentia`/`Modus` — never a UI preset. Do **not** introduce a
`Workflow`/`Blueprint`/`Studio` *type*; `studio`=`Materia`, `flow`=`Essentia`, `substrate`=`Fundamentum`.
See ADR-0001 + ADR-0005 (why `Fundamentum` is the one sanctioned new primitive — it un-poisons the
provider-named `runpodSpec`, it does not invent a parallel vocabulary).

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

A task spec follows a fixed shape: **Read-these-files → Deliverables → Acceptance (hermetic) →
Verify (commands) → Out-of-scope/gated.** A task is done when its hermetic acceptance passes —
anything needing a real GPU/pod is explicitly out of scope (staging).

## Deploying to staging (staging.noema.art)

Staging = the `chainengine-migration` branch, deployed to a droplet. **Full runbook:
`docs/ops/staging-deploy.md` — read it before deploying** (there are stale duplicate
configs in the repo and on the box that WILL mislead you).

TL;DR:
1. `git push origin HEAD:staging` (staging fast-forwards from `chainengine-migration`) → CI
   builds `ghcr.io/monygroupcorp/noema:staging`. Wait for green: `gh run list --branch staging -L1`.
2. `ssh noema 'cd /opt/noema && ./deploy-staging.sh'` — pulls the image, recreates the
   `hyperbot-staging` container, health-checks.
3. Verify: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' https://staging.noema.art/` → `200`.

**Source of truth is `/opt/noema/` ON THE DROPLET** (ssh host `noema` in `~/.ssh/config`), NOT
the repo and NOT `/root`. Container `hyperbot-staging` on net `hyperbot_network`. The React
frontend (`src/platforms/web/app`) is served by the crystal server (`src/index.ts`, before
`app.listen`) only when **`STAGING_FRONTEND=1`** (already in `/opt/noema/.env.staging`).
Deploy is **manual on purpose** — no CI auto-deploy, so parallel work isn't clobbered.

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
