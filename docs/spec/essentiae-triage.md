# Essentiae triage — new-medium flows

**Date:** 2026-06-11
**Status:** triage artifact — scoping the 5 new models into `Essentia` + `Fundamentum` seeds.
**Method:** lean inline pass over the modelcard links; each card read for runtime, I/O shape, and inference code.
**Goal:** stand up 5 models on rented RunPod pods — 2 generation, 3 understanding-of-a-new-medium.

> **Hosting:** every model is **downloaded onto a rented RunPod pod and run there** (`ministerium: 'runpod'`).
> No third-party API. Where a card mentions an "OpenAI-compatible API," that's the *local interface a vLLM/SGLang
> server exposes on the pod*, not a call out to OpenAI.

---

## The set

| flow | model | direction | purpose |
|---|---|---|---|
| `text→music` | HeartMuLa-oss-3B | text → audio (music) | **generation** |
| `image/text→3d` | Hunyuan3D-2.1 | image\|text → mesh (.glb) | **generation** |
| `image+text→text` | Qwen3-VL-8B-Instruct | image+text → text | **understanding** (image) |
| `audio→text` | MOSS-Music-8B-Instruct | audio+text → text | **understanding** (music/audio) |
| `video/image→text` | ShotVL-7B | video\|image → text | **understanding** (video/cinematography) |

- **Generation** = produce a new artifact (`.mp3`, `.glb`). Heavy, custom libs, binary output → forces type work.
- **Understanding** = read a new medium, emit text. All Qwen-VL/Qwen3 family, ~16–20 GB, text output → no type gaps.

---

## Artifact 1 — runtime / cost table

All rows `ministerium: 'runpod'` (downloaded + run on a pod). "base image" is the pod's OCI image.

| flow | on-pod runtime | base image | model-load mechanism | aditus → exitus | GPU/VRAM | ships runnable code? |
|---|---|---|---|---|---|---|
| HeartMuLa | custom `heartlib` (torch) | `runpod/pytorch` (CUDA) | local ckpt dir, `--version 3B`, `--lazy_load`; companions HeartCodec (req) + HeartTranscriptor (opt) | lyrics+tags (text) → `.mp3` | ~24 GB single 4090 w/ lazy_load (2×4090 recommended) | **yes — github** (`heartlib`), one-shot CLI |
| Hunyuan3D-2.1 | custom `Hunyuan3D-2` lib (diffusers-compat) | `runpod/pytorch` | two stages: shape-gen → PBR texture-gen; companions DINOv2 + FLUX/SD | image\|text → `.glb` (textured PBR mesh) | ~24 GB class (10 GB shape + texture stage) | partial on card; full in github; **also strong ComfyUI community support** |
| Qwen3-VL-8B | transformers / vLLM/SGLang (on-pod) | `runpod/pytorch` or `vllm/vllm-openai` | `Qwen3VLForConditionalGeneration.from_pretrained(device_map=auto)`; flash-attn2 | image+text → text | ~18–20 GB BF16 | **yes — card** |
| MOSS-Music-8B | transformers / SGLang (on-pod) | `runpod/pytorch` or `vllm`/`sglang` | `AutoModel.from_pretrained(trust_remote_code)`; Qwen3-8B backbone + audio encoder; FFmpeg7 | audio+text → text | ~18 GB BF16 | **yes — card** |
| ShotVL-7B | transformers (`Qwen2_5_VLForConditionalGeneration`) / vLLM (on-pod) | `runpod/pytorch` or `vllm` | fine-tune of Qwen2.5-VL-7B; `qwen_vl_utils` | video\|image → text | ~16–20 GB BF16 | **yes — card** |

Notes:
- **Understanding rows are near-identical** — Qwen-VL/Qwen3 family, transformers+vLLM, ~16–20 GB, text-out. One shared
  substrate, weights swapped per flow.
- **Generation rows are bespoke** — custom libs, multi-model, multi-stage, binary-artifact out.

