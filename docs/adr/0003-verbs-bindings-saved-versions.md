# ADR-0003: Verbs, bindings, and saved versions — the parameter/preset layer

- **Status:** accepted
- **Date:** 2026-06-05
- **Revised:** 2026-06-05 — replaced the "new `Anima.verba` field" instinct with the owner-keyed
  preference model below, after a principled pass (preserve crystal core, minimize surface area).

## Context

The command surface is a small set of **canon verbs** (`make`, `effect`, `direct`, `compose`,
`animate`, … — intents, not flows) plus the universal runner `/run <flow>` (ADR-implicit, shipped in
TASK-002). Two things needed grounding before we build the layer out:

1. **Flows take many inputs, not just `prompt`.** Every `Modus.aditus` is a `Forma =
   Record<string, Porta>`, and each `Porta` already declares `{ type, required, default, label,
   description }`. So "let users change ANY config parameter" is a **rendering** problem (a form over
   `aditus`), not a modeling one. `/make a cat` is the degenerate case: fill the one `required: true`
   text Porta, default the rest. This is the north-star ("build for the full case; the simple case is
   a config") already expressed in the type.

2. **Two higher-order verbs** (batch/cook, spell) already have crystal homes — `modus.ts` says so:
   *"This single primitive replaces what were previously called 'tools' (atomic), 'spells' (sequential
   compositions), and 'cook' (batch/expression grids)."*
   - **cook/batch** → `Collectio` (`collectio.ts`): `Modus × Tractus[]` grid → N `Acta`, via
     `TraitEngine` + `CollectioCursor`.
   - **spell/flow-combo** → a **`compositus` `Modus`** (`gradus` steps + `condicio`), authored
     visually as a `Tabula` that publishes into that Modus.

The open question was **where each kind of user customization lives**, given ADR-0001 forbids new
nouns.

## Decision

The customization layer is **one substance — user-saved modus configuration — at three altitudes**,
not three separate inventions. The altitudes form a pointer chain, each link already a crystal citizen:

```
verb  ─points at─→  flow (Modus)  ─configures─→  porta (params)
/make               sd1-5                        steps=8, cfg=2
```

They compose along the precedence chain already documented on `Anima.affines`:

> **cast-time input > saved overrides > verb binding > modus defaults**

1. **Parameter surface = `Modus.aditus` (`Porta`).** Surfacing "any parameter" is an adapter view
   that renders one field per `Porta`, prefilled from `Porta.default`. No new type. The simple verb
   (`/make <prompt>`) pre-fills the required Porta and defaults the rest.

2. **A named saved version = a derived `Modus`** (the **full case**, chosen 2026-06-05). It is a
   real `Modorum` entry: `canonica: false`, the tweaks baked into the `Porta.default`s — shareable,
   versioned, content-addressed, royalty-able via the `fonteId`/fork chain. **Editing it is
   `register()` with a bumped `versio` + recomputed `contentHash`, never `Modorum.update()`**
   (`update()` deliberately only accepts non-definitional fields). The content-addressing *is* the
   feature: a quote always matches the exact flow that ran. `/run <my-slug>` runs it; `/flows` browses
   it for free.

3. **Ownership is `{ animaId } | { commitment }` — reused, not invented.** This union already exists
   in `Collectio.by`. Identified souls own by `animaId`; **anonymous users own by their arcanum
   `commitment` (H(secret))** — the load-bearing requirement, since the anon side has no `anima`.
   - **Widen `Modus.auctor`** from `string` to this union, so a user-owned saved flow works for anon
     and identified alike. A field-type change adopting a shape the crystal already uses — **not a new
     noun.**
   - **Lift preferences off `Anima` onto the same owner key.** `Anima.affines`
     (`{ [modusId]: { [inputKey]: override } }`) is the sticky per-flow param cache — but on `anima`
     it cannot reach anon users. Re-home it (and its peers) under the `{animaId}|{commitment}` owner.

4. **Verb→flow binding = a peer of `affines`, same shape, one altitude up.** It is the *only* new
   state, and it is NOT a bespoke field: `affines` = `{ modusId → {key→val} }`; verb-bindings =
   `{ verb → modusId }` — both are owner-keyed override maps. Since anon support forces preferences
   onto the owner key anyway (item 3), the verb-binding is **one more entry in that same owner-keyed
   preference bag**, not a new surface. The platform default table (`CANON_VERBS`, the taste) stays as
   command-layer code; resolution is `resolveVerb(owner, verb) = binding[verb] ?? CANON_VERBS[verb]`.

   **Verb-rebind and saved versions stay distinct layers.** You rebind a verb *to point at* a flow
   (canonical or your own saved derived Modus). The verb-binding is the thinnest possible map; the
   saved version is a first-class `Modus`. Do not fuse them.

### The reusable principle (apply to every feature buildout)

Before adding a field or noun, walk it down to the crystal: is this genuinely new substance, or an
existing primitive at a different altitude? Does an existing union/shape already cover the case
(here, `{animaId}|{commitment}` for "owned by identified-or-anon")? Add only what survives that
reduction — here, two reuses (the owner union, the `affines` shape) and one tiny map, **no new nouns,
no new concepts.**

## Consequences

- Two execution shapes, not N: **(A) run a modus → one `Actum`** (`enterExecute`, already wired —
  serves every elemental verb, `/run`, and `/spell`, since a spell is just a `compositus` Modus); and
  **(B) cook a modus × grid → one `Collectio`** (a new entry, `CollectioCursor`). `/cook` earns its
  own verb because its input is a `Tractus[]` grid and its output is a Collectio, not an Actum.
- Sequencing (decided 2026-06-05): **verb table + rebind first** (light, independent of the param
  panel) → param panel (`aditus` form) → saved versions (derived Modus) → cook/Collectio.
- The hermetically-testable seam (the `CANON_VERBS` table + `resolveVerb`/`bindVerb` resolution) lives
  in `CommandRouter` with injected deps (the TASK-002 optional-dep pattern) and is **agnostic to where
  bindings persist** — so TASK-003 is safe to build before the persistence decision lands. The
  persistence follow-on is: widen `Modus.auctor` to `{animaId}|{commitment}`, re-home preferences
  (`affines` + verb-bindings) under that owner key, and wire `resolveVerb`/`bindVerb` against it
  (with the `CANON_VERBS` fallback). Adapter/crystal-store work, validated on staging — not the agent gate.
- Remaining elemental verbs (`effect`/`animate`/`direct`/`compose`) are thin handlers over shape A,
  **gated on their default flows existing** (only `make`+`chat` have flows today).
