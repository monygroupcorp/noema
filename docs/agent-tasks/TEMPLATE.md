# TASK-NNN: <imperative title>

- **Status:** ready | in-progress | blocked | done
- **Owner:** <agent/none>
- **Gated by:** <none | the thing that must happen first, e.g. a GPU>

## Read first
The exact files to read before writing anything (the working example + the contracts):
- `AGENTS.md`, `docs/adr/0001-crystal-naming-no-new-nouns.md`
- <task-specific files with paths>

## Deliverables
Concrete artifacts to produce, each with its file path and shape. Reuse existing patterns/utilities;
add no new nouns (ADR-0001).

## Acceptance (hermetic — this is "done")
The checks that must pass with no live DB / no secrets / no GPU:
- `npx tsc --noEmit` clean
- `npm run test:unit` green (+ any task-specific test named here)

## Verify
Exact commands to run.

## Out of scope / gated
What this task does NOT cover — esp. anything needing a real pod/GPU (→ staging) or another task.
