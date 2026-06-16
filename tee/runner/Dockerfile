# TEE Runner base image
#
# One image for all private compute sessions. Runtimes are pre-installed so
# Fundamentum.install is empty in production — the image IS the install step.
#
# Required capabilities at runtime: --cap-add NET_ADMIN (WireGuard interface)
# Required env at runtime:
#   SESSION_ID           assigned by platform
#   PLATFORM_CALLBACK    platform lifecycle endpoint
#   WG_ENDPOINT          public IP:port of this pod (set by provisioner after boot)
#   GOST_PORT            WebSocket bridge port (default: 8080)
#   ATTESTATION_STUB     "true" for local dev (skips hardware attestation)

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# System packages — WireGuard + userspace fallback + network tools + Python 3.11
# wireguard-go provides userspace WireGuard (no kernel module / NET_ADMIN needed for iface creation).
RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard-tools \
    wireguard-go \
    iproute2 \
    iptables \
    curl \
    wget \
    git \
    python3.11 \
    python3.11-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# gost — SOCKS5+WS bridge
ARG GOST_VERSION=3.2.6
RUN curl -fsSL \
    "https://github.com/go-gost/gost/releases/download/v${GOST_VERSION}/gost_${GOST_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin gost \
    && chmod +x /usr/local/bin/gost

# Runtimes (vLLM, llama-server, ComfyUI) are NOT pre-installed.
# They are declared in Fundamentum.install and run at setup time.
# This keeps the image lean and provider-agnostic.

# Runner
WORKDIR /opt/runner
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt
COPY runner.py ./

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# gost WebSocket bridge port (WireGuard stays on 51820 internally)
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
