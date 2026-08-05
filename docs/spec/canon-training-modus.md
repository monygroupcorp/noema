# Canon Training Modus (ai-toolkit LoRA) — architecture & expansion guide

**Status: 2026-06-24.** The canon ai-toolkit LoRA-training modus is built and **live-verified on
real GPUs** — local (the 4090) and remote (RunPod SECURE pods), with on-pod auto-captioning. This
doc is the durable reference for **how it fits together** and **how to add more training options**
when we return. It is written so you can extend it without re-deriving the design from the code.

---

## 1. What it is (the user contract)

One discoverable canon flow, `MODUS_AITOOLKIT_TRAINING` (seeded `canonica`), that turns a **dataset
of images** into a **hosted LoRA + a registered `Intella`**. The user brings:

- **images** (required) — a dataset reference (a `corpusId`, or an inline R2 image manifest);
- **captions** (optional) — if absent, the modus generates them itself (§5);
- a few **knobs**: `triggerWord`, `baseModel`, `steps` (+ optional `saveEvery`, `rank`, `gpuId`,
  `name`, `ownerAnimaId`, `autocaption`).

The user **never** authors a training yaml — the modus owns config generation. "We ask for images,
maybe captions, and we do everything else."

Output exitus: `{ trained, steps, loraId, loraUrl }`. The LoRA is hosted in R2 under
`models/<intellaId>/<name>.safetensors` and registered as a private `lora` `Intella`
(familia = the base-model compat key, e.g. `flux2-klein`; trigger = the trigger word), so the
trigger-map resolves it for its owner the moment training finishes.

---

## 2. Two runtimes, one modus

The modus is identical; **a box runs either the local cursor or the remote cursor** (mutually
exclusive in `container.ts`). Both generate their own config, both end at the same finality.

| | Local (`AitoolkitTrainingCursor`) | Remote (`RemoteAitoolkitTrainingCursor`) |
|---|---|---|
| Where | operator's own GPU, `docker run` | a provisioned, **billed** RunPod SECURE pod |
| Sync? | sync (`{kind:'sync'}`), charges `0n` | async (`{kind:'async', externusJobId}`), bills pod-seconds |
| Config dir | host-mounted `config/` | shipped base64 via env |
| Dataset | a local path | resolved to an R2 manifest the pod pulls |
| Finality | injected `resolveOutput` (fs reader) | the shared webhook's `resolveExitus` (url reader) |
| Enabled by | `config.aitoolkit` | `config.aitoolkitRemote` + `AITK_REMOTE_ENABLE=1` |

### The remote path end to end
1. **Cursor** (`RemoteAitoolkitTrainingCursor`) reads the high-level aditus, calls the launcher,
   stamps `externusJobId` + `agens`, returns `{kind:'async'}`.
2. **Launcher** (`RemoteAitkLauncher`):
   - resolves the dataset ref → a manifest `[{url,caption?}]` (`datasetManifest.ts`);
   - generates the training yaml (`buildAitkConfig`, pod-side dataset path `/aitk/dataset`);
   - generates the caption yaml when `autocaption` is on (`buildAitkCaptionConfig`);
   - assembles the pod env + the **bootstrap recipe** (`setup[]`);
   - calls the provisioner.
3. **Provisioner** (`SecurePodClient.launchTrainingPod`, behind the `TrainingPodProvisioner` port):
   provisions a pod, waits for SSH, runs `setup[]`, uploads `aitktrainer.py`, `nohup`-launches it
   detached (+ injected `RUNPOD_POD_ID`), returns the pod id. **Fire-and-forget** — no held stream.
4. **Pod** (`scripts/pod/aitktrainer.py`): writes the config, pulls the manifest images (+caption
   sidecars), **auto-captions gaps** (§5), seeds the SQLite Job row, runs `run.py`, polls the row →
   POSTs a minimal `Progressus` to `/runner/status` (Slice A), then uploads the LoRA to R2 and fires
   the completion webhook.
