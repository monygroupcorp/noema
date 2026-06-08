# TASK-008: Make the SD1.5 gen template LoRA-capable

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: a Compiler test proves an sd15-family LoRA trigger resolves on the sd1-5
  flow. The actual on-pod LoRA application is validated on staging.)

**Staging finding (2026-06-08):** `/run sd1-5 …armored_dress…` never applies the Armored Dress LoRA.
Root cause: `sd15-v1.json` is **not `loraCapable`** (`Compiler.ts:124` guards trigger resolution on
`template.loraCapable`) and its graph has no node that consumes `<lora:slug:weight>` tokens. The only
loraCapable template is flux — and the Armored Dress LoRA is `familia: 'sd15'`, so it can't match flux.
Net: the TASK-005 familia re-key is **untested live** because there's no loraCapable sd15 flow. This
fixes that.

## Read first
- `src/crystal/workflows/sd15-v1.json` (the template to upgrade), `src/crystal/workflows/lora-test-v1.json`
  + `flux-schnell-v1.json` (the **loraCapable** patterns to mirror — how the prompt routes through the
  node that extracts `<lora:…>` tokens).
- `src/crystal/Compiler.ts:116–146` (the `loraCapable` guard, `resolveLoraTriggers`, how the modified
  prompt is slot-mapped into the graph), `src/crystal/loraResolver.ts` (the `<lora:slug:weight>` token
  format the graph node must consume).
- `tests/unit/crystal/Compiler.test.ts` (the existing flux lora-resolution test — mirror it for sd15).
- `tests/unit/crystal/workflowTemplates.test.ts` (template integrity — must still pass).

## Deliverables
1. **`sd15-v1.json`:** add `"loraCapable": true` and insert the SD1.5 LoRA-injection node into the
   `inputTemplate` graph — the node that reads the `<lora:slug:weight>` tokens woven into the prompt and
   applies the LoRA(s) to the model+clip (mirror how `lora-test-v1.json` / `flux-schnell-v1.json` do it;
   for SD1.5 this is the ComfyUI multi-LoRA-from-text loader feeding `CheckpointLoaderSimple` → the
   CLIP/model path → `KSampler`). Ensure the `slotMap` routes `prompt` through that node (as flux does).
2. Keep the rest of the sd15 graph intact (the non-LoRA `/run sd1-5` path must still work).
3. **Test:** add a Compiler case (mirror the flux lora test) — an sd1-5 flow (loraCapable) + a mock
   `familia:'sd15'` LoRA with a trigger → `appliedLoras` includes it; a `familia:'flux'` LoRA with the
   same trigger → NOT applied. This also gives the familia re-key its first sd15 coverage.

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, incl. `workflowTemplates.test.ts` (sd15 template still well-formed:
  slotMap pointers resolve, `loraCapable` recognized) and the new Compiler sd15-lora case.

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Staging (out of the hermetic gate)
- Real on-pod gen: `/run sd1-5 <prompt with armored_dress>` actually applies the LoRA in ComfyUI (the
  inserted node must function in the real graph — hermetic only proves the token resolves + routes).

## Out of scope
- The bulletin regression (separate); prompt affixes; `/run` owned-flow resolution (TASK-009).
- Changing the flux/lora-test templates.
