# TASK-005: The `intellae` manifest + `familia` — the flow declares its weights; family drives LoRA compat

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: Compiler + template tests prove weights come from the flow and LoRA compat
  keys on `familia`. The Mongo query re-key + real install are validated on staging.)

Two moves that make a flow **self-describing** and kill a shoehorned field:
1. **Weights onto the flow.** The weight list lives in `template.requiredModels[]` today (`essendi.ts:42`);
   move it to `Modus.intellae`. The flow declares what it downloads.
2. **`familia` becomes the LoRA-compat key; drop `Essentia.intellaId`.** The flow's only use of
   `intellaId` is the LoRA trigger join (`Compiler.ts:125`); its documented purpose
   (`intelligendi.ts:149–152`) is "run only in workflows whose base `Essentia.intellaId` matches this
   `baseIntellaId`." That's a single-purpose join key — and the real concept is **model family**
   ('flux','sd15',…), which already exists loosely as `Intella.tags` (`intelligendi.ts:191`). Formalize
   it as `Intella.familia`, key compat on it, and `intellaId` disappears.

   **This fixes a live gap, not just a refactor:** `BulletinModelCatalog` already documents that
   `baseIntellaId` is **empty across the imported catalog** and that "family lives in tags. Swap once
   it's set" (lines 19/186/238) — so the crystal's `triggerMap(baseIntellaId)` join is effectively dead
   on real data, and the allocutio side already keys its own `resolveTriggers(text, { family })` on
   family. Populating `familia` + re-keying `triggerMap` makes the crystal path actually work and lets
   the allocutio workaround converge onto it later.

**Composite-ready by construction** (the "don't box ourselves" requirement). A `compositus` flow
(flux → sdxl → z-image) spans multiple families; LoRA trigger resolution must be **per-prompt-input**,
filtered to the family of the step that input feeds — a flux-path trigger word resolves only flux LoRAs.
The mapping already exists: `slotMap` gives prompt-input → graph node; the gradus gives node → step →
family. So trigger resolution must key on a **`familia` passed per call**, never a flow-global id.
`resolveLoraTriggers(prompt, { triggerMap })` is *already* per-prompt — we only change how the
triggerMap is keyed (intellaId → familia). Composite compilation itself is the future task that calls
this per-input; this task must not assume single-flow-global-family.

## Design (confirmed)
- `familia` lives on `Intella` (weight + LoRA). A flow's family is **derived, never declared**: atomic →
  its base-role weight's `familia`; composite → the union across gradus children. (No `familia` field on
  `Modus` — single source of truth, zero drift.)
- `Modus.intellae` = the physical weight manifest (replaces the `requiredModels` *list*).
- **Install** = flat union of weights (composite: union across steps, derived). **Trigger filtering** =
  per-input by step family. Same manifest, two uses.

## Read first
- `AGENTS.md`, `docs/adr/0001`, `0003`, `0004`.
- `src/types/modus.ts` (add `intellae` — on `Modus`, composites need it), `src/types/essendi.ts`
  (`Essentia.intellaId` — removed), `src/types/intelligendi.ts` (add `Intella.familia`; the `Intellarum`
  interface — `triggerMap`/`findByTrigger` signatures; LoRA `baseIntellaId` + `tags`).
- `src/crystal/Compiler.ts:112–211`, `src/crystal/MongoIntella.ts:118–155` (the `baseIntellaId` queries),
  `src/crystal/loraResolver.ts`, `WorkflowTemplateRegistry.ts`.
- `src/crystal/workflows/{flux-schnell-v1,sd15-v1,flux-schnell-no-url-v1,lora-test-v1}.json`,
  `src/crystal/seeds/{essentiae,intellae}.ts`.
- `tests/unit/crystal/{Compiler.test,Compiler.sd15.test,workflowTemplates.test,WorkflowTemplateRegistry.test}.ts`.

## Deliverables
1. **`Intella.familia?: string`** (`intelligendi.ts`) — the model family ('flux','sd15','sdxl','z-image',…;
   canonical lowercase). Formalize it from the existing **family `tag`** value (e.g. the Armored Dress
   LoRA is tagged `'sd15'`; `intella.sd15-v1-5` likewise). **Do NOT derive it from `architectura`** —
   that field is *structural* ('unet'/'dit') and is inconsistently set to a family on some seeds; this
   task untangles exactly that. **Compat is string equality**, so a base weight and its compatible LoRAs
   MUST carry the *identical* `familia` string — pin the canonical values.