5. **Finality** (the shared `executionWebhook` → `resolveExitus` = `makeTrainingExitusResolver`):
   reads the pod-uploaded LoRA URL, re-hosts it under our durable key, registers the `Intella`.

### The base image (the modular pivot)
The pod runs a **stock** RunPod base — `runpod/pytorch:1.0.7-cu1281-torch291-ubuntu2404`
(`DEFAULT_AITK_IMAGE`) — which already ships torch 2.9.1 + CUDA 12.8.1 + sshd. ai-toolkit is
**bootstrapped onto it over SSH** (the `setup[]` recipe), exactly like ComfyUI/vLLM. **No custom
image to build or publish.** A baked image (`scripts/pod/aitk-trainer/`) exists as a documented
fallback only (faster cold start at the cost of a 30GB image to maintain).

The bootstrap `setup[]` (built in `RemoteAitkLauncher`, run by `SecurePodClient._bootstrapDetached`):
1. `apt-get install -y libgl1 libglib2.0-0 ffmpeg` — system libs ai-toolkit's opencv/ffmpeg need
   (the stock base lacks them → `import cv2` crash without this);
2. `git clone ostris/ai-toolkit /aitk && git checkout <DEFAULT_AITK_REF> && submodule update`;
3. `pip install -r requirements.txt boto3` — ai-toolkit deps (torch already present);
4. **`pip install --force-reinstall --no-deps torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1
   --index-url …/cu128`** — restore the matched cu128 trio. ai-toolkit's deps disturb the base's
   torch stack, so `torchaudio` loads against a mismatched libtorch (undefined-symbol crash) without
   this. **This step is load-bearing; do not drop it.**

---

## 3. Config generation (`src/crystal/aitkConfig.ts`)

Pure, deterministic templates (no yaml dep). The modus owns these — users never see them.

- **`buildAitkConfig({name, datasetPath, triggerWord, baseModel, steps, …})`** → the ai-toolkit
  `ui_trainer` yaml. Branches on a **per-base-model PRESET** (`AITK_BASE_PRESETS`) for the model
  block + tuned defaults (arch, resolution, rank, lr, low-VRAM quantization).
- **`buildAitkCaptionConfig({datasetPath, …})`** → the `Qwen3VLCaptioner` extension-job yaml
  (`recaption:false` so existing captions win).

---

## 4. Adding a new BASE MODEL (the cheap, common expansion)

This is the main "more training options" axis, and it is **one preset + a verify**.

1. **Add a preset** to `AITK_BASE_PRESETS` in `src/crystal/aitkConfig.ts`:
   ```ts
   'sdxl': {
     nameOrPath: 'stabilityai/stable-diffusion-xl-base-1.0',
     arch: 'sdxl',                 // ai-toolkit's arch key for this base
     resolution: [1024],
     rank: 16, lr: 1e-4,
     quantize: false, quantizeTe: false, lowVram: false, qtype: 'qfloat8',
   },
   ```
   Add aliases to `PRESET_ALIASES` if helpful. The user-facing contract stays
   `{dataset, triggerWord, baseModel, steps}` — only the preset table grows.
2. **Confirm the ai-toolkit arch key + low-VRAM strategy** against the cloned ai-toolkit
   (`/aitk/…` arch configs) — each base wants different quantization/VRAM flags. klein-4b is the
   proven low-VRAM (24GB) shape; bigger bases may need different `low_vram`/`quantize`.
3. **Decide the Intella `familia`** (the LoRA compat key) for the new base — the finalizer reads
   `aditus.familia`; it must match what the inference/gen side expects so the trigger-map resolves.
4. **Test:** extend `tests/unit/crystal/aitkConfig.test.ts` (the preset resolves, the yaml carries
   the right model block). Hermetic.
5. **Live-verify** the new base end to end with the spike harness (§6) — a fresh base means a new
   weight download + a real training run; don't trust it until it trains on a pod.

