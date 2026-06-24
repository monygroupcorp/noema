# =============================================================================
# aitk-trainer — publishable ai-toolkit LoRA training image (Slice E, remote arm)
# =============================================================================
#
# A pod-pullable twin of the local `stationthis-klein:1`. Two things make it work on a
# RunPod SECURE pod that the local image can't:
#   - openssh-server + start.sh (RunPod's $PUBLIC_KEY convention) — SecurePodClient drives
#     the pod over SSH; the bare nvidia/cuda base has no sshd.
#   - the ai-toolkit clone is BAKED at /aitk (the local image mounts it from the host; a
#     pod has no host mount).
#
# Reuses the PROVEN stationthis-klein dep recipe: torch 2.9.1/cu128 on CUDA 12.8 (ai-toolkit's
# pins need torch >=2.9 — the stock runpod/pytorch:2.4 base fails diffusers import). Base
# weights (klein-4b + Qwen3-4B TE + flux2_vae, ~25GB, ungated) are PULLED AT BOOT by
# ai-toolkit's from_pretrained — NOT baked. Image is ~30GB (CUDA *devel* base + torch + the
# ai-toolkit dep tree); a later slim could swap the runtime base if no dep needs nvcc.
#
# The pod runner (scripts/pod/aitktrainer.py) is NOT baked — SecurePodClient ships it over
# SSH at bootstrap, so the image is stable across runner edits.
#
# Build/push: ./build-and-push.sh   (see README.md)
# =============================================================================
FROM nvidia/cuda:12.8.1-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TORCH_CUDA_ARCH_LIST="8.0 8.6 8.9 9.0 10.0 12.0"
# ai-toolkit downloads base weights at run time — keep the HF cache on the (large) pod volume.
ENV HF_HOME=/root/.cache/huggingface

RUN apt-get update && apt-get install --no-install-recommends -y \
        git curl build-essential cmake wget \
        python3.12 python3-pip python3-dev python3-setuptools python3-wheel python3-venv \
        ffmpeg python3-opencv \
        openssh-server \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3 /usr/bin/python

# torch FIRST (ai-toolkit's required version) — a stable layer above the churn of deps/clone.
RUN pip install --no-cache-dir --break-system-packages \
        torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 \
        --index-url https://download.pytorch.org/whl/cu128

# Bake the ai-toolkit clone at /aitk, pinned to the SHA we live-verified locally (image == that
# code). Overridable for a bump: --build-arg AITK_REF=<sha>.
ARG AITK_REF=af594061ab76402eb1261a0450538fba53b41411
RUN git clone https://github.com/ostris/ai-toolkit /aitk \
    && cd /aitk && git checkout "${AITK_REF}" && git submodule update --init --recursive

# ai-toolkit deps (requirements.txt -r's requirements_base.txt — install from /aitk so the
# relative include resolves), plus boto3 for aitktrainer.py's R2 upload.
RUN cd /aitk && pip install --no-cache-dir --break-system-packages -r requirements.txt \
    && pip install --no-cache-dir --break-system-packages boto3

# RunPod SSH bootstrap: start.sh authorizes $PUBLIC_KEY + starts sshd, then idles. SecurePodClient
# SSHes in and launches aitktrainer.py.
COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /aitk
CMD ["/start.sh"]