---

## Artifact 2 — bucket partition (executor shape)

All pod-hosted; buckets = the on-pod runtime the runner must support:

| bucket (executor) | flows | nature | runner work |
|---|---|---|---|
| **ComfyUI-pod** (exists) | flux, sd1-5 (existing); Hunyuan3D *(alt path)* | graph-driven | none new |
| **python-modelcard-pod** (NEW) | HeartMuLa; Hunyuan3D *(primary)* | `git clone + pip install -e . + run script`, one-shot CLI, binary out | **1 new executor** |
| **transformers/vLLM-pod** (NEW) | Qwen3-VL, MOSS-Music, ShotVL | download weights → serve via transformers or vLLM/SGLang; text out | **1 new executor**, serves all 3 |

**Scope verdict:** ~**2 new executors** beyond ComfyUI. The understanding track is **one** fundamentum + **one** serving
executor covering all three flows (same runtime + VRAM class, weights swapped). The generation leaves need the
`python-modelcard` executor. ComfyUI stays as-is; Hunyuan3D can fall back to it.

---

## Artifact 3 — crystal mapping & gaps

Mapping each card to real `Essentia`/`Fundamentum` fields surfaced 5 gaps. Ordered by blast radius.

### Gap 1 — `EssentiaCategoria` has no `3d` (type addition)
`src/types/essendi.ts:27` — enum is `image | video | audio | text | code | chain`. Hunyuan3D can't declare its output.
**Fix:** add `'3d'` (or `'mesh'`). One-line enum change; ripples to exhaustive `switch`es on categoria.

### Gap 2 — port-type vocabulary has no `mesh`/`3d` (type addition)
Ports/anchors are typed `text | image | video | audio | int | float`. `exitus: { mesh: { type: '3d' } }` references a
type the connection-validator and renderers don't know. **Fix:** add a `3d`/`mesh` port type + anchor icon +
`normalizeType()` handling.

### Gap 3 — output materialization is image-centric (plumbing)
Run-completion stores the result in R2 and delivers it as an **image** (inline Telegram preview, `<img>` in API result).
Two new output kinds break this:
- **audio (`.mp3`, HeartMuLa)** — `audio` is already in the type vocab; only the *delivery branch* is missing
  (content-type, Telegram audio/document send). **Plumbing only.**
- **mesh (`.glb`, Hunyuan3D)** — no inline preview; delivered as a document attachment (optional rendered thumbnail).
  Needs Gaps 1+2 *and* this branch.
**Fix:** branch output handling on `categoria`/exitus-port-type → {R2 content-type, delivery shape}. Same seam video
and any future binary modality reuses.

### Gap 4 — `workflowTemplate` is ComfyUI-shaped (form-half mismatch)
`Essentia.workflowTemplate` (`src/types/essendi.ts:87`) assumes a ComfyUI graph id. The two new runtimes have no graph:
a python-modelcard flow's FORM is a **run script + aditus→CLI-flag mapping**; a transformers/vLLM flow's FORM is a
**prompt template + generation params**. **Fix:** optional non-ComfyUI form variants on the Essentia
(`python-modelcard`: script + arg map; `llm`: prompt template + gen params), parallel to `workflowTemplate`.

### Gap 5 — fundamenta need their `Intella` weight records seeded
Generation leaves provision **multiple weights** (HeartMuLa: generator + HeartCodec; Hunyuan3D: shape + texture +
DINOv2); understanding models are single-weight. `Fundamentum.intellae[]` models these as `{id, role}` FK refs, but the
referenced `Intella` records don't exist yet. **Fix:** seed each weight's `Intella` as part of building its fundamentum.

**ADR:** Gaps 1–4 + the runner/executor split are decided in **ADR-0007**
(`docs/adr/0007-runner-executor-split-and-new-medium-types.md`).

---

## Seed sketches (illustrative — not final)

