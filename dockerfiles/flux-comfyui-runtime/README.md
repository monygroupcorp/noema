# flux-comfyui-runtime — Baked image for VastAI cold-start benchmark

A Docker image with ComfyUI, PyTorch, and the FLUX.1-schnell model bundle pre-installed. Used as a drop-in replacement for `pytorch/pytorch:2.x-cuda12.1` in the VastAI cold-start benchmark to test whether eliminating in-job model downloads reduces effective cold-start time.

**Context:** benchmarking put VastAI cold start at ~11 min on average, of which ~6 min was in-job model downloads. This image bakes those downloads into the image itself.

---

## Image contract

What the image guarantees:

- **Filesystem layout** — `/workspace/ComfyUI/` contains a checkout of ComfyUI at the pinned ref. All model paths follow ComfyUI's standard layout (`/workspace/ComfyUI/models/{unet,vae,clip,loras,checkpoints}/`).
- **Pre-installed models:**
  - `models/unet/flux1-schnell.safetensors` (23 GB)
  - `models/vae/ae.safetensors` (320 MB)
  - `models/clip/t5xxl_fp16.safetensors` (9.2 GB)
  - `models/clip/clip_l.safetensors` (235 MB)
- **Pre-installed framework** — PyTorch 2.4.1, CUDA 12.1, ComfyUI requirements.txt fully installed.
- **No SSH daemon** — VastAI overlays its own SSHd; we don't manage SSH inside the container.
- **No auto-start of ComfyUI** — the container sleeps on boot. The job runner / benchmark explicitly starts ComfyUI via `cd /workspace/ComfyUI && python main.py --listen 0.0.0.0 --port 8188 ...` after SSH'ing in. This keeps the image a drop-in replacement for the unbaked `pytorch/pytorch` flow.
- **LoRAs are NOT baked** — they vary per user/job and are small (~300 MB each). The job runner downloads them at job time into `models/loras/`.

What it does NOT include:
- Custom ComfyUI nodes (none yet — add in a future image variant if needed)
- ControlNets, IPAdapters, embeddings (out of scope for the FLUX-schnell benchmark)
- SDXL or other base models (separate recipe — `sdxl-comfyui-runtime`)

## Layer order rationale

Layers are ordered most-stable to least-stable, with the heavy model layer LAST:

| Layer | Size | Stability | Cache impact when changed |
|---|---|---|---|
| Base PyTorch image | ~6 GB | Pinned via ARG, changes rarely | Full rebuild needed |
| System deps (git/wget) | ~50 MB | Rarely changes | Layers below rebuild |
| ComfyUI source (pinned ref) | ~50 MB | Updates intentionally | Models layer rebuilds (slow) |
| ComfyUI pip deps | ~3 GB | Tied to ComfyUI ref | Models layer rebuilds (slow) |
| **Model weights** | **~33 GB** | Stable until model swap | Bottom layer — replacing it is the only "big" rebuild |

If you swap models, only the last layer rebuilds. If you bump ComfyUI, the framework + models rebuild. If you bump PyTorch, everything rebuilds.

---

## Build

On a Linux machine with Docker installed and >=60 GB free disk space:

```bash
cd dockerfiles/flux-comfyui-runtime/

# Default build — uses pinned ARG defaults from the Dockerfile.
docker build -t stationthis/flux-comfyui-runtime:v1 .

# Override pinned versions if needed:
docker build \
  --build-arg PYTORCH_TAG=2.4.1-cuda12.1-cudnn9-runtime \
  --build-arg COMFYUI_REF=v0.3.10 \
  --build-arg R2_BASE=https://models.miladystation2.net \
  -t stationthis/flux-comfyui-runtime:v1 .
```

**Build time:** ~30–60 min on a home connection (model downloads dominate). Image will be ~42 GB on disk.

**Disk pressure:** `docker buildx prune` before build if your Docker disk is tight. Multi-layer build keeps intermediate sizes manageable but the model layer alone is 33 GB.

---

## Local test (no GPU required)

These tests verify the image is structurally correct without needing a CUDA-capable GPU. The actual generation test happens on the first VastAI run (the benchmark).

### 1. Container starts and stays alive

```bash
docker run --rm -d --name flux-test stationthis/flux-comfyui-runtime:v1
sleep 3
docker ps --filter name=flux-test  # should show running
docker stop flux-test
```

### 2. Filesystem layout is correct

```bash
docker run --rm stationthis/flux-comfyui-runtime:v1 \
  ls -lh /workspace/ComfyUI/models/unet/ /workspace/ComfyUI/models/vae/ /workspace/ComfyUI/models/clip/

# Expected output includes:
#   flux1-schnell.safetensors  ~23G
#   ae.safetensors             ~320M
#   t5xxl_fp16.safetensors     ~9.2G
#   clip_l.safetensors         ~235M
```

