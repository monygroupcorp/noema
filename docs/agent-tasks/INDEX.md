# Agent task board

The durable, cross-session source of truth for what's done, what's ready to pick up, and what's queued.
**A fresh session should:** read `AGENTS.md` → this board → the chosen task's `TASK-NNN-*.md` spec (which is
self-contained: Read-these-files → Deliverables → Acceptance → Out-of-scope). Tasks follow `TEMPLATE.md`.

**Lifecycle:** a Backlog item graduates to a numbered `TASK-NNN` spec when picked up → **ready** → **done**
when its hermetic acceptance passes. "live ✓" = also confirmed on real staging hardware. Anything needing
a GPU/pod or real Mongo is validated on staging (or `test:crystal` locally), not the hermetic gate — see
[[feedback_local_integration_repro]] for why DB/compile-time bugs get a local repro, not a staging trip.

## Shipped (TASK-002→011 — the command-flow + flow-authoring + LoRA + preferences + bulletin stack)

| ID | Title | Status |
|---|---|---|
| [TASK-001](TASK-001-gen-sd15.md) | SD1.5 txt2img gen-flow (Essentia + template) | done · live ✓ |
| [TASK-002](TASK-002-run-resolver.md) | `/run <flow> [prompt]` universal runner | done · live ✓ |
| [TASK-003](TASK-003-canon-verb-table-rebind.md) | Canon-verb default table + rebind seam | done |
| [TASK-004](TASK-004-flow-card-aditus-panel.md) | Flow card — surface every `Porta`, execute when ready | done · live ✓ |
| [TASK-005](TASK-005-intellae-manifest.md) | `intellae` manifest + `familia` (drop `intellaId`) | done · live ✓ |
| [TASK-006](TASK-006-save-as.md) | Save-as → derived `Modus` (owner-keyed persistence) | done · live ✓ |
| [TASK-007](TASK-007-prompt-affixes.md) | Prompt affixes — flow-baked prefix/suffix | done · live ✓ |
| [TASK-008](TASK-008-sd15-loracapable.md) | LoRA-apply layer — `customNodes` + cozyness chain | done · live ✓ |
| [TASK-009](TASK-009-run-resolves-owned-flows.md) | `/run` resolves a user's own saved flows | done · live ✓ |
| [TASK-010](TASK-010-verb-rebind-store.md) | `/bind` rebind persisted via `Consuetudo` | done · live ✓ |
| [TASK-011](TASK-011-bulletin-render-serialization.md) | Serialize bulletin renders (provisioning play-by-play) | done · live ✓ |
| [TASK-012](TASK-012-test-crystal-in-ci.md) | Add `test:crystal` (DB layer) to CI | done |

## Ready (specced — pick up next)

_None — pick up a Backlog item below and graduate it to a numbered TASK spec._

## Backlog — Bugs / Polish
- **Save-as collision kicks you out of the menu** — on a name collision the menu reports "name taken"
  but **ends the draft**; the host has to start the whole Save-as over. Should re-prompt for a new name
  *in place* (keep the draft + its prefix/suffix/prompt-mode). Small `SaveAsMenu` fix.
- **Save-as menu polish (bigger, future)** — once flows expose **all their knobs as inputs** (the full
  `aditus` Porta set, not just prompt), the Save-as review will have many pieces (per-Porta values,
  pin/affix per field, model loadout). Needs a deliberate UX pass then — pagination/sectioning, clear
  pin-vs-open per knob. Revisit when the param-rich flows land.

## Backlog — Features
- **`/cook` (Collectio)** — `Modus × Tractus[]` grid → N `Acta` via `TraitEngine` + `CollectioCursor`.
- **`/spell` (compositus `Modus`)** — run/author a `gradus`-chained flow (authored via `Tabula`).
- **Gen-flows for more catalog bases** (SDXL/Illustrious/Chroma/Flux-Kontext/Wan-video/…) — port from
  `docs/reference/old-workflows/` per the INVENTORY; gated on the comfydeploy **custom-node pack manifest**
  (pull via API) + base weights. Same shape as TASK-001/008.

## Backlog — Follow-ups / cleanup
- **Trigger-resolution convergence** — drop `BulletinModelCatalog`'s tag-derived family workaround now
  that `familia` is populated; converge its `resolveTriggers(…,{family})` onto crystal `triggerMap(familia)`.
- **Re-home `Anima.affines` onto `Consuetudo`** — one owner-keyed home for all account preferences.
- **Crystal-alignment passes** — rename `ArmPreset`→`StudioBase`; single-source `runtime`; ground
  studio-bases in `Modorum` (ADR-0001).
- **Per-user verb-rebind UI/settings flow** — beyond the `/bind` command seam.
