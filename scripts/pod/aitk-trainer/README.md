# aitk-trainer — OPTIONAL baked ai-toolkit training image (fallback)

> **Not the default path.** Remote training (Slice E) runs on a **stock** RunPod base that already
> ships torch 2.9.1 + CUDA 12.8.1 — `runpod/pytorch:1.0.7-cu1281-torch291-ubuntu2404`
> (`DEFAULT_AITK_IMAGE`) — and bootstraps ai-toolkit over SSH, exactly like ComfyUI/vLLM. No custom
> image needed. This baked image is kept as a **fallback** for if the per-pod dep install proves too
> slow/fragile in prod (baking trades a maintained 30GB image for a faster, install-free cold start).

A RunPod SECURE pod pulls it, `SecurePodClient` SSHes in and launches `scripts/pod/aitktrainer.py`,
which trains a LoRA on a dataset manifest and reports through the same finality the local path proves.

## Why this image exists (the constraint that forced it)
- ai-toolkit's pins (transformers 5.5.3, diffusers-from-git, torchao 0.10.0) need **torch ≥2.9**;
  the *old* `runpod/pytorch:2.4` base failed to import diffusers. So this image bases on
  `nvidia/cuda:12.8.1-devel-ubuntu24.04` + `torch 2.9.1/cu128` (the proven `stationthis-klein` recipe).
  **The stock-base default solves the same constraint without a custom image** (RunPod now publishes a
  cu128/torch291 tag), which is why this image is now the fallback rather than the primary path.
- A pod has **no host mount**, so the ai-toolkit clone is **baked at `/aitk`** (pinned SHA).
- A bare `nvidia/cuda` base has **no sshd**; `start.sh` adds RunPod's `$PUBLIC_KEY` SSH setup.

## To use this fallback instead of the stock-base bootstrap
Set `AITK_REMOTE_IMAGE=monygroup/aitk-klein:<tag>` (overrides `DEFAULT_AITK_IMAGE`). The bootstrap's
clone+pip step is harmless on a baked image (re-clone into /aitk is fast; deps already satisfied) —
or trim it later if the baked path becomes primary.

## What is / isn't baked
- **Baked:** torch + ai-toolkit deps + the `/aitk` clone (pinned `AITK_REF`) + boto3 + sshd/start.sh.
- **Not baked — pulled at boot:** the base weights (klein-4b + Qwen3-4B TE + flux2_vae, ~25 GB,
  ungated) — ai-toolkit `from_pretrained`-pulls them on first run (~8–12 min cold).
- **Image size ≈ 30 GB** (CUDA *devel* base + torch/cu128 + the full ai-toolkit dep tree). With
  pull-at-boot weights, a cold pod fetches ~30 GB image + ~25 GB weights on its first run. A later
  slim could swap the `runtime` CUDA base (saves ~5 GB) if no dep needs `nvcc`, and/or a RunPod
  network-volume HF cache to avoid re-pulling weights per pod.
- **Not baked — shipped over SSH:** `aitktrainer.py` (SecurePodClient uploads it at bootstrap), so the
  image is stable across runner edits.

## Build → verify → publish → use
```bash
# 1. build (no GPU needed)
PUSH=0 scripts/pod/aitk-trainer/build-and-push.sh          # → monygroup/aitk-klein:<MMDD>a

# 2. smoke-test on the local 4090 (no pod spend; needs scripts/.koh-manifest.json + .env R2)
IMAGE=monygroup/aitk-klein:<tag> scripts/pod/aitk-trainer/smoke-test.sh

# 3. publish (Docker Hub, manual — matches the tee-runner precedent)
scripts/pod/aitk-trainer/build-and-push.sh                 # build + docker push

# 4. point the cursor at it
#    deploy env: AITK_REMOTE_IMAGE=monygroup/aitk-klein:<tag>
#    (+ public WEBHOOK_URL, RUNPOD_API_KEY/RUNPOD_SSH_KEY_PATH, R2_* — same as the gen path)
```

## Files
- `Dockerfile` — the image (base + torch + baked clone + deps + sshd).
- `start.sh` — RunPod entrypoint: authorize `$PUBLIC_KEY`, start sshd, idle for SSH-driven jobs.
- `build-and-push.sh` — `docker build` + `docker push monygroup/aitk-klein:<dated-tag>` (`PUSH=0` to build only).
- `smoke-test.sh` — run `aitktrainer.py` inside the image on the local GPU (real pod path, no pod).

## Bumping the ai-toolkit version
`docker build --build-arg AITK_REF=<sha> …`. Re-run the smoke test before pushing — a new SHA can
shift deps/paths. Keep the default `AITK_REF` equal to the SHA we last live-verified.