### Adding a new TRAINING TYPE / framework (heavier)
LoRA-on-ai-toolkit is one shape. A full finetune, a different trainer (kohya, etc.), or a
non-image medium needs:
- a **new pod runner** (a sibling of `aitktrainer.py`) speaking that framework's job/poll/output
  contract — keep the same `/runner/status` Progressus + completion-webhook shapes so finality and
  Slice A stay runner-agnostic;
- a **new cursor + ministerium** (or a `genus`/`runtime` discriminator on the existing one);
- its own config generator.
Reuse everything runner-agnostic: the manifest resolver, the finalizer, the Progressus/webhook
spine, `SecurePodClient` provisioning. Budget this as a real slice, not a preset.

---

## 5. Auto-captioning (images-only datasets) — Path A

ai-toolkit ships its **own** Qwen3-VL captioner (`extensions_built_in/captioner/Qwen3VLCaptioner.py`,
plain `transformers` in-process — **no second pod, no vLLM, no llama.cpp**). So captioning happens on
the **training pod**:

- `buildAitkCaptionConfig` generates a `Qwen3VLCaptioner` extension job (model
  `Qwen/Qwen3-VL-8B-Instruct`, `recaption:false`, prompt = `DEFAULT_CAPTION_PROMPT`, which mirrors
  `ESSENTIA_QWEN3_VL_CAPTION`'s intent so the on-pod captioner and the crystal caption arm agree).
- The launcher passes it as `AITK_CAPTION_CONFIG_B64` when `autocaption !== false` (default on;
  `aditus.autocaption:false` opts out).
- `aitktrainer.py`: after staging, `count_uncaptioned()` checks for images lacking a `.txt`; if any,
  `run_caption()` runs the caption job (`run.py`, **with `AITK_JOB_ID` stripped** so the captioner
  doesn't touch the training Job row we poll), then trains. Manifest-provided captions always win.

**Why not Slice D (the crystal `COMPOSITUS_IMAGE_CAPTION` / vLLM Qwen3-VL):** Path A is one pod;
Slice D would mean a second (vLLM) pod + N async caption `Acta` (or a new batch/Collectio flow) +
needed the `projectExitus` text fix. We chose A for "ship images-only on the pod we already proved."
**Slice D remains the user-facing caption-as-a-service tool** — different context; not dead work.

To swap the caption model or prompt: pass `model`/`captionPrompt`/`maxNewTokens` to
`buildAitkCaptionConfig` (e.g. from a future `aditus.captionModel`).

---

## 6. Live-verify recipe (the spike harnesses)

CI covers every crystal seam hermetically; the GPU pieces are proven by spikes (real pod $).

- **Local:** `scripts/spike-koh-training.ts` — trains on the 4090 via the local cursor. Mongo
  HARD-PINNED to `noemaplane_test`.
- **Remote:** `scripts/spike-koh-remote.ts` — drives cursor→launcher→`SecurePodClient` on a real
  pod, with a tiny local receiver for `/runner/status` + the completion webhook (runs the same
  finality `index.ts` wires). `SPIKE_STRIP_CAPTIONS=1` forces the images-only auto-caption path.

Remote run prerequisites (learned the hard way):
- A **public tunnel** the pod can POST back to — `cloudflared tunnel --url http://localhost:7799`
  (free, no account) → `NOEMA_PUBLIC_BASE=https://<id>.trycloudflare.com`.
- The **RunPod SSH key** matching the account. On archbox that's `~/.ssh/vastai_key` (registered as
  `vastai`; RunPod injects all account keys, so any registered key authenticates). The `.env`
  `RUNPOD_SSH_KEY_PATH` may point at a Mac path — override it on the command line.
- `RUNPOD_API_KEY`, `R2_*` in `.env`. Dataset staged via `scripts/stage-koh-r2.ts` (manifest at
  `scripts/.koh-manifest.json`).
- Run: `SPIKE_STRIP_CAPTIONS=1 RUNPOD_SSH_KEY_PATH=~/.ssh/vastai_key NOEMA_PUBLIC_BASE=… node
  --env-file=.env --import tsx scripts/spike-koh-remote.ts`. The harness terminates the pod after;
  always confirm **0 leaked pods** (`myself { pods }` GraphQL).

Cold-pod timeline (250 steps, klein-4b): ~4 min provision+bootstrap · captioning (if images-only)
downloads Qwen3-VL ~16GB · klein weights ~25GB pull · ~6 min train. ~10–13 min total after launch.

---

## 7. What's live-verified vs hermetic-only

- **LIVE-VERIFIED:** local training; remote training (stock-base bootstrap); images-only on-pod
  auto-captioning; finality (R2 LoRA + Intella + trigger-map). koh, klein-4b, 250 steps.
- **HERMETIC-ONLY (never run live):** Slice D crystal caption arm (`COMPOSITUS_IMAGE_CAPTION` via
  vLLM Qwen3-VL); any base model other than klein-4b; the baked fallback image's GPU smoke test.

---

## 8. Expansion backlog (when we come back)

1. **HuggingFace publishing — decoupled, the explicit NEXT focus.** Training already lands the LoRA
   in R2 + a `lora` Intella; publishing is a **separate downstream act** that consumes that Intella
   (a user trains, then *optionally* publishes, maybe later, maybe to multiple venues). The arm
   exists: `Editio`'s registry-parameterized `ModelPublishAdapter` (HF/Civitai) + a `huggingFaceToken`
   config that wires a real LFS uploader. **Gaps to close:**
   - the model weight-**upload is a placeholder** (registers a repo handle, doesn't push the file) —
     make the LFS upload real;
   - **model-card plumbing** — generate the HF repo `README.md`/metadata (base model, trigger word,
     license, sample prompt/image) from the Intella's fields. The training run already knows all of
     this (`triggerWord`, `familia`, `steps`), so the card is mostly a projection. **Good model cards
     are the stated priority for this work.**
2. **More base-model presets** (§4) — SDXL, FLUX-dev, etc. Cheap; preset + verify each.
3. **Slice D live-verify** — prove the crystal vLLM Qwen3-VL caption arm end to end (the
   understanding/inference executor path, never run live). Independent of training.
4. **DONE — `projectExitus` text outputs** (commit `716a7e51`): text-exitus runs (caption/summary)
   now land under the declared text Porta (`caption`/`text`) instead of a raw `outputs` blob. This
   unblocks routing any text-output inference (incl. Slice D) through the normal completion path.

---

## 9. Key files

| Concern | File |
|---|---|
| Modus seed | `src/crystal/seeds/modi.ts` (`MODUS_AITOOLKIT_TRAINING`) |
| Local cursor | `src/crystal/AitoolkitTrainingCursor.ts` |
| Remote cursor | `src/crystal/RemoteAitoolkitTrainingCursor.ts` |
| Launcher + provisioner port | `src/crystal/RemoteAitkLauncher.ts` |
| Provisioning (detached) | `src/crystal/SecurePodClient.ts` (`launchTrainingPod`) |
| Pod runner | `scripts/pod/aitktrainer.py` (+ `test_aitktrainer.py`) |
| Config generation | `src/crystal/aitkConfig.ts` (`buildAitkConfig`, `buildAitkCaptionConfig`) |
| Dataset → manifest | `src/crystal/datasetManifest.ts` |
| Finality | `src/crystal/trainingFinalizer.ts` |
| Exitus projection | `src/execution/projectExitus.ts` |
| Container wiring | `src/container.ts` (`config.aitoolkit` / `config.aitoolkitRemote`) · `src/index.ts` (env) |
| Caption building blocks (Slice D) | `src/crystal/seeds/essentiae.ts` (`ESSENTIA_QWEN3_VL_CAPTION`), `src/crystal/seeds/compositi.ts` (`COMPOSITUS_IMAGE_CAPTION`) |
| Live-verify harnesses | `scripts/spike-koh-training.ts`, `scripts/spike-koh-remote.ts`, `scripts/stage-koh-r2.ts` |
| Baked-image fallback | `scripts/pod/aitk-trainer/` |
