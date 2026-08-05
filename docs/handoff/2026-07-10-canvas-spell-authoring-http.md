# Spec — Canvas authors real spells (Tabula HTTP surface + compile-to-Modus)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**This is ADR-0008 follow-up (5)** (`docs/adr/0008-compositus-execution.md:116`) given a concrete
web-first cut.

## Finding
Everything below the HTTP line already exists:
- **Running a spell works today**: `POST /v1/runs` with a compositus `modusId` routes through
  `invokeFlow` → `dispatchInceptio` → `CompositusCursor.start()` (dispatchInceptio.ts:69,
  CompositusCursor.ts:78). Seeded spells: make-upscale, image-caption
  (`src/crystal/seeds/compositi.ts:25,64`).
- **The authoring types exist**: `Tabula` (types/tabula.ts:81 — visual layer: `TabulaNodus`
  placements + `TabulaVinculum` edges, publishes to a Modus), `Gradus.ligamina` wiring
  (types/modus.ts:95, resolution order ligamen > compositus aditus > child default,
  CompositusCursor.ts:238), registry splits canonica/auctor (MongoModorum.ts:44-51).

What does NOT exist: any HTTP route to author — no Tabula CRUD, no publish, and the web
`Canvas.tsx` renders a hardcoded demo graph (Canvas.tsx:76,83) with a stub "Compile to spell"
button (Canvas.tsx:117).

## Goal
A user draws a graph on `/canvas`, saves it, publishes it as an owner-scoped compositus Modus,
and runs it — list/load/edit round-trips included. No new nouns: Tabula and Modus already model
all of it (crystal-first).

## Shape
1. **Tabulae store + routes** (owner-scoped, same auth acceptor as the rest of /v1):
   - `GET /v1/tabulae` (list mine) · `POST /v1/tabulae` (create) · `GET/PUT/DELETE
     /v1/tabulae/:id`. Body = the existing `Tabula` shape (nodi/vincula/nomen). Mongo store
     mirroring MongoModorum conventions; hermetic Memory twin.
2. **Publish**: `POST /v1/tabulae/:id/publish` — compile Tabula → compositus Modus:
   - each node ordered → `Gradus { ordine, modusId, ligamina }`; each `TabulaVinculum`
     (fonteNodusId/fontePorta → scopusNodusId/scopusPorta) → `ligamina[scopusPorta] =
     { gradus: fonteOrdine, exitus: fontePorta }`;
   - unwired required aditus ports of step 0..n bubble up to the compositus `aditus` schema;
     final step's exitus (or explicitly marked node) becomes the compositus `exitus` (ADR-0009:
     schema-keyed ports, never hardcoded imageUrl);
   - register via Modorum with `auctor` = caller, `canonica: false`, versio bump on republish;
   - validation: DAG (no cycles), port-type compatibility (mismatch = 400 with the offending
     vinculum — the FocusDemo connection overlay already models allowed/mismatch typing);
   - response `{ modusId }` — immediately runnable via existing `POST /v1/runs`.
3. **Discovery**: owner's spells must show up for the picker — `GET /v1/flows` today lists
   canonical; either extend with `?mine=1` (auth-aware) or list via a filter on the existing
   registry list (MongoModorum already queries `auctor.animaId`/`auctor.commitment`). Choose
   the smaller diff; document in the contract either way.
4. **Frontend `Canvas.tsx`**:
   - node palette from `GET /v1/flows` + `GET /v1/flows/:id` schemas (ports = real aditus/
     exitus, not the hardcoded demo);
   - save/load Tabula via the new client methods; autosave debounce;
   - "Compile to spell" wires to publish; success → link to `/card?id=<modusId>` to run it;
   - anon callers: full authoring works (registry supports commitment auctor) — keep it.
5. **Contract + docs**: apiContract entries for every route; `npm run gen:api-docs`.

## Acceptance
- Draw prompt→gen→upscale on /canvas → save → publish → run from Card → parent Actum settles
  with schema-keyed exitus; re-open /canvas → tabula loads back.
- Publishing the seeded make-upscale shape by hand produces a Modus equivalent to
  `COMPOSITUS_MAKE_UPSCALE` (good parity test).
- Cycle / type-mismatch graphs → 400 with pointable error, UI shows it on the edge.
- Hermetic: compile function unit-tested (tabula fixture → expected Gradus/ligamina), route
  auth scoping (stranger 404), docs-drift green.

## Leads
- Types: `src/types/tabula.ts:28,50,81` · `src/types/modus.ts:66,95,102,121,205-214`.
- Engine (do not touch): `src/crystal/CompositusCursor.ts:63,78,139,238` +
  `CompositusCursor.test.ts` as the behavior contract.
- Seeds as compile targets: `src/crystal/seeds/compositi.ts:25,64,87`.
- Screen: `src/platforms/web/app/src/screens/Canvas.tsx:40,76,83,117` (ReactFlow already in deps).
- ADRs: 0008 (execution + follow-up list), 0009 (exitus schema keys).
