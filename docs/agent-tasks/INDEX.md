# Agent task board

Tasks follow `TEMPLATE.md`. A task is **done** when its hermetic acceptance passes; anything needing a
real GPU/pod is validated separately on staging. Read `AGENTS.md` first.

| ID | Title | Status | Gated by |
|---|---|---|---|
| [TASK-001](TASK-001-gen-sd15.md) | Add the SD1.5 txt2img gen-flow (Essentia + template) | done | — (real gen → staging) |
| [TASK-002](TASK-002-run-resolver.md) | `/run <flow> [prompt]` — the universal flow runner | done | — |
| [TASK-003](TASK-003-canon-verb-table-rebind.md) | Canon-verb default table + per-user rebind (the seam) | done | — (persistence → staging) |
| [TASK-004](TASK-004-flow-card-aditus-panel.md) | The flow card — surface every `Porta`, execute when ready | done | — |
| [TASK-005](TASK-005-intellae-manifest.md) | `intellae` manifest + `familia` — flow declares its weights; family drives LoRA compat (drop `intellaId`) | done | — (Mongo re-key + install → staging) |
| [TASK-006](TASK-006-save-as.md) | Save-as — flow card / delivery-info menu → a derived `Modus` (owner-keyed persistence) | done* | *hermetic done; Mongo `auctor` + e2e `/run <slug>` pending staging. "save as verb" rides the verb-rebind wiring follow-up |
| [TASK-008](TASK-008-sd15-loracapable.md) | Port the LoRA-apply layer — `customNodes` plumbing + cozyness LoRA chain | done* | *hermetic done; real on-pod LoRA apply (Coziness installs per-job) → staging |
| [TASK-009](TASK-009-run-resolves-owned-flows.md) | `/run` resolves a user's own saved flows (staging fix — `canonica` filter rejected them) | done* | *hermetic done; real `list({auctor})` → staging |
| [TASK-010](TASK-010-verb-rebind-store.md) | Wire `/bind` rebind to a persistent owner-keyed store (`Consuetudo`) | done* | *hermetic done; Mongo + real `/bind`→`/make` → staging |
| [TASK-007](TASK-007-prompt-affixes.md) | Prompt affixes — flow-baked prefix/suffix on a text `Porta` (finishes save-a-style) | done* | *hermetic done; real gen → staging |
| [TASK-011](TASK-011-bulletin-render-serialization.md) | Serialize bulletin renders (fix scrambled provisioning play-by-play) | done* | *hermetic done; visual confirm → staging |

## Backlog (not yet written as specs)
- **Trigger-resolution convergence** — now that `familia` is populated (TASK-005/008), drop
  `BulletinModelCatalog`'s tag-derived family workaround and converge its `resolveTriggers(…,{family})`
  onto the crystal `triggerMap(familia)` (its own "swap once it's set" TODO). Allocutio ring; follow-up.
- **Re-home `Anima.affines` onto `Consuetudo`** — fold per-modus param overrides into the owner-keyed
  store (TASK-010) so all account preferences share one anon-capable home. `Consuetudo` is shaped for it.
- **`/cook` (Collectio)** — `Modus × Tractus[]` grid → N `Acta` via `TraitEngine` + `CollectioCursor`.
- **`/spell` (compositus `Modus`)** — run/author a `gradus`-chained flow (authored via `Tabula`).
- Gen-flows for other catalog bases (SDXL, Illustrious, …) — same shape as TASK-001, **gated on
  acquiring those base weights** (only FLUX + SD1.5 have weights today).
- Crystal-alignment passes (rename `ArmPreset`→`StudioBase`; single-source `runtime`; ground
  studio-bases in `Modorum`) — see ADR-0001.
- Per-user verb rebind UI/settings flow (beyond the `/bind` command seam in TASK-003).
