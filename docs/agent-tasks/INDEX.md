# Agent task board

Tasks follow `TEMPLATE.md`. A task is **done** when its hermetic acceptance passes; anything needing a
real GPU/pod is validated separately on staging. Read `AGENTS.md` first.

| ID | Title | Status | Gated by |
|---|---|---|---|
| [TASK-001](TASK-001-gen-sd15.md) | Add the SD1.5 txt2img gen-flow (Essentia + template) | done | — (real gen → staging) |
| [TASK-002](TASK-002-run-resolver.md) | `/run <flow> [prompt]` — the universal flow runner | done | — |
| [TASK-003](TASK-003-canon-verb-table-rebind.md) | Canon-verb default table + per-user rebind (the seam) | ready | — (persistence → staging) |

## Backlog (not yet written as specs)
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
