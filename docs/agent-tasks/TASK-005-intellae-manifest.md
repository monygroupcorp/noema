# TASK-005: The `intellae` manifest — the flow declares the weights it needs

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: Compiler + template tests prove the weight set now comes from the flow.
  The real install is unchanged in shape and validated on staging.)

A flow record should be the **authoritative, atomic, swappable** declaration of the weights it needs
to run. Today the weight *list* lives in the workflow template's `requiredModels[]` (`essendi.ts:42`
even says so), not on the flow. This task **moves that list onto the flow** as `Modus.intellae`.
Motivating case (your words): a `compositus` flow — flux image → sdxl upscale — needs the **union of
two model families' weights**, which belongs on the flow, not split across templates.

## Two distinct concepts — do NOT conflate them (this is the crux)

Grounding (`flux-schnell-v1.json`, `sd15-v1.json`, `seeds/essentiae.ts`) shows the flow has **two
different model concerns**, and they are NOT the same id:

1. **Physical weight set** — what actually downloads. flux = `unet` (`intella.flux-schnell-fp8-scaled`)
   + `vae` + 2× `clip`; sd1-5 = one `checkpoint`. This currently lives in `template.requiredModels`.
   **→ This is what `Modus.intellae` becomes.**
2. **Base-family pointer** — `Essentia.intellaId` (`intella.flux-schnell`), the *logical family* LoRAs
   key their compatibility against (`Compiler.ts:125 triggerMap(intellaId)`). It is **not** one of the
   physical weights (flux's weight is `…-fp8-scaled`, the family is `…flux-schnell`). **→ KEEP it
   unchanged.** It is a separate concept; the trigger map stays exactly as-is.

So: **`intellae` = downloadable weights** (replaces the `requiredModels` list); **`intellaId` = base
family** (untouched). No `baseIntellaId` helper, no removal, no allocutio changes.

**Out of bounds (different concept entirely):** `intellaId` as a generic run/trace FK on `Actum`,
`Vestigium`, `Materia`, `significandi`, `rag/`, migrations — "which model a run used." Do not touch.
Also untouched: trigger-word LoRAs (resolved per-dispatch at compile, `Compiler.ts:116–146`) and
general LoRA compat — they stay dynamic, NOT in the manifest.

## The key grounding (the change is small)
- `Compiler._resolveModels` (`Compiler.ts:188–211`) **already** fills `url` + `dest` from the `Intella`
  record (`intella.sources[0].uri`, `intella.dest`). So `Intella` already owns *where a weight lives*.
  The only mis-homed thing is the **list of weight ids** — `template.requiredModels` → `Modus.intellae`.

## Read first
- `AGENTS.md`, `docs/adr/0001`, `0003`, `0004`.
- `src/types/modus.ts` (where `intellae` goes — on `Modus`, since `compositus` modi need it too).
- `src/types/essendi.ts` (`Essentia.intellaId` — STAYS; clarify its doc as "base family").
- `src/crystal/Compiler.ts:112–211`; `src/crystal/WorkflowTemplateRegistry.ts`.
- `src/crystal/workflows/{flux-schnell-v1,sd15-v1,flux-schnell-no-url-v1,lora-test-v1}.json`,
  `src/crystal/seeds/essentiae.ts`.
- `tests/unit/crystal/{Compiler.test,Compiler.sd15.test,workflowTemplates.test,WorkflowTemplateRegistry.test}.ts`.

## Deliverables
1. **Add `Modus.intellae?: Array<{ id: string; role: string }>`** (`src/types/modus.ts`) — the flow's
   physical weight manifest. `role` matches existing `requiredModels.role` strings (`'checkpoint'`,
   `'unet'`, `'vae'`, `'clip'`, `'lora'`, …). Doc: atomic flow → its full weight set; `compositus` →
   the union across `gradus` children. (NOT the base family; NOT trigger LoRAs.)
2. **Compiler sources the weight set from `essentia.intellae`** (not `template.requiredModels`):
   change `baseRefs = [...(template.requiredModels ?? []), ...loraRefs]` →
   `baseRefs = [...intellaeRefs, ...loraRefs]`, where each `intellae` entry becomes a ref
   `{ id, role }` **enriched with `url`/`dest` from a matching `template.requiredModels` entry by id
   when present** (preserves the url/dest fallback for unregistered Intellae). `_resolveModels` is
   unchanged (it still overrides `url`/`dest` from the `Intella` record). Trigger map at line 125 stays
   `essentia.intellaId` — **unchanged**.
3. **Templates keep `requiredModels` as an OPTIONAL url/dest fallback** (make it `?` on
   `WorkflowTemplate`), no longer the source of the list. Migrate the 2 flow seeds to carry `intellae`:
   `flux-schnell` → the 4 weights (`unet`/`vae`/`clip`/`clip`, ids from `flux-schnell-v1.json`);
   `sd1-5` → `[{ id:'intella.sd15-v1-5', role:'checkpoint' }]`. Leave the workflow JSONs intact (their
   `requiredModels` remains as the fallback table).
4. **Tests.** Update `Compiler.sd15.test.ts` / `WorkflowTemplateRegistry.test.ts` /
   `workflowTemplates.test.ts` (and `Compiler.test.ts`) for the new source. Add a case proving
   `CompiledSpec.models` is assembled from `essentia.intellae` (flux → its 4 weights; sd1-5 → 1), that
   a trigger-word LoRA still resolves+appends (regression — `intellaId` path unchanged), and that an
   unregistered-Intella falls back to the template's `requiredModels` url/dest. **Add the DB-free
   Compiler/template tests to the hermetic gate** in `package.json` — `Compiler.sd15.test.ts` +
   `WorkflowTemplateRegistry.test.ts` are DB-free; **verify `Compiler.test.ts` runs green bare
   (`env -i`) before gating it — it matched a mongo/env pattern, so exclude it if it needs a DB.**

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green (bare), including the newly-gated tests, with:
  - `flux-schnell` compile → `CompiledSpec.models` = its 4 weights, sourced from `intellae` (template
    `requiredModels` removed/ignored as the list source).
  - `sd1-5` compile → its 1 checkpoint, sourced from `intellae`.
  - trigger-word LoRA still resolves + appends (uses unchanged `essentia.intellaId`).
  - unregistered-Intella → url/dest still resolve via the template `requiredModels` fallback.

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Out of scope (do NOT do)
- **Removing or renaming `Essentia.intellaId`** — it's the base family, a separate concept (kept).
- The run/trace `intellaId` FKs (`Actum`/`Vestigium`/`Materia`/`significandi`/`rag`/migrations).
- Allocutio catalog/arm `intellaId` reads — generic Intella refs, not flow declarations.
- `compositus` trigger-family resolution (a composite spanning two families) — future.
- Save-as (TASK-006), prompt affixes (TASK-007), real on-pod install (staging).
