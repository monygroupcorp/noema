# TEE Runner — two-stage build.
# Build context: tee/ directory (docker build -f runner/Dockerfile tee/)
#
# Stage 1: compile tee-wg-server (userspace WG + SOCKS5+WS)
# Stage 2: runtime image with CUDA and Python runner
#
# Intentionally lean — no runtime-specific binaries (llama-server, vLLM, etc.).
# Those are installed at /setup time via the fundamentum's install[] steps,
# keeping the image a blank compute substrate the user fully controls.

# ── Stage 1: Go builder ──────────────────────────────────────────────────────
FROM golang:1.25-bookworm AS wg-builder

WORKDIR /build
COPY wg-server/go.mod wg-server/go.sum ./
RUN go mod download

COPY wg-server/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tee-wg-server .

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# wireguard-tools: only for wg genkey / wg pubkey (no kernel module needed).
RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard-tools \
    iproute2 \
    curl \
    wget \
    git \
    python3.11 \
    python3.11-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# tee-wg-server — WireGuard + SOCKS5+WS server (gVisor netstack, no TUN / NET_ADMIN)
COPY --from=wg-builder /tee-wg-server /usr/local/bin/tee-wg-server

# Runner
WORKDIR /opt/runner
COPY runner/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt
COPY runner/runner.py ./

# Entrypoint
COPY runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
