# TASK-005: The `intellae` manifest — the flow declares the models it needs

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: Compiler + template tests prove the model set now comes from the flow.
  The real install is unchanged in shape and validated on staging.)

A flow record should be the **authoritative, atomic, swappable** declaration of the models it needs to
run. Today it isn't: the model *list* lives in the workflow template's `requiredModels[]`
(`essendi.ts:42` even says so), while `Essentia.intellaId` carries only a single base id. This task
**inverts the source of truth**: the flow (`Modus`) declares its required models in a manifest; the
template stops owning the list. Motivating case (your words): a `compositus` flow — flux image →
sdxl upscale — genuinely requires **two base models**, which a singular `intellaId` cannot express.

**What this is NOT:** general LoRA *compatibility* (implied by base family) and **trigger-word LoRAs**
(resolved per-dispatch from the prompt at compile, `Compiler.ts:116–146`) stay dynamic — they ride
through `CompiledSpec.models` and must NOT be added to the manifest. The manifest holds only what a
flow *requires* to run. See ADR-0003/0004 and `docs/capability-map.md`.

## The key grounding (read, then you'll see the inversion is small)
- `Compiler._resolveModels` (`src/crystal/Compiler.ts:188–211`) **already** fills `url` + `dest` from
  the `Intella` record (`intella.sources[0].uri`, `intella.dest`). So `Intella` already owns *where a
  model lives*. The template's `url`/`dest` are only fallbacks. **The only mis-homed thing is the list
  of which model ids** — currently `template.requiredModels`, should be `Modus.intellae`.
- `intellaId` means **two different things** in the tree — keep them straight:
  - **In scope (the flow's base declaration):** `Essentia.intellaId` (`essendi.ts:104`), its use in
    `Compiler.ts:124–125` (feeds the trigger map), the two seeds (`seeds/essentiae.ts`), and the
    allocutio reads of a flow's base model (`BulletinModelCatalog`, `BulletinManager`, `PodSession`,
    `bulletin/types.ts`, `TelegramAllocutio`).
  - **OUT of scope (a generic run/trace FK — leave untouched):** `intellaId` on `Actum`
    (`types/actum.ts`), `Vestigium`, `Materia`, `significandi.ts`, `rag/`, `MongoVestigiorum`,
    `vestigiumHook`, `migrations/`. These mean "which model did this run/trace use" — not a flow
    declaration. Do not change them.

## Read first
- `AGENTS.md`, `docs/adr/0001`, `0003`, `0004`.
- `src/types/modus.ts` (where `intellae` goes — on `Modus`, since `compositus` modi need it too) and
  `src/types/essendi.ts` (`Essentia.intellaId` — being removed).
- `src/crystal/Compiler.ts:112–211` — trigger resolution, the `requiredModels`→models assembly, `_resolveModels`.
- `src/crystal/WorkflowTemplateRegistry.ts` (`requiredModels` on the template type).
- `src/crystal/workflows/*.json` (the 4 templates), `src/crystal/seeds/essentiae.ts`, `seeds/intellae.ts`.
- `tests/unit/crystal/Compiler.test.ts`, `Compiler.sd15.test.ts`, `workflowTemplates.test.ts`,
  `WorkflowTemplateRegistry.test.ts`.

## Deliverables
1. **Add `Modus.intellae?: Array<{ id: string; role: string }>`** (`src/types/modus.ts`) — the flow's
   required-model manifest. `role` matches the existing `ModelRef.role`/`requiredModels.role` strings
   (`'checkpoint'`, `'lora'`, `'vae'`, …). Document: atomic flow → its base (`role:'checkpoint'`) plus
   any LoRA it truly requires; `compositus` flow → the **union** across its `gradus` children. Trigger
   LoRAs and general compat are NOT listed.
2. **Remove `Essentia.intellaId`**; add a helper `baseIntellaId(modus: Modus): string | undefined`
   (the first `role:'checkpoint'` entry of `intellae`) for the places that need "the flow's base
   model". Migrate the **in-scope** reads (Compiler trigger map; allocutio catalog/arm/bulletin labels
   + loadout) to the helper. **Do not touch the out-of-scope run/trace `intellaId` FKs** listed above.
3. **Compiler sources the model set from `essentia.intellae`** (not `template.requiredModels`):
   `baseRefs = [...intellae, ...loraRefs]` (was `[...template.requiredModels, ...loraRefs]`), then the
   unchanged `+ pinnedRefs → _resolveModels`. Trigger resolution (`Compiler.ts:124`) uses
   `baseIntellaId(essentia)` instead of `essentia.intellaId`. `_resolveModels` is unchanged.
4. **Templates stop owning the list.** Make `WorkflowTemplate.requiredModels` **optional**, and treat
   it as a **url/dest fallback only** (consulted by `_resolveModels` by id when an `Intella` isn't
   registered — preserves the `flux-schnell-no-url` scenario), NOT as the source of which models load.
   Migrate the 2 flow seeds to carry `intellae` (e.g. `flux-schnell` → `[{ id:'intella.flux-schnell',
   role:'checkpoint' }]`, `sd1-5` → `[{ id:'intella.sd15-v1-5', role:'checkpoint' }]`). Leave the
   workflow JSONs' graphs/slotMaps intact; their `requiredModels` may remain as the fallback table.
5. **Tests.** Update `Compiler.test.ts` / `Compiler.sd15.test.ts` / `WorkflowTemplateRegistry.test.ts`
   / `workflowTemplates.test.ts` for the new source of truth. Add a Compiler case proving
   `CompiledSpec.models` is assembled from `essentia.intellae` (+ trigger + pinned), and that a flow
   with **two** `intellae` entries (a composite-style fixture) yields both. **Add the DB-free Compiler
   tests to the hermetic gate** in `package.json` (verify they run green bare — `env -i`).

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green (bare), including the newly-gated Compiler tests, with:
  - compile of `flux-schnell` / `sd1-5` produces the same `CompiledSpec.models` as before — but sourced
    from `intellae`, with `requiredModels` removed from (or ignored on) the template.
  - a 2-entry `intellae` fixture (flux + sdxl) → both models in `CompiledSpec.models` (the composite unlock).
  - trigger-word LoRA still resolves and appends (regression guard — uses `baseIntellaId`).
  - an unregistered-Intella + template-fallback case still resolves url/dest (no-url path preserved).

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Out of scope (do NOT do)
- The run/trace `intellaId` FKs (`Actum`/`Vestigium`/`Materia`/`significandi`/`rag`/migrations) — different concept.
- Save-as (TASK-006) and prompt affixes (TASK-007).
- Fully deleting `requiredModels` from templates (kept as a url/dest fallback) — a later cleanup if we
  decide every model must be a registered Intella.
- Real on-pod install validation — staging.