### 3. ComfyUI imports cleanly (CPU mode — no CUDA needed)

```bash
docker run --rm stationthis/flux-comfyui-runtime:v1 \
  python -c "import sys; sys.path.insert(0, '/workspace/ComfyUI'); import nodes; print('ComfyUI nodes module imported OK')"
```

This catches missing pip dependencies, broken ComfyUI installs, version conflicts. If it succeeds, the framework layer is good.

### 4. ComfyUI server boots (CPU mode — no CUDA needed)

```bash
docker run --rm -d --name flux-test -p 8188:8188 stationthis/flux-comfyui-runtime:v1 \
  bash -c "cd /workspace/ComfyUI && python main.py --cpu --listen 0.0.0.0 --port 8188"

# Wait for ComfyUI to start (it logs "Starting server" when ready)
sleep 30

curl -sf http://localhost:8188/system_stats | head -c 500
# Expected: JSON blob with system info

docker stop flux-test
```

If `/system_stats` returns valid JSON, ComfyUI booted successfully and the API is reachable. We don't run a full generation in CPU mode (would take 30+ min for FLUX) — that gets validated by the first VastAI benchmark run.

### 5. (Optional, requires NVIDIA GPU) Full generation smoke test

If your Linux box has a CUDA-capable GPU:

```bash
docker run --rm -d --name flux-test --gpus all -p 8188:8188 stationthis/flux-comfyui-runtime:v1 \
  bash -c "cd /workspace/ComfyUI && python main.py --listen 0.0.0.0 --port 8188"

sleep 60  # FLUX UNet load takes ~30-45s on first run

# Submit the same minimal workflow the benchmark uses:
curl -X POST http://localhost:8188/prompt \
  -H "Content-Type: application/json" \
  -d @../../scripts/vastai/baked-test-workflow.json   # see benchmark script for the workflow JSON

# Poll /history until images appear:
for i in {1..30}; do
  curl -s http://localhost:8188/history | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = any(any(o.get('images') for o in e.get('outputs', {}).values()) for e in d.values())
print('IMAGES_PRESENT' if ok else 'pending')" | grep -q IMAGES && break
  sleep 5
done

docker stop flux-test
```

---

## Push to registry

### Docker Hub (free for public repos)

```bash
# One-time setup
docker login

# Push (size and your upload bandwidth determine duration — ~1-2 hours on 100 Mbps)
docker push stationthis/flux-comfyui-runtime:v1
```

### GitHub Container Registry (also free for public)

```bash
# One-time setup — create a personal access token with packages:write scope
echo $GHCR_TOKEN | docker login ghcr.io -u YOUR_GH_USERNAME --password-stdin

docker tag stationthis/flux-comfyui-runtime:v1 ghcr.io/monygroupcorp/flux-comfyui-runtime:v1
docker push ghcr.io/monygroupcorp/flux-comfyui-runtime:v1
```

**Note on visibility:** the model weights baked into this image are public weights (FLUX.1-schnell is open-licensed). The image can safely be public.

---

## Use the image in the benchmark

After pushing, run:

```bash
node scripts/vastai/benchmark-cold-start-baked.js \
  --image stationthis/flux-comfyui-runtime:v1 \
  --runs 5
```

See the script header for full options. Defaults match the unbaked benchmark for direct comparison.

---

## Versioning

Tag scheme: `stationthis/flux-comfyui-runtime:vMAJOR`

- `v1` — initial baseline: PyTorch 2.4.1, ComfyUI v0.3.10, FLUX-schnell + ae + t5xxl_fp16 + clip_l
- Bump major version on any model swap or ComfyUI ref change. Never re-tag.
- The recipe document in the codebase (when ChainEngine recipes land) will pin a specific image tag.

## Troubleshooting

**Build fails at the model download layer with a 5xx error**
R2 bucket may be rate-limited briefly. Retry — the model layer is recoverable on its own thanks to layer order.

**Build runs out of disk**
Each layer's intermediate state lives in Docker's storage driver. Run `docker system df` to see usage; `docker buildx prune` to clear build cache. Need ~80 GB free during build (intermediate + final).

**`python main.py --cpu` fails with import errors**
Missing pip dependency. Check the requirements.txt for the pinned ComfyUI ref — sometimes the upstream requirements.txt drifts. Pin the version in the Dockerfile if needed.

**Image works locally but VastAI provisioning hangs**
VastAI's overlay may not coexist with our CMD. Try setting `runtype: 'ssh'` in the benchmark instance payload (the benchmark script already does this).
