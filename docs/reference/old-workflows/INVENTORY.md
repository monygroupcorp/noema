# Old-workflow inventory → crystal port roadmap

The 17 comfydeploy workflows in this folder, mapped to **capability-map signatures/verbs** (the gen-flow
backlog) and the **custom-node packs** each needs. Reference, not canon — port by re-expressing in
crystal form (see README.md). `sdxli2iplus` failed JSON parse (likely UI-format, not API) — re-grab.

## Workflow → signature / verb

| File | Signature | Verb (capability-map) | Notes |
|---|---|---|---|
| `sdxl`, `chroma` | t2i | **make** (sdxl / chroma family) | base txt2img |
| `fluxi2i`, `sdxli2iplus(v2)` | i2i | **effect** | img2img / restyle |
| `kontextedit`, `kontexteditii` | i2i·instruction | **effect** (edit flavor) | flux Kontext edit |
| `fluxpluscontrol`, `sdxlplus` | i2i·control | **effect** (controlnet/ipadapter flavor) | Canny / ControlNet / IPAdapter / OpenPose |
| `fluxplusstyleref` | i2i·styleref | **effect** (style flavor) | CLIPVision + StyleModel (flux redux) |
| `upscale`, `sdxlupscaleillustrious` | i2i·upscale | **enhance** | UltimateSDUpscale |
| `rmbg` | i2i (bg removal) | **enhance** (or effect) | InspyrenetRembg |
| `tag`, `sdxli2iplusv2` | i2t | **describe** | WD14 tagger |
| `i2vunknown`, `ii2vunknown` | i2v | **animate** | Wan image→video |
| `unknownt2v` | t2v | **direct** | Hunyuan text→video |

Per ADR-0004 the conditioning flavors (control / ipadapter / styleref / edit / upscale) are **flows
bound to a verb**, NOT new verbs — they become canonical or saved flows under `effect`/`enhance`/etc.

## Custom-node packs (the "machine details" gap)

- **Strip on port** (not packs): `ComfyUIDeployExternal*`, `ComfyDeployOutputText` → `slotMap`/`exitus`.
- **Known:** `LoraTextExtractor` / `MultiLoraLoader` → `https://github.com/skfoo/ComfyUI-Coziness`.
- **Pack URL TBD — pull from the comfydeploy machine/snapshot config (API, not the UI):**
  `WD14Tagger|pysssss`, `InspyrenetRembg`, `UltimateSDUpscale`, `IPAdapterAdvanced`/`IPAdapterUnifiedLoader`,
  `Any Switch (rgthree)`, `CR Aspect Ratio`/`CR VAE Input Switch`, `OpenPose - Get poses`, and likely
  `ImageConcanate`/`GetImageSize`/`ResizeAndPadImage`.
- **Core ComfyUI (no pack):** `Canny`, `CLIPVisionEncode/Loader`, `StyleModelApplyAdvanced/Loader`,
  `ControlNetApplyAdvanced`, `ReferenceLatent`, `EmptySD3LatentImage`, `ConditioningZeroOut`,
  `InstructPixToPixConditioning`, `CFGGuider`, `LoraLoaderModelOnly`, `ModelSamplingSD3`, `CreateVideo`,
  `SaveVideo`, `EmptyHunyuanLatentVideo`, `Wan*`.

## Next pass (deferred)
Fetch the comfydeploy **machine custom-node manifest via API** → authoritative pack→URL map → fills the
TBD column. Only **Coziness** is needed for the near-term ports (sd15/flux make+effect, TASK-008); the
advanced flows unlock as their packs are mapped.
