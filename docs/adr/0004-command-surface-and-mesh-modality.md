# ADR-0004: The command surface = capability signatures (+ the `mesh` modality)

- **Status:** accepted
- **Date:** 2026-06-05

## Context

Settling the canon-verb taste map (the curated commands over an infinity of flows — see
[[command-flow-strategy]] and ADR-0003). A verb is an *intent*, not a flow. The risk surfaced while
mapping: verbs were proliferating into **conditioning flavors** — `make`/`effect`/`direct`/`compose`
were being spent on ControlNet, reference-image, inpaint, instruction-edit — which are all the *same
capability signature* (still image-from-image+text). That wastes the good verbs and pollutes the
surface.

## Decision

**A verb maps to one capability signature `[input modalities] → [output categoria]` — never to a
conditioning variant.**

1. **One verb per signature.** `make` = t2i, `effect` = i2i, `animate` = i2v, `direct` = t2v,
   `compose` = t2a·music, etc. The full map is `docs/capability-map.md`.

2. **Conditioning variants are flows, not verbs.** ControlNet, reference image, inpaint/outpaint,
   instruction-edit are all `i2i+`/`t2i+` — same signature, different conditioning. They are reached
   by binding a verb's default to a custom flow, saving a version, or building a flow — i.e. the
   ADR-0003 preference/saved-version layer. **Verbs never multiply by conditioning.** (Example: "make
   with ControlNet" = `make` rebound to a flux-controlnet flow with a pinned reference image — zero
   new verbs.)

3. **Output flavor *does* distinguish; conditioning does not.** speech / sfx / music are genuinely
   different *outputs*, so they earn distinct verbs (`speak` / `foley` / `compose`). This is unlike
   conditioning, which yields the same output differently steered. Audio sub-flavors are intent-level
   distinctions, not separate `EssentiaCategoria` values.

4. **`mesh` is the fifth creative modality.** Add `'mesh'` to `EssentiaCategoria` (`essendi.ts`) and
   to the canonical `Porta.type` set (`modus.ts`) — the latter so 3D assets pipe between modi
   (`lift → render` needs the intermediate typed). **No new noun; two enum values.** Chose `mesh` over
   `model` (collides with `Intella` = "model"/weights) and over the broader `3d`. This also dissolves
   the `m`=music shorthand clash: music is a flavor of `audio`, not a categoria, so `mesh` owns `m`.

5. **Canon is the high-traffic subset; the rest reach via `/run`; dormant verbs sit in the attic.**
   The canon verbs cover the high-traffic signatures. Lower-traffic cells (`v2t`, `v2i`, `v2v`, `v2a`,
   `a2a`, `a2v`, `mesh2mesh`) are reachable via `/run <flow>` for now and may be **promoted** to verbs
   later. A canon verb with no good flow yet stays **defined but dormant ("attic")** — only `make` and
   `chat` are live today; every other verb is gated on its default Essentia + workflow template
   existing (one gen-flow task each, à la TASK-001).

6. **Parked signatures:** `i2a`, `a2i`, `mesh2t` (niche — revisit). **Not-a-thing:** `a2mesh`,
   `mesh2a`.

## Consequences

- **The capability map *is* the gen-flow backlog.** Each "planned" verb becomes a TASK when its
  weights/runtime land. `docs/capability-map.md` carries the live status.
- `CANON_VERBS` (TASK-003) seeds **only live verbs** (`make`→`flux-schnell`, `chat`→`modus.chatgpt`);
  planned verbs are added one-by-one as their flow ships — no dead entries pointing at missing modi.
- Higher-order verbs are unaffected: `/cook` (→ `Collectio`) and `/spell` (→ `compositus Modus`) are
  orthogonal to this signature map (ADR-0003 §"two execution shapes").
- This is the [[feedback_crystal_first_buildout]] discipline applied: the conditioning explosion
  collapsed into the existing flow/preference layer instead of new verbs; the only crystal addition is
  one modality's two enum values.
