# ADR-0001: Speak the crystal — no new nouns

- **Status:** accepted (the "studio base" clause is **superseded by ADR-0005**)
- **Date:** 2026-06-05

> **Update (ADR-0005, 2026-06-09):** the clause below ruling studio-base a *presentation-only*
> concept (`ArmPreset`→`StudioBase`, "not a domain noun") is superseded. Deeper analysis showed
> `Essentia.runpodSpec` was a provider-poisoned, scope-conflated encoding of a genuinely missing
> **crystal-core** primitive — now `Fundamentum` (ADR-0005). The rest of this ADR stands: speak the
> crystal, "flow" === `Modus`/`Essentia`, "studio" === `Materia`, single-source `runtime`, and the
> ban on a redundant `Workflow`/`Studio` type.

## Context

The domain model ("the crystal") is a small set of Latin-declined nouns (`Intella`, `Modus`/`Essentia`
in `Modorum`, `Materia`, `Cursor`, `Actum`, `Aditus`/`Exitus`, …) documented in
the crystal type definitions in `src/types/index.ts`. A 2026-06-05 audit found the adapter layer had
begun inventing a **parallel vocabulary** — most notably an `ArmPreset` "flow" (a base-family + image +
runtime derived from `Intellarum`) that collides with the crystal's "flow" (`Essentia`/`Modus`). Two
things called "flow"; `runtime` defined in five places. This obscures the fundament.

## Decision

**Speak the crystal; add no new nouns.** The existing primitives cover what we need; the job is to use
them consistently in adapters — not extend them.

- **"flow" === `Essentia`/`Modus`** (a `Modorum` entry). Never a UI preset.
- **"studio" === `Materia`** (+ `Hospitium`). Not a new type.
- **"studio base"** = the adapter object `/arm` composes from (image + runtime + base/support
  `Intella`e). Rename `ArmPreset` → `StudioBase`; it is presentation, not a domain noun.
- **`runtime`** is canonical on `RunpodSpec.runtime`; derive it in exactly one place.
- **Do NOT introduce** a `Workflow` / `StudioBlueprint` / `Studio` *type* — that was the audit's
  instinct and is precisely the needless abstraction this ADR forbids.

Presentation projections of crystal types (`PendingModel`, `Loadout`, `ModelDetail`, `PickerState`)
are fine — they render the model, they don't redefine it.

## Consequences

- The crystal-alignment passes (rename `ArmPreset`→`StudioBase`; single-source `runtime`; ground
  `listFlows`/studio-bases in `Modorum`) are the cleanup that closes this. Tracked in the
  command/flow strategy.
- Enforcement: code review + `tests/unit/architecture/boundaries.test.ts` (boundary half).
- A flow owns its studio via the existing `Essentia.runpodSpec` → `Materia` chain — no new noun needed.
