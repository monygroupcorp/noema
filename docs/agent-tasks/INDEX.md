# Agent task board

Tasks follow `TEMPLATE.md`. A task is **done** when its hermetic acceptance passes; anything needing a
real GPU/pod is validated separately on staging. Read `AGENTS.md` first.

| ID | Title | Status | Gated by |
|---|---|---|---|
| [TASK-001](TASK-001-gen-sd15.md) | Add the SD1.5 txt2img gen-flow (Essentia + template) | done | — (real gen → staging) |
| [TASK-002](TASK-002-run-resolver.md) | `/run <flow> [prompt]` — the universal flow runner | done | — |

## Backlog (not yet written as specs)
- Gen-flows for other catalog bases (SDXL, Illustrious, …) — same shape as TASK-001, **gated on
  acquiring those base weights** (only FLUX + SD1.5 have weights today).
- Crystal-alignment passes (rename `ArmPreset`→`StudioBase`; single-source `runtime`; ground
  studio-bases in `Modorum`) — see ADR-0001.
- Command/flow layer (canon-verb default table, per-user rebind) — `/run` resolver done (TASK-002).
