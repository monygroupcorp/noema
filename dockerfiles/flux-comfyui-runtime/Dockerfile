# Layer order is intentional — see README.md for the caching rationale.
# The model layer is LAST so framework upgrades don't invalidate ~33GB of weights.

ARG PYTORCH_TAG=2.4.1-cuda12.1-cudnn9-runtime
FROM pytorch/pytorch:${PYTORCH_TAG}

# Layer 1 — system deps (very stable, ~50MB)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Layer 2 — ComfyUI source pinned to a specific commit (stable when pinned)
ARG COMFYUI_REF=v0.3.10
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI && \
    cd /workspace/ComfyUI && \
    git checkout ${COMFYUI_REF}

# Layer 3 — ComfyUI Python deps (stable when ComfyUI ref is pinned)
RUN pip install --no-cache-dir -r /workspace/ComfyUI/requirements.txt

# Pre-create model directories so LoRAs and one-off models can be dropped in at job time
RUN mkdir -p /workspace/ComfyUI/models/unet \
             /workspace/ComfyUI/models/vae \
             /workspace/ComfyUI/models/clip \
             /workspace/ComfyUI/models/loras \
             /workspace/ComfyUI/models/checkpoints

# Layer 4 — model weights (~33GB, intentionally last)
ARG R2_BASE=https://models.miladystation2.net
RUN wget -q "${R2_BASE}/unet/flux1-schnell.safetensors"  -O /workspace/ComfyUI/models/unet/flux1-schnell.safetensors  && \
    wget -q "${R2_BASE}/vae/ae.safetensors"              -O /workspace/ComfyUI/models/vae/ae.safetensors              && \
    wget -q "${R2_BASE}/clip/t5xxl_fp16.safetensors"     -O /workspace/ComfyUI/models/clip/t5xxl_fp16.safetensors     && \
    wget -q "${R2_BASE}/clip/clip_l.safetensors"         -O /workspace/ComfyUI/models/clip/clip_l.safetensors

EXPOSE 8188

# Keep the container alive for SSH-driven workflows.
# VastAI overlays its own init/sshd over the container — we don't manage SSH here.
# The benchmark / job runner SSHs in and starts ComfyUI explicitly.
CMD ["sleep", "infinity"]