2. **`Modus.intellae?: Array<{ id: string; role: string }>`** (`modus.ts`) — the physical weight
   manifest. `role` ∈ existing strings (`checkpoint`/`unet`/`vae`/`clip`/`lora`/…). Doc: atomic → full
   weight set; composite → union across `gradus`. **Remove `Essentia.intellaId`.**
3. **Re-key LoRA compat to `familia`.** Change `Intellarum.triggerMap(baseIntellaId)` →
   `triggerMap(familia)` and `findByTrigger(trigger, baseIntellaId, …)` → `findByTrigger(trigger,
   familia, …)`; update `MongoIntella` to query LoRAs by `familia` (was `baseIntellaId` /
   `params.baseIntellaId`). `LoRA.baseIntellaId` may remain as *provenance* (which exact base it trained
   on) but is **no longer the compat key**.
4. **Compiler** (`Compiler.ts`):
   - Source the weight set from `essentia.intellae` (not `template.requiredModels`); enrich each ref's
     `url`/`dest` from a matching `template.requiredModels` entry by id when present (fallback);
     `_resolveModels` unchanged.
   - Derive the flow's family **role-agnostically**: the distinct non-empty `familia` across the flow's
     `intellae` weights (atomic → one; composite → the union). Do NOT hardcode `role ∈ checkpoint|unet`.
     Call `triggerMap(familia)` (replacing `triggerMap(essentia.intellaId)`) with the atomic flow's one
     family. The resolver call is otherwise unchanged — it already takes the (now family-keyed) map per
     prompt. Add a comment noting composite compilation calls this **per prompt-input** with that input's
     family. **Fetch-once:** the weights' Intellae are already loaded in `_resolveModels` — derive the
     family from those records, don't add a second N+1 lookup pass (reorder if needed).
5. **Seeds** (`seeds/intellae.ts`, `seeds/essentiae.ts`): set `familia` on base weights
   (`intella.flux-schnell-fp8-scaled` → `'flux'`, `intella.sd15-v1-5` → `'sd15'`) and on the Armored
   Dress LoRA (`'sd15'`); add `intellae` to the 2 flow seeds (flux → its 4 weights; sd1-5 → its
   checkpoint). Make `WorkflowTemplate.requiredModels` optional (url/dest fallback only).
6. **Tests + gate.** Update `Compiler.sd15.test.ts` / `Compiler.test.ts` / `WorkflowTemplateRegistry.test.ts`
   / `workflowTemplates.test.ts`. Add cases: weights sourced from `intellae` (flux→4, sd1-5→1); the
   trigger map is built from the **derived `familia`** (a flux flow resolves a flux-family LoRA, and a
   mismatched-family LoRA is NOT offered); url/dest fallback still works. **Gate the DB-free tests** in
   `package.json` (`Compiler.sd15.test.ts`, `WorkflowTemplateRegistry.test.ts`; verify `Compiler.test.ts`
   runs green bare with `env -i` before gating it — it matched a mongo/env pattern).

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green (bare), incl. the newly-gated tests, with:
  - `flux-schnell`/`sd1-5` compile → `CompiledSpec.models` from `intellae` (4 / 1 weights).
  - trigger resolution keys on the **derived family** — flux flow + flux LoRA trigger → applied; same
    trigger declared for a different family → NOT applied (family filtering works).
  - unregistered-Intella → url/dest via the template `requiredModels` fallback.
  - `tsc` proves no remaining reader of `Essentia.intellaId` (it's gone) and `triggerMap` takes `familia`.

## Composite-readiness (verify, don't build)
The interfaces this task ships must let composites plug in with no rework: `triggerMap(familia)` is
callable per-step; `intellae` derives a per-step family; install is a derivable union. **Do NOT build**
`Compiler._compileComposed`, multi-prompt-input templates, or per-input resolution here — note in code
where they attach.

## Out of scope (do NOT do)
- The run/trace `intellaId` FKs (`Actum`/`Vestigium`/`Materia`/`significandi`/`rag`/migrations) — different concept.
- Allocutio catalog/arm `intellaId` reads — generic Intella refs, not flow declarations.
- Composite compilation / per-input resolution / fuzzy family-compat graph — future.
- Save-as (TASK-006), prompt affixes (TASK-007), real on-pod install (staging).
