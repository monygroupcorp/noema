# aitk-trainer — publishable ai-toolkit training image

The pod-pullable image behind the **remote** training modus (Slice E). A RunPod SECURE pod
pulls it, `SecurePodClient` SSHes in and launches `scripts/pod/aitktrainer.py`, which trains
a LoRA on a dataset manifest and reports back through the same finality the local path proves.

## Why a custom image (vs the stock `runpod/pytorch`)
- ai-toolkit's pins (transformers 5.5.3, diffusers-from-git, torchao 0.10.0) need **torch ≥2.9**;
  the stock `runpod/pytorch:2.4` base fails to import diffusers. So we base on
  `nvidia/cuda:12.8.1-devel-ubuntu24.04` + `torch 2.9.1/cu128` (the proven `stationthis-klein` recipe).
- A pod has **no host mount**, so the ai-toolkit clone is **baked at `/aitk`** (pinned SHA).
- A bare `nvidia/cuda` base has **no sshd**; `start.sh` adds RunPod's `$PUBLIC_KEY` SSH setup.

## What is / isn't baked
- **Baked:** torch + ai-toolkit deps + the `/aitk` clone (pinned `AITK_REF`) + boto3 + sshd/start.sh.
- **Not baked — pulled at boot:** the base weights (klein-4b + Qwen3-4B TE + flux2_vae, ~25 GB,
  ungated) — ai-toolkit `from_pretrained`-pulls them on first run (~8–12 min cold). Keeps the image ~10 GB.
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
