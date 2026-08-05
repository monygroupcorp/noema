# ADR-0008: Compositus execution — running a modus made of modi

- **Status:** proposed
- **Date:** 2026-06-17

## Context

ADR-0003 established the distillation: there is one primitive, `Modus`, and the two old
"higher-order features" are just shapes of it — **cook** is `Collectio` (a modus expanded over a
`Tractus[]` grid), **spell** is a `compositus` `Modus` (a modus whose body is other modi, wired by
`gradus` steps). The naming and types already exist (`modus.ts`, `collectio.ts`).

But only half of that is *executable* today:

- **Cook is built and proven.** `Collectio` + `TraitMixer.selectForPiece` + `CollectioCursor`
  (fan-out, concurrency, review/revive, pause/resume, restart-rehydrate) all live in `src/crystal/`
  and are wired into the ring. The webhook already routes a completed piece-Actum back to the cursor
  via `collectioRouter` → `CollectioCursor.onActumCompleta`, which dispatches the next piece.

- **Compositus is types-only.** `Modus.genus: 'compositus'` and `Gradus` exist, but nothing runs
  them: no cursor branches on the genus, `Compiler._compileComposed` is a comment, and — critically —
  **`Gradus` has no field expressing how a step's output feeds the next step's input.** The old bot
  did this with `parameterMappings` + a mutable `pipelineContext`; the crystal `Tabula` authoring
  layer expresses it as typed edges (`TabulaVinculum`). The published compositus modus has nowhere to
  carry that wiring.

The one missing capability is therefore: **execute a compositus modus, threading each step's `exitus`
into the next step's `aditus`, across the async pod-completion boundary.** Once it exists, "cook a
pipeline N times" falls out for free (`Collectio.modusId` points at a compositus), and the training
pipeline (`understand → train`) becomes an ordinary compositus rather than a bespoke feature.

## Decision

Build compositus execution as a **direct mirror of the proven cook machinery**. No new nouns; the
only type additions are one wiring field and one linkage field, both non-identity.

### 1. Step wiring lives on `Gradus` as `ligamina` (per-step input bindings)

```ts
export type GradusFons = { gradus: number; exitus: string }

export interface Gradus {
  ordine: number
  modusId: string
  condicio?: string
  parallel?: boolean
  /** Maps THIS step's aditus port → a prior step's exitus. Only cross-step wires
   *  need an entry; unlisted ports bind by name from the compositus modus's own
   *  aditus, then fall back to the child modus's Porta.default. */
  ligamina?: Record<string, GradusFons>
}
```

