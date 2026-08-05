# ADR-0002: The ring↔allocutio boundary

- **Status:** accepted
- **Date:** 2026-06-05

## Context

`docs/north-star.md` defines two layers: the **ring** (the crystal core — primitives, execution,
dispatch) and **allocutios** (platform adapters — Telegram today; Discord/web/API later). The ring is
platform-neutral; an allocutio translates a platform's native interaction model into the ring's
language and back. This was documented but enforced only by convention — nothing stopped a crystal
module importing adapter code, which would couple the core to a platform.

## Decision

- **`src/crystal/**` must NOT import `src/allocutio/**`.** The ring stays platform-neutral.
- Adapters (`src/allocutio/**`) depend on the ring, never the reverse.
- Identity stays off the pod: `Materia` is identity-blind; host/guest identity lives in `Hospitium`
  (side-table), surfaced late via `pod.parked`.
- Platform-specific presentation types (e.g. the bulletin's `PendingModel`/`Loadout`/`PickerState`)
  live in the allocutio layer, not in `src/types/` or `src/crystal/`.

## Consequences

- Enforced mechanically by `tests/unit/architecture/boundaries.test.ts` (runs in `test:unit` + CI).
- A deliberate `allocutio` import inside a `crystal` file fails the gate.
- New adapters (Discord/web) reuse the ring without touching it; the crystal never learns about a
  platform.