```ts
// GENERATION — python-modelcard pod
Fundamentum {
  id: 'heartmula-pytorch', nomen: 'HeartMuLa · PyTorch', versio: '1.0.0',
  imageId: 'runpod/pytorch', imageVersion: '<cuda-torch tag>',
  runtime: 'python-modelcard',                 // NEW runtime value
  intellae: [
    { id: 'heartmula-3b', role: 'generator' },
    { id: 'heartcodec-20260123', role: 'codec' },   // REQUIRED companion (Gap 5)
  ],
  vramGb: 24, canonica: true,
}
Essentia {
  id: 'heartmula-3b', categoria: 'audio', ministerium: 'runpod', genus: 'atomicus',
  fundamentumId: 'heartmula-pytorch', fundamentumVersio: '1.0.0',
  aditus: { lyrics: text(req), tags: text(req), max_audio_length_ms: int(=240000),
            temperature: float, topk: int, cfg_scale: float, input_seed: int },
  exitus: { audio: { type: 'audio' } },        // type OK; delivery branch missing (Gap 3)
  // form half: python-modelcard script + arg map (Gap 4) — NOT workflowTemplate
}

Fundamentum {
  id: 'hunyuan3d-pytorch', runtime: 'python-modelcard', imageId: 'runpod/pytorch',
  intellae: [{ id:'hunyuan3d-21-shape', role:'shape' },
             { id:'hunyuan3d-21-paint', role:'texture' },
             { id:'dinov2', role:'feature-extractor' }],
  vramGb: 24, canonica: true,
}
Essentia {
  id: 'hunyuan3d-21', categoria: '3d',          // Gap 1 — enum member missing
  ministerium: 'runpod', fundamentumId: 'hunyuan3d-pytorch',
  exitus: { mesh: { type: '3d' } },             // Gap 2 — port type missing
  aditus: { image: image(opt), prompt: text(opt), /* + stage flags */ },
}

// UNDERSTANDING — transformers/vLLM pod (SHARED substrate, weights swapped per flow)
Fundamentum {
  id: 'qwen-vl-vllm', nomen: 'Qwen-VL · vLLM', runtime: 'vLLM',
  imageId: 'vllm/vllm-openai', imageVersion: '<tag>',
  intellae: [{ id: 'qwen3-vl-8b', role: 'lm' }],   // swap per flow: moss-music-8b / shotvl-7b
  vramGb: 20, canonica: true,
}
Essentia {
  id: 'qwen3-vl-8b', categoria: 'text', ministerium: 'runpod', genus: 'atomicus',
  fundamentumId: 'qwen-vl-vllm', fundamentumVersio: '1.0.0',
  aditus: { prompt: text(req), image: image(opt), max_tokens: int, temperature: float },
  exitus: { text: { type: 'text' } },           // native — no exitus gap
  // form half: prompt template + gen params (Gap 4 'llm' variant) — NOT workflowTemplate
}
// MOSS-Music: aditus.audio + prompt → text;  ShotVL: aditus.video|image + prompt → text  (same substrate)
```

---

## Next actions (build order)

1. **`transformers/vLLM` executor + shared `qwen-vl-vllm` fundamentum** — serves all 3 understanding flows
   (Qwen3-VL, MOSS-Music, ShotVL); weights swapped per flow. Text out → no type work needed, fastest to ship.
2. **`python-modelcard` executor** — `clone + pip install -e . + run script`; covers both generation leaves.
3. **ADR-0007** (drafted) — runner/executor split + Gaps 1–4: extend `EssentiaCategoria` (`3d`), port types
   (`mesh`), exitus materialization (audio + mesh delivery), Essentia form half (python-modelcard + llm variants),
   register the 2 executors.
4. **Seed `Intella` records** — HeartMuLa+HeartCodec, Hunyuan3D shape+texture+DINOv2, Qwen3-VL, MOSS-Music, ShotVL.
5. **Seed the 5 Essentiae + their fundamenta** into `src/crystal/seeds/`.