Resolution precedence for a step's input port, most specific first:
**explicit `ligamen` (prior step's exitus) > compositus modus `aditus` by matching name > child
`Porta.default`.** For `sd1-5 → upscale` the entire wiring is one entry:
`{ image: { gradus: 0, exitus: 'image' } }`. This is the distilled form of `TabulaVinculum`: the
Tabula→Modus publish compiler (a later step) emits `ligamina` from the canvas edges.

### 2. A compositus run is a parent Actum (cost-free umbrella) over child step Acta

The user casts a compositus and gets **one** run handle — a parent `Actum` whose `modusId` is the
compositus. It is an orchestration umbrella: it reserves/locks **zero** signa of its own. Each step is
its own real child `Actum` that goes through the normal cursor, locks and settles its own signa, and
carries the real spend, provenance, and vestigium. The parent's `impetus` accrues the running sum as
steps settle; its `exitus` becomes the final step's exitus; its status walks
`nascens → agens → completus`.

Child step acta carry the linkage:

```ts
// on Actum — set ONLY on compositus child steps
compositum?: { parentId: string; ordine: number }
```

This keeps the ledger honest (the user is charged per step, exactly what ran — no upfront whole-chain
lock) and needs **no new store**: a "run" is just the parent actum plus the child acta that reference
it. The completed child acta (`exitus`, `impetus`, `compositum.ordine`) are durable, so the chain's
*history* is reconstructable; the in-memory run state (current step, accumulated exitus, and the payer
credential `by`) is **not** persisted in v1, so an in-flight chain does not survive a process restart.
Durable rehydrate (persisting `by` + progress, mirroring `CollectioCursor.rehydrate()` scanning
`Collectio.acta`) is deferred to the surface phase — it's the one place a small run-anchor record may
earn its place, weighed then against the privacy partition (an Actum carries no identity, so `by`
cannot live there).

### 3. `CompositusCursor` is the engine; the webhook advances it

`dispatchInceptio` branches on `genus`: a `compositus` modus is handed to `CompositusCursor.start`
(which creates the cost-free parent actum and initiates step 0) instead of `cursorum.resolve` (which
would throw — a compositus has no `ministerium`). On each child step completion the execution webhook
routes back via a **`compositusRouter`** (sibling of the existing `collectioRouter`):
`CompositusCursor.onStepComplete(parentId, childActum, success)` reads the compositus `gradus`, threads
the completed step's exitus into the next step's aditus per its `ligamina`, initiates the next child —
or, on the last step, `completor.complete()`s the parent with the final exitus. A failed step fails
the parent (release-only; no charge for the unrun remainder).

### Scope — v1 (enforced, not silent)

- **Flat chains only — nesting is rejected up front.** A `gradus` whose modus is itself a
  `compositus` (incl. a self-reference) is refused at `start()` *before* any parent actum or spend,
  with a clear error — not silently deadlocked. The `Modus` type still permits unlimited fractal depth;
  the v1 *engine* does not, and says so. (Nested execution needs the inner parent's completion to
  notify the outer run — a later pass.)
- **`condicio` is rejected up front** (not silently ignored — skipping a step the author meant to gate
  is a correctness change). `parallel` is accepted but runs sequentially (a valid, if slower,
  execution — no correctness change).
- **No upfront whole-chain *lock*.** Each step balance-checks at its own initiate; the first
  unaffordable step fails the chain. (Matches cook, which also charges per piece.) The storefront
  "this pipeline costs ~X" price IS implemented as a **quote** — `CrystalApi._estimate` sums each
  step's `reserve` for a compositus (`Σ` step estimates), in the estimation layer where cold-start /
  GPU-fit reasoning belongs, decoupled from billing. It is an estimate, not a guarantee:
  `ligamina`-fed inputs aren't known until run time.
- **No durable in-flight rehydrate.** Run state (incl. the payer `by`) is in-memory; a restart drops
  in-flight chains. The startup expired-acta sweep now fails the parent + frees state for any
  recovered compositus step (parity with `CollectioCursor`'s recovery cadence). See the note above.
- **No Tabula→compositus publish compiler, and no API/MCP/Telegram surface yet.** The engine is proven
  hermetically first (see Consequences), then surfaced.

## Consequences

- **Easier:** spells, the training pipeline, and cook-over-pipeline all become the same one engine.
  Cook needs zero new code to run a compositus. Each step remains a first-class Actum, so saving,
  ledger, royalties, and vestigium work per-step with no special cases.
- **Harder / watch:** two execution layers now exist (parent umbrella + child steps); anything that
  scans acta (status, indexes, `/status`) must not double-count the cost-free parent. The privacy
  partition holds — `compositum` is two actum ids, no identity.
- **Enforced by:** hermetic tests (`CompositusCursor.test.ts`) — a 2-step compositus (`a → b`) through
  `FakeCursor`s asserts `b` receives `a`'s exitus via `ligamina`, the parent completes with `b`'s
  exitus, and parent impetus equals the children's sum; plus a nested-step rejection, a `condicio`
  rejection, and a failing-step-fails-the-parent (+ frees state) case. The production async path is
  verified by code review: `compositum` round-trips `MongoActorum` create→complete→update (spread
  serialization, not a field whitelist), so the webhook routes on it.
- **Follow-ups (in order):** (1) the engine + hermetic proof; (2) an `upscale` atomic essentia
  (workflow template + intella) — none exists yet; (3) the seeded `sd1-5 → upscale` canonical
  compositus, verified live on staging (keeps the rented pod hot across both steps); (4) Tabula→Modus
  publish compiler (canvas edges → `ligamina`); (5) `/spell` + `/cook` surface across REST/MCP/Telegram;
  (6) `parallel`/`condicio`, whole-chain quote.
