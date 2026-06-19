# Old-workflow inventory → crystal port roadmap

The 17 comfydeploy workflows in this folder, mapped to **capability-map signatures/verbs** (the gen-flow
backlog) and the **custom-node packs** each needs. Reference, not canon — port by re-expressing in
crystal form (see README.md).

## New flows (beyond the 17-workflow backlog)

| Flow | Verb | Status |
|---|---|---|
| `kleinedit` (FLUX.2 Klein 9B edit) | **effect** (edit) | ✅ **BUILT FROM SCRATCH** — `kleinedit-v1.json` + 3 Intellae (`flux2-klein-9b`, `qwen3-8b-flux2`, `flux2-vae-full-encoder`) + Fundamentum `flux2-klein-comfyui` + Essentia `klein-edit`. Graph ported 1:1 from the official Comfy-Org `image_flux2_klein_image_edit_9b_distilled` template; hermetic-green + compile-verified. A NEW family (`familia: flux2`) — Qwen3 text encoder, `flux2` CLIP type, own VAE; flux.1 LoRAs do NOT apply (so no Coziness stack), unlike Kontext. Verify the klein-9b/qwen3 HF URLs before a real run. |
| `klein-make` (FLUX.2 Klein t2i) | **make** | 📋 **TODO (not started)** — text-to-image variant of Klein (no input image, `EmptyFlux2LatentImage` from width/height, no ReferenceLatent/VAEEncode). Reuse the `flux2-klein-comfyui` substrate + the 3 Klein Intellae already seeded. Official template: Comfy-Org `image_flux2_klein_text_to_image.json`. |
| `kontext-make` (FLUX.1 Kontext t2i) | **make** | 📋 **TODO (not started)** — text-to-image variant of Kontext. Reuse the `flux-kontext-comfyui` substrate + `flux1-kontext-dev` Intella already seeded; drop the reference-latent/VAEEncode path. (Kontext is edit-first, so verify t2i quality is worth a distinct make flow vs. just using flux-schnell/sdxl/chroma for make.) |

## Port status (2026-06-19 pass)

