# TASK-001: Add the SD1.5 txt2img gen-flow (Essentia + template)

- **Status:** ready
- **Owner:** none
- **Gated by:** — (the artifacts are hermetically verifiable; real gen runs on staging, a GPU)

Today only FLUX has a runnable workflow. The SD1.5 base model is already in the catalog
(`intella.sd15-v1-5`, mirrored at `models.miladystation2.net`), but there's no `Essentia`/template, so
`/make`/`/run` can't generate with it. Add the flow. **It is a self-contained checkpoint** (VAE+CLIP
baked in) — far simpler than FLUX's separate unet/vae/clip.

## Read first
- `AGENTS.md` + `docs/adr/0001-crystal-naming-no-new-nouns.md` (speak the crystal).
- `src/crystal/seeds/essentiae.ts` — `ESSENTIA_RUNMAKE_FLUX_SCHNELL` (the working example to mirror).
- `src/crystal/workflows/flux-schnell-v1.json` — template shape: `inputTemplate` (ComfyUI graph),
  `slotMap` (JSON-pointer → aditus key), `requiredModels`.
- `src/crystal/Compiler.ts` — `_applySlotMap` (how `aditus` fills the graph) + `_resolveModels`.
- `src/crystal/WorkflowTemplateRegistry.ts` — load/validate contract (`<id>-v<version>.json`).
- `src/crystal/seeds/intellae.ts` — `INTELLA_SD15` (id `intella.sd15-v1-5`, dest
  `checkpoints/v1-5-pruned-emaonly.safetensors`, source[0] = the auth-free R2 mirror).

## Deliverables
1. **`src/crystal/workflows/sd15-v1.json`** — a standard ComfyUI **API-format** txt2img graph:
   `CheckpointLoaderSimple` → positive + negative `CLIPTextEncode` → `EmptyLatentImage` → `KSampler`
   → `VAEDecode` → `SaveImage` (filename_prefix `runmake`). The checkpoint loader's `ckpt_name` is
   `v1-5-pruned-emaonly.safetensors` (matches the dest). `slotMap` wires aditus → nodes:
   `prompt`→positive CLIPTextEncode text, `input_seed`→KSampler seed, `steps`/`cfg`(guidance)→KSampler,
   `width`/`height`→EmptyLatentImage. `seedInputKey: "input_seed"`. `requiredModels`:
   `[{ role: "checkpoint", id: "intella.sd15-v1-5", url: "<the mirror url from INTELLA_SD15.sources[0]>", dest: "checkpoints/v1-5-pruned-emaonly.safetensors" }]`.
   `platformHints: { vramGb: 8 }`. `templateId: "sd15"`, `version: "1"`.
2. **`ESSENTIA_RUNMAKE_SD15`** in `src/crystal/seeds/essentiae.ts`, mirroring the FLUX one:
   `id: 'runmake.sd15'`, `ministerium: 'runpod'`, `categoria: 'image'`, `intellaId: 'intella.sd15-v1-5'`,
   `aditus` (prompt required; width/height default 512; steps default 20; guidance default 7.5;
   input_seed optional), `runpodSpec` (`imageId/imageVersion` = the same PyTorch image,
   `runtime: 'ComfyUI'`, `workflowTemplate: 'sd15'`, `workflowTemplateVersion: '1'`,
   `seedInputKey: 'input_seed'`, `defaultCookFlags` with `vramGb: 8`). Add to `CANONICAL_ESSENTIAE`.

Do **not** add a new noun/type. Do **not** wire a canon verb or `/run` resolver (separate sprint) —
registration in `CANONICAL_ESSENTIAE` makes it resolvable by id.

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:unit` green — in particular `tests/unit/crystal/workflowTemplates.test.ts` passes for
  `sd15-v1.json` (slotMap pointers resolve, requiredModels well-formed, filename matches id+version).
- A `Compiler` unit test (add one mirroring any existing Compiler test) proving
  `compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' })` returns a `CompiledSpec` whose workflow has the
  prompt slotted into the positive CLIPTextEncode node and the checkpoint in `models`.

## Verify
```bash
npx tsc --noEmit && npm run test:unit
```

## Out of scope / gated
- **Real generation on a pod** (does the ComfyUI graph actually render?) — **staging only** (a GPU).
  Validate via `/run runmake.sd15` once a studio is up; cheap (~4GB checkpoint).
- The `/run` resolver, canon-verb default table, per-user rebind — the command/flow sprint.
- Other bases (SDXL/Illustrious) — backlog, gated on weights.
