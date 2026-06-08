# TASK-008: Port the LoRA-apply layer — `customNodes` plumbing + the cozyness MultiLoRALoader node

- **Status:** Part 1 ready (hermetic); **Part 2 ready** (graph + pack URL both known as of 2026-06-08)
- **Owner:** none

**Staging finding (2026-06-08), deepened:** LoRA resolution is built (Compiler injects `<lora:slug:weight>`
+ familia, TASK-005) but **non-functional on every crystal flow** — because the graph node that
*consumes* those tokens, the **comfyui-cozyness `MultiLoRALoader`**, was never ported from the old
system. Three facts:
- Only the `lora-test` **fixture** is `loraCapable`; `flux-schnell` and `sd15` are **not** (flux loras
  don't apply either).
- **No** crystal template has a MultiLoRALoader node — all route the prompt to `CLIPTextEncodeFlux`,
  which can't parse lora syntax. (`MultiLoraLoader` exists only as legacy detection in
  `src/core/services/oldworkflows.js:1329`.)
- The `customNodes` install path is broken end-to-end: `comfyrunnerClient.ts:69` reads
  `spec.customNodes`, but the `Compiler`/`CompiledSpec` never populate it, and no template declares it.

So this is two layers: **plumbing** (buildable now) and **the node itself** (needs the cozyness assets).

## Part 1 — `customNodes` plumbing (hermetic, ready)
Make a template able to declare a custom-node pack that actually reaches the pod.
1. Add `customNodes?: Array<{ url: string; name?: string }>` to `WorkflowTemplate`
   (`WorkflowTemplateRegistry.ts`) and to `CompiledSpec` (`Compiler.ts:25`).
2. In `Compiler.compile`, forward `template.customNodes` → `spec.customNodes` (it then flows through
   `comfyrunnerClient.ts:69` → the runner's `_ensure_custom_nodes`, `scripts/pod/comfyrunner.py:303`,
   which already installs them).
3. **Test** (`tests/unit/crystal/Compiler.test.ts`): a template with `customNodes` → `CompiledSpec.customNodes`
   carries them; absent → empty/undefined (no regression). Note: if `_hashSpec` (Compiler.ts:269)
   includes the new field, update any hash-snapshot assertion (the field is part of the deployment
   definition, so including it in the hash is correct).

**Part 1 acceptance:** `npx tsc --noEmit` clean; `npm run test:hermetic` green incl. the new case.

## Part 2 — wire the cozyness LoRA chain into the gen templates (graph KNOWN; pack URL still needed)
**Graph truth** (extracted from `docs/reference/old-workflows/sdxl` + `fluxi2i`): it's a **two-node
chain**, `class_type`s `LoraTextExtractor-b1f83aa2` → `MultiLoraLoader-70bf3d77`:
```
CheckpointLoaderSimple → model[0], clip[1]
LoraTextExtractor:  text ← <the prompt>           → [0]=cleaned text (tags stripped), [1]=lora-tag text
MultiLoraLoader:    model ← ckpt[0], clip ← ckpt[1], text ← LoraTextExtractor[1]
                                                    → [0]=model+loras, [1]=clip+loras
KSampler:           model ← MultiLoraLoader[0]
CLIPTextEncode:     clip  ← MultiLoraLoader[1],  text ← LoraTextExtractor[0] (cleaned)
```
So the Compiler-injected `<lora:slug:weight>` prompt feeds `LoraTextExtractor.text`; the loader's
model/clip outputs drive the sampler + text-encode.

**Pack URL (provided 2026-06-08):** `https://github.com/skfoo/ComfyUI-Coziness` — declare it in the
loraCapable templates' `customNodes`. Delivery is **per-job** in production: `_ensure_custom_nodes`
(`comfyrunner.py:303`) `git clone`s + `pip install`s it on the first LoRA job per pod, idempotent after
— **no image rebuild required.** (Future optimization, NOT this task: when the parked baked image
`dockerfiles/flux-comfyui-runtime/Dockerfile` is revived, add a Coziness `git clone` layer so cold pods
skip the per-job clone. Noted there as a backlog comment.)

Then, for `sd15-v1.json` (and `flux-schnell-v1.json`):
- insert the `LoraTextExtractor` → `MultiLoraLoader` chain into `inputTemplate` per the wiring above;
  route the `slotMap` `prompt` into `LoraTextExtractor.text` (NOT directly into the text-encode);
- set `loraCapable: true`; declare the cozyness pack in `customNodes` (Part 1 plumbing carries it).
- **Strip the slop:** the old flows wire inputs through `ComfyUIDeployExternal*` nodes (comfydeploy-
  specific) — DROP those; crystal inputs come via `slotMap`, not graph nodes.
- add a Compiler test: an sd15 flow + a `familia:'sd15'` LoRA trigger → `appliedLoras` includes it; a
  `familia:'flux'` LoRA with the same trigger → not applied (first real sd15 coverage of the familia re-key).

**Part 2 staging:** real on-pod gen — `/make` (flux) and `/run sd1-5` with a trigger actually apply the
LoRA in ComfyUI (the node must function + the pack must install).

## Out of scope
- The bulletin regression; `/run` owned-flow resolution (TASK-009).
- Inventing the cozyness node graph or guessing the pack URL — Part 2 waits for the real assets.