| File | Signature | Verb | Status |
|---|---|---|---|
| `sdxl` | t2i | **make** (sdxl) | ✅ **PORTED** — `sdxl-v1.json` + Intella/Fundamentum/Essentia, hermetic-green |
| `chroma` | t2i | **make** (chroma) | ✅ **PORTED** — `chroma-v1.json` + Intella/Fundamentum/Essentia, hermetic-green |
| `fluxi2i` | i2i | **effect** | ✅ **PORTED** — `fluxi2i-v1.json` (reuses the flux-comfyui substrate; inserted a LoadImage→VAEEncode for the i2i primitive) + Essentia `flux-i2i`, hermetic-green + compile-verified mediaInputs |
| `sdxli2iplus` | i2i | **effect** | 🟡 draft — `BLOCKED: needs i2i image-input + pack rgthree-comfy` (source was shell-escaped JSON; **repaired in place** this pass — was not UI-format) |
| `sdxli2iplusv2` | i2t | **describe** | 🟡 draft — `BLOCKED: needs i2i image-input + pack ComfyUI-WD14-Tagger` (it's a WD14 tagger, not i2i) |
| `kontextedit` | i2i·instruction | **effect** (edit) | ✅ **PORTED** — `kontextedit-v1.json` + Intella `flux-kontext-dev` + Fundamentum `flux-kontext-comfyui` + Essentia `kontext-edit`, hermetic-green + compile-verified (LoadImage feeds VAEEncode + GetImageSize). Verify the kontext fp8 URL before a real run. |
| `kontexteditii` | i2i·instruction | **effect** (edit) | 🟡 draft — `BLOCKED: needs i2i image-input + pack ComfyUI-KJNodes` (ImageConcanate; 2-image edit) |
| `fluxpluscontrol` | i2i·control | **effect** (control) | 🟡 draft — `BLOCKED: needs i2i image-input primitive` (Canny is core — no extra pack) |
| `fluxplusstyleref` | i2i·styleref | **effect** (style) | 🟡 draft — `BLOCKED: needs i2i image-input primitive` (CLIPVision/StyleModel are core) |
| `sdxlplus` | i2i·control (combo) | **effect** ×3 | 🟡 **DECOMPOSED** into 3 single-flavor drafts (see below) — the combo itself is NOT ported |
| `rmbg` | i2i (bg removal) | **enhance** | ✅ **PORTED** — `rmbg-v1.json` (Inspyrenet-Rembg pack, self-downloads its ckpt) on the new weightless `comfyui-base` Fundamentum + Essentia `rmbg`, hermetic-green + compile-verified |
| `tag` | i2t | **describe** | 🟡 draft — `BLOCKED: ComfyUI text-output harvesting in the runner` (i2i-input + WD14 pack resolved; `comfyrunner.py _output_paths()` only collects images/gifs/videos — text-exitus is the one remaining gap, a small runner addition like the i2i primitive was) |
| `i2vunknown` | i2v | **animate** | 🟡 draft — `BLOCKED: needs i2i image-input + video-output exitus + Wan weights; pack ComfyUI-KJNodes` |
| `ii2vunknown` | i2v | **animate** | 🟡 draft — `BLOCKED: needs i2i image-input + video-output exitus + Wan weights; pack ComfyUI-KJNodes` |
| `unknownt2v` | t2v | **direct** | 🟡 draft — `BLOCKED: needs video-output exitus + Hunyuan-video weights/substrate` (no image input — t2v) |
| `upscale` | i2i·upscale | **enhance** | ✅ **PORTED** — `upscale-v1.json` (pack-free, model-only: `UpscaleModelLoader` + `ImageUpscaleWithModel`, 4x-UltraSharp) + Intella/Fundamentum/Essentia, hermetic-green; **verified to compile to a correct mediaInputs spec** via the now-landed i2i primitive. Runnable pending a real-pod staging run. |
| `sdxlupscaleillustrious` | i2i·upscale | **enhance** | ⏭ SKIP — superseded by the pack-free `upscale` above (it used UltimateSDUpscale + a checkpoint) |

> **UPDATE 2026-06-19 — the i2i image-input primitive LANDED** (Compiler.ts "Media inputs": a media-typed,
> slot-mapped aditus → a runner-side download into ComfyUI's `input/` dir, keyed on `Porta.type`; proven
> in `tests/unit/crystal/Compiler.mediaInputs.test.ts`). This **clears the `needs i2i image-input` half of
> every blocker below.** Reclassification:
> - **`fluxi2i`, `kontextedit`** had *only* that blocker → now **fully unblocked, promotable** (Coziness-only).
> - The rest now block *only* on their remaining pack/weight/video-exitus item (e.g. `rmbg` → just the
>   Inspyrenet-Rembg pack; `kontexteditii` → just KJNodes; `i2v*` → video-exitus + Wan weights).
> - **`sdxl-plus`** still also needs the optional-branch pruning pass (the *second*, separate enabler).

Drafts live in **`src/crystal/workflows/drafts/<id>-v1.draft.json`** — a subdir so the hermetic gate
(which globs `src/crystal/workflows/*.json` non-recursively) does NOT pick them up. Each draft carries
the worked-out `aditus`/`slotMap`/`inputTemplate` (from `port-workflow.ts`) + resolved `customNodes` +
a `blocked` note. They promote to runnable templates (move up one dir, drop `.draft`, add the seeds)
with no further graph work once their blocker clears.

> **Tier correction:** the prior handoff listed `sdxlplus` as Tier-1 unblocked t2i ("sdxl + Coziness
> multi-lora"). The actual graph takes **3 required image inputs** (style/control/pose) and uses
> IPAdapter + ControlNet + Canny + OpenPose + rgthree — it is i2i·control, blocked by **both** the
> image-input primitive and the IPAdapter/rgthree/OpenPose packs. The genuinely-landable Tier-1 set
> was **sdxl + chroma** only.

### `sdxlplus` decomposition (the "combo" untangled)

`sdxlplus` was an **overloaded multi-mode graph**: one pipeline with IPAdapter in the model path and
Canny+OpenPose ControlNets stacked in the conditioning path, where `Any Switch (rgthree)` nodes bypass
each stage depending on which of the 3 images you fed it (and always fed IPAdapter *some* image — the
"messed up" always-on bug). Its actual value, though, is **composability**: style+pose, canny+style, any
subset, in one sampling pass.

**Primary target — `sdxl-plus-v1.draft.json` (the clean unified flow):** prompt + 3 OPTIONAL image inputs
(`style_image`/`canny_image`/`pose_image`); every subset = the same flow. No `Any Switch`, no rgthree — an
absent input's branch is pruned at compile time (the `conditionalBranches` block in the draft is the
declarative spec; all 2³ subsets validated to resolve with no dangling links). This is the best UX (one
knob set, all combinations) and stays one atomic Essentia.
`BLOCKED: needs i2i image-input primitive + Compiler optional-branch pruning` — the pruning capability is
specced in **`docs/spec/optional-conditioning-pruning.md`** (a general, reusable Compiler feature, not a
hack; main-thread engine work).

**Fallback / building blocks — three atomic single-flavor drafts** (need only the i2i primitive, no
pruning — so they ship sooner and degrade gracefully if pruning isn't built):

| Draft | Flavor | Extra pack | Weight to declare on promote |
|---|---|---|---|
| `sdxl-style-v1.draft.json` | IPAdapter style transfer | ComfyUI_IPAdapter_plus | IPAdapter-SDXL + CLIPVision (UnifiedLoader auto-fetches) |
| `sdxl-canny-v1.draft.json` | Canny ControlNet | — (Canny/ControlNet are core) | `t2i-adapter-canny-sdxl-1.0` |
| `sdxl-pose-v1.draft.json`  | OpenPose ControlNet | ComfyUI-OpenPose | `t2i-adapter-openpose-sdxl-1.0` |

All share the SDXL base checkpoint/fundamentum (already seeded). `sdxl-plus` supersedes them once pruning
lands; the `rgthree-comfy` dependency **vanishes** in both expressions — it only existed to multiplex modes.

## Model URL validation (2026-06-19, with HF token)

HEAD-checked every pinned weight URL. **5/6 return 200; one is gated.** Note the pod downloader
(`comfyrunner.py`) uses plain unauthenticated `wget` — so even with a valid HF token locally, **gated HF
URLs won't fetch on a pod**. The fix is the existing convention: mirror gated/auth weights to R2
(`models.miladystation2.net`) as `source[0]` (auth-free), which all the flux.1 weights already do.

| Weight | Status |
|---|---|
| `flux1-kontext-dev` (Comfy-Org fp8) | ✅ 200, ungated |
| `qwen3-8b-flux2` (Comfy-Org) | ✅ 200, ungated |
| `flux2-vae-full-encoder` (BFL small-decoder) | ✅ 200, ungated |
| `4x-UltraSharp` (lokCX) | ✅ 200, ungated |
| `chroma-unlocked-v35` (lodestones) | ✅ 200, ungated |
| `flux2-klein-9b-fp8` (BFL) | ⚠️ 403 — `gated: auto`. URL correct; needs a one-time gate-accept on the HF account AND/OR an R2 mirror (pod wget is unauthenticated). |

## Custom-node packs — authoritative pack→URL map

Pulled **2026-06-19** from the comfydeploy machine custom-node manifests via API
(`GET /api/machine/:id` → `docs_command_steps.steps[type=custom-node]`, unioned across all machines).
This resolves the previously-TBD column.

| class_type(s) in graph | Pack | URL |
|---|---|---|
| `MultiLoraLoader`, `LoraTextExtractor` | ComfyUI-Coziness | `https://github.com/skfoo/ComfyUI-Coziness` |
| `IPAdapterAdvanced`, `IPAdapterUnifiedLoader` | ComfyUI_IPAdapter_plus | `https://github.com/cubiq/ComfyUI_IPAdapter_plus` |
| `Any Switch (rgthree)`, other rgthree | rgthree-comfy | `https://github.com/rgthree/rgthree-comfy` |
| `OpenPose - Get poses` | ComfyUI-OpenPose | `https://github.com/alessandrozonta/ComfyUI-OpenPose` |
| `WD14Tagger\|pysssss` | ComfyUI-WD14-Tagger | `https://github.com/pythongosssss/ComfyUI-WD14-Tagger` |
| `InspyrenetRembg` | ComfyUI-Inspyrenet-Rembg | `https://github.com/john-mnz/ComfyUI-Inspyrenet-Rembg` |
| `ResizeAndPadImage`, `ImageConcanate` | ComfyUI-KJNodes | `https://github.com/kijai/ComfyUI-KJNodes` |
| `UltimateSDUpscale` | ComfyUI_UltimateSDUpscale | `https://github.com/ssitu/ComfyUI_UltimateSDUpscale` (upscale flows skipped) |
| ControlNet aux preprocessors | comfyui_controlnet_aux | `https://github.com/Fannovel16/comfyui_controlnet_aux` |

**Strip on port** (not packs): `ComfyUIDeployExternal*`, `ComfyDeployOutputText` → `slotMap`/`exitus`.

**Core ComfyUI (no pack):** `Canny`, `CLIPVisionEncode/Loader`, `StyleModelApplyAdvanced/Loader`,
`ControlNetApplyAdvanced`, `ReferenceLatent`, `EmptySD3LatentImage`, `ConditioningZeroOut`,
`InstructPixToPixConditioning`, `CFGGuider`, `BasicGuider`, `FluxGuidance`, `ModelSamplingFlux/SD3`,
`LoraLoaderModelOnly`, `GetImageSize`, `CreateVideo`, `SaveVideo`, `EmptyHunyuanLatentVideo`,
`WanImageToVideo`, `WanFirstLastFrameToVideo`.

Full machine-pack union (all 50+ machines, for reference): Coziness, KJNodes, IPAdapter_plus,
rgthree-comfy, ComfyUI-OpenPose, WD14-Tagger, Inspyrenet-Rembg, UltimateSDUpscale, controlnet_aux,
Comfyroll, Impact-Pack/Subpack, ppm, Custom-Scripts, sd-dynamic-thresholding, Detail-Daemon,
wlsh_nodes, comfy-image-saver, was-node-suite, ComfyUI-GGUF, VideoHelperSuite, Frame-Interpolation,
essentials, PuLID_Flux_ll, TiledDiffusion, cg-use-everywhere, VLM_nodes, Qwen-TTS, mxToolkit.
