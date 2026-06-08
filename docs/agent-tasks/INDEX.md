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
| [TASK-006](TASK-006-save-as.md) | Save-as — flow card / delivery-info menu → a derived `Modus` (owner-keyed persistence) | ready | — (Mongo `auctor` + e2e → staging) |

## Backlog (not yet written as specs)
- **Verb-rebind persistence wiring** — sibling follow-up on TASK-006's `auctor` foundation: wire
  TASK-003's `resolveVerb`/`bindVerb` to the owner-keyed store. See ADR-0003.
- **TASK-007 · Prompt affixes** — `Porta.praefixum`/`suffixum` woven at compile via the `TraitMixer`
  seam, surfaced in the Save-as menu. Purely additive on TASK-006 (sets fields TASK-006 leaves unset).
- **Trigger-resolution convergence** — once `familia` is populated (TASK-005), drop
  `BulletinModelCatalog`'s tag-derived family workaround and converge its `resolveTriggers(…,{family})`
  onto the crystal `triggerMap(familia)` (its own "swap once it's set" TODO). Allocutio ring; follow-up.
- **Verb-binding persistence** — widen `Modus.auctor` to `{animaId}|{commitment}` (anon-capable),
  re-home preferences (`affines` + verb-bindings) under that owner key, wire `resolveVerb`/`bindVerb`
  (the TASK-003 follow-on; non-hermetic → staging). No new nouns. See ADR-0003.
- **`aditus` parameter panel** — render an editable form from `Modus.aditus` (every `Porta`, not just
  `prompt`); the simple verb is the degenerate case. The foundation for saved versions. See ADR-0003.
- **Saved versions = derived `Modus`** — "save as my version" registers a user-owned Modus
  (`auctor`, `canonica:false`, pinned `Porta.default`s); edit = re-register w/ bumped `versio`. See ADR-0003.
- **`/cook` (Collectio)** — `Modus × Tractus[]` grid → N `Acta` via `TraitEngine` + `CollectioCursor`.
- **`/spell` (compositus `Modus`)** — run/author a `gradus`-chained flow (authored via `Tabula`).
- Gen-flows for other catalog bases (SDXL, Illustrious, …) — same shape as TASK-001, **gated on
  acquiring those base weights** (only FLUX + SD1.5 have weights today).
- Crystal-alignment passes (rename `ArmPreset`→`StudioBase`; single-source `runtime`; ground
  studio-bases in `Modorum`) — see ADR-0001.
- Per-user verb rebind UI/settings flow (beyond the `/bind` command seam in TASK-003).
