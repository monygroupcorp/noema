# ADR-0003: Verbs, bindings, and saved versions — the parameter/preset layer

- **Status:** accepted
- **Date:** 2026-06-05

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

The customization layer is **three distinct things**, each on an existing primitive. They compose
along the precedence chain already documented on `Anima.affines`:

> **cast-time input > affines > platform preferences (verb binding) > modus defaults**

1. **Parameter surface = `Modus.aditus` (`Porta`).** Surfacing "any parameter" is an adapter view
   that renders one field per `Porta`, prefilled from `Porta.default`. No new type. The simple verb
   (`/make <prompt>`) pre-fills the required Porta and defaults the rest.

2. **Sticky per-flow tweaks = `Anima.affines`.** Shape is already
   `{ [modusId]: { [inputKey]: override } }` — a user's remembered aditus overrides for a given flow.
   Applied by precedence above modus defaults, below cast-time input. No new type.

3. **A named saved version = a derived `Modus`** (the **full case**, chosen 2026-06-05). It is a
   real `Modorum` entry: `auctor: <animaId>`, `canonica: false`, the tweaks baked into the
   `Porta.default`s. Therefore it is shareable, versioned, content-addressed, and royalty-able via the
   `fonteId`/fork chain. **Editing a saved version is `register()` with a bumped `versio` + recomputed
   `contentHash`, never `Modorum.update()`** — `update()` deliberately only accepts non-definitional
   fields (`computeStrategy`/`gpuClass`/`podPolicy`). The content-addressing *is* the feature: a quote
   always matches the exact flow that ran. `/run <my-slug>` runs it; `/flows` browses it for free.

4. **Verb→flow binding = a per-user verb map, keyed by verb-intent (NOT modusId).** This is the only
   genuinely-new state. It does not fit `affines` (modusId-keyed) and `Memoria.praeferentia` is
   distilled/learned, not authoritative config. It is a **new field on `Anima`** (e.g.
   `verba?: Record<verb, modusId>`) — a *field*, not a noun, consistent with how `affines` already
   lives on the soul and survives platform changes. Default table (the platform's taste) lives in the
   command layer as `CANON_VERBS`; resolution is
   `resolveVerb(user, verb) = anima.verba?.[verb] ?? CANON_VERBS[verb]`.

   **Verb-rebind and saved versions are separate layers.** You rebind a verb *to point at* a flow
   (canonical or your own saved derived Modus). Do not fuse the two: rebind is a light map; a saved
   version is a first-class flow.

## Consequences

- Two execution shapes, not N: **(A) run a modus → one `Actum`** (`enterExecute`, already wired —
  serves every elemental verb, `/run`, and `/spell`, since a spell is just a `compositus` Modus); and
  **(B) cook a modus × grid → one `Collectio`** (a new entry, `CollectioCursor`). `/cook` earns its
  own verb because its input is a `Tractus[]` grid and its output is a Collectio, not an Actum.
- Sequencing (decided 2026-06-05): **verb table + rebind first** (light, independent of the param
  panel) → param panel (`aditus` form) → saved versions (derived Modus) → cook/Collectio.
- The hermetically-testable seam (the `CANON_VERBS` table + `resolveVerb`/`bindVerb` resolution) lives
  in `CommandRouter` with injected deps (the TASK-002 optional-dep pattern). The `Anima.verba` field +
  `AnimaStore` wiring + the actual rebind affordance are adapter/crystal-store work, validated on
  staging — not part of the agent gate.
- Remaining elemental verbs (`effect`/`animate`/`direct`/`compose`) are thin handlers over shape A,
  **gated on their default flows existing** (only `make`+`chat` have flows today).
