# TEE Runner — Private Compute Specification

**Date:** 2026-06-13
**Status:** Canonical. All TEE private compute work executes inside this frame.

---

## What This Is

The TEE runner is the component that runs inside a provisioned GPU pod and makes
private compute possible. It replaces `runner.py` for the private compute case.

It is not an extension of runner.py. It is a separate artifact with a different
contract: runner.py serves our platform; the TEE runner serves the user. The
platform's only visibility into a TEE session is session lifecycle signals —
start, heartbeat (GPU-hours consumed), end. No content, no prompts, no outputs,
no model identifiers.

---

## The Two Session Types

Private compute is available to both auth modes. The session privacy guarantee
is identical. Only the payment rail differs.

| Auth | Payment | We know |
|------|---------|---------|
| Bursa (`x-bursa-token`) | ZK spend proof, arcanumHash | Session opened, credits charged, session closed |
| Account (`animaId`) | Signorum lock/settle | Who opened it, credits charged, nothing about content |

Same TEE runner. Same base image. Same tunnel. The provisioning endpoint accepts
either auth form.

---

## Architecture

```
PROVISIONING PHASE (platform-visible)
  User → POST /v1/sessions/tee { auth, fundamentumId, gpuClass }
  Platform → RunPod: provision TEE-capable pod with base image
  TEE runner boots inside pod:
    - Generates WireGuard server keypair (private key never leaves pod)
    - Starts WireGuard server
    - Starts WebSocket→UDP bridge on public port
    - POST to platform: { sessionId, endpoint, wgPublicKey }  ← only content call out
  Platform → User: { wgClientConfig, sessionId }
  Billing clock starts

TUNNEL PHASE (platform-invisible)
  Browser WASM WireGuard loads client config
  Browser → WebSocket → pod public IP → WS bridge → WireGuard UDP → TEE
  Tunnel established. Platform is out of the picture.

SETUP PHASE (through tunnel, invisible to platform)
  Browser pushes Essentia definition through tunnel (platform never sees this):
    POST /setup  { essentiaId, essentia: <EssentiaDefinition> }
  Runner reads essentia.fundamentum.runtime → selects executor class:
    "vLLM"              → VLLMExecutor       (reads inferentia.*)
    "llama.cpp"         → LlamaCppExecutor   (reads intellae[0].id for weight path)
    "python-modelcard"  → PythonModelExecutor (reads script.*)
    "ComfyUI"           → ComfyUIExecutor    (reads workflowTemplate.*)
  Executor installs, configures, and starts inference server
  Runner responds: { status, essentiaId, port }

INFERENCE PHASE (through tunnel, invisible to platform)
  User's browser calls inference server directly through tunnel:
    http://10.0.0.1:<port>/v1/chat/completions   (vLLM OpenAI-compatible)
    http://10.0.0.1:<port>/completion            (llama.cpp)
    http://10.0.0.1:<port>/prompt                (ComfyUI)
  Results stream through tunnel to browser. Nothing touches platform or R2.

METERING LOOP (platform-visible, content-free)
  Every 60s: POST to platform { sessionId, gpuHours, status: "active" }
  Platform checks remaining credits, responds { continue: true | false }
  If continue: false → runner initiates graceful teardown

SESSION END (platform-visible, content-free)
  On credit exhaustion or user disconnect:
    POST to platform { sessionId, gpuHours, status: "terminated" | "ended" }
  Pod terminates. Tunnel drops. Nothing is persisted.
```

---

## Base Image

A single Docker image for all TEE private compute sessions. Modus-agnostic —
it does not pre-install any inference server. It provides the infrastructure
for the user to install whatever they need.

**Contents:**

```
wireguard-tools          WireGuard server
wstunnel (or custom)     WebSocket→UDP bridge
Python 3.11 + asyncio    TEE runner process
CUDA drivers             GPU access
pip / uv                 Package installation for inference servers
curl / wget              Model weight download
nvtop / nvidia-smi       GPU monitoring for metering
```

**Not included:**
- vLLM, llama.cpp, ComfyUI, or any inference server
- Any model weights
- Any platform credentials (runner receives sessionId + callback URL at boot via env)

---

## TEE Runner API (tunnel-local only)

The runner exposes an HTTP API on a tunnel-local address. This API is only
reachable through the WireGuard tunnel — not on any public interface.

### POST /peer/register
Register the browser's WireGuard public key as a peer. Called by the browser
immediately after key generation, before Connect.

```json
Request:  { "wgPublicKey": "<base64>" }
Response: { "serverPublicKey": "<base64>", "endpoint": "<ip:port>", "tunnelIp": "10.13.0.2" }
```

### GET /peer/info
Returns the server's WireGuard public key and gost endpoint. Used by the
browser to pre-fill connection config without registering a peer yet.

```json
Response: { "serverPublicKey": "<base64>", "endpoint": "<ip:port>" }
```

### POST /setup
Install and start an inference server for a given Essentia.

**The runner has no hardcoded model knowledge.** All model-specific
configuration comes from the Essentia definition the browser pushes inline.
The browser already holds this definition (it is what the user selected in
the UI). Pushing it through the tunnel means the platform never learns which
model the user installs — the privacy guarantee holds.

```json
Request:
{
  "essentiaId": "qwen3-vl-8b",
  "essentia": {              // full Essentia definition, pushed inline
    "fundamentum": {
      "runtime": "vLLM",    // selects executor class
      "intellae": [{ "id": "qwen3-vl-8b", "role": "lm" }]
    },
    "inferentia": {          // form half for LLM runtimes
      "systemPrompt": "...",
      "genParams": {}
    }
    // OR "script": { ... }  // form half for python-modelcard runtimes
  },
  "options": {}              // per-request overrides (ctx_size, dtype, etc.)
}

Response:
{
  "status": "installing" | "ready" | "error",
  "essentiaId": "qwen3-vl-8b",
  "port": 8000,
  "message": "..."
}
```

### POST /stop
Stop a running essentia by id.

```json
Request:  { "essentiaId": "qwen3-vl-8b" }
Response: { "status": "stopped", "essentiaId": "qwen3-vl-8b" }
```

### GET /status
Current state of all managed processes, GPU utilization, VRAM used.

```json
{
  "essentiae": [
    { "essentiaId": "qwen3-vl-8b", "status": "running", "port": 8000 }
  ],
  "gpu": { "utilization": 87, "vramUsedGiB": 14.2, "vramTotalGiB": 24 }
}
```

### GET /health
Liveness check. Returns 200 while runner is alive.

---

## How the Runner Executes (no recipes, no executors)

The runner has **no model-specific and no runtime-specific code**. All
specificity lives in the `Fundamentum` and `Essentia` definitions the browser
pushes through the tunnel. Adding a new model or runtime means creating new
data records — the runner never changes.

### The five generic steps

```
POST /setup { essentiaId, essentia }:

  1. WEIGHTS — resolve fundamentum.intellae + essentia.intellae
               FK → Intella registry → download URL → pull to disk
               (generic: same code for every model, every runtime)

  2. INSTALL  — if fundamentum.install is present, run each command in sequence
               (production Docker image: this list is empty — image has it all)
               (local dev / bare metal: this is what you'd type into a blank terminal)

  3. LAUNCH   — interpolate fundamentum.launchTemplate with {model}, {port}, {vramGb}
               spawn the process
               (generic: string interpolation + subprocess, nothing else)

  4. PROBE    — poll fundamentum.readyProbe until HTTP 200
               (generic: GET loop with backoff)

  5. FORM     — configure the form half from Essentia:
                 workflowTemplate? → POST to server  (ComfyUI graph)
                 script?           → execute as-is   (already self-describing)
                 inferentia?       → no-op            (server ready for API calls)
               (generic: no runtime name checked, just presence of the field)
```

### What a Fundamentum record looks like (vLLM example)

```json
{
  "id": "vllm-serving",
  "versio": "1.0.0",
  "imageId": "vllm/vllm-openai",
  "imageVersion": "v0.9.0",
  "runtime": "vLLM",
  "install": [],
  "launchTemplate": "python -m vllm.entrypoints.openai.api_server --model {model} --port {port}",
  "readyProbe": "GET http://localhost:{port}/v1/models",
  "vramGb": 24
}
```

### What a Fundamentum record looks like (llama.cpp example)

```json
{
  "id": "llama-cpp-serving",
  "versio": "1.0.0",
  "imageId": "ghcr.io/ggerganov/llama.cpp",
  "imageVersion": "server-cuda",
  "runtime": "llama.cpp",
  "install": [],
  "launchTemplate": "llama-server --model {model} -ngl -1 --port {port}",
  "readyProbe": "GET http://localhost:{port}/health",
  "vramGb": 24
}
```

For local dev without a Docker image, `install` carries what you would type
into a blank terminal:

```json
"install": ["pip install vllm==0.9.0", "pip install flash-attn --no-build-isolation"]
```

In production that list is empty — the image already ran those commands at
build time. Same runner code either way.

---

## Platform Signals (outbound from runner)

The runner makes exactly three kinds of calls to the platform, all content-free:

| Signal | When | Payload |
|--------|------|---------|
| `ready` | WireGuard server up, waiting for user | `{ sessionId, endpoint, wgPublicKey }` |
| `heartbeat` | Every 60s | `{ sessionId, gpuHours, status: "active" }` |
| `ended` | Session over | `{ sessionId, gpuHours, status: "terminated" \| "ended" }` |

The platform responds to `heartbeat` with `{ continue: bool }`. That is the
only inbound data the runner accepts from the platform after boot.

Boot parameters arrive via environment variables set at pod provision time:
`SESSION_ID`, `PLATFORM_CALLBACK_URL`. Nothing else from the platform.

---

## Platform Side (provisioning endpoint)

```
POST /v1/sessions/tee
  Auth: bursa token OR animaId session
  Body: { fundamentumId, gpuClass: "24gb" | "48gb" | "80gb" }

→ Provision RunPod TEE pod with base image
→ Inject env: SESSION_ID, PLATFORM_CALLBACK_URL
→ Wait for runner `ready` signal (timeout: 3 min)
→ Generate WireGuard client config (user's keypair generated client-side)
→ Return: { sessionId, wgClientConfig, tunnelIp }

Billing: Signorum.lock() at session open, Signorum.settle() at session end
  based on gpuHours * rate, not per-run
```

---

## What the Platform Never Sees

- Which model the user installs
- What prompts or inputs are sent to the inference server
- What outputs are produced
- Whether the user runs one thing or many things in the session
- Any content that passes through the WireGuard tunnel

The platform sees: a session opened, N GPU-hours were consumed, the session ended.

---

## Validation Plan

### WASM WireGuard — Library Landscape (researched 2026-06-13)

No turnkey npm package exists for a full WireGuard tunnel in the browser.
The technology is proven in production (Tailscale ships it in their browser SSH
console) but must be assembled. The ecosystem state:

| Need | Solution | Status |
|------|----------|--------|
| Curve25519 keypair in browser | `@noble/curves` x25519 | Trivial, audited, works today |
| Full WireGuard tunnel in browser | wireguard-go compiled to WASM + gVisor netstack | Feasible, manual build — reference: `wg-web-demo` (May 2026) |
| WebSocket→UDP relay (server side) | `wstunnel` (Rust, 6.8k stars) | Production-grade, works today |
| HTTP routed through tunnel | gVisor netstack baked into Go WASM | Ships with the Go WASM build |

Pure-JS alternatives (`wireguard-js`, `@aria-cli/wireguard`, etc.) are all
Node-only or stubs. The only viable browser path is the Go WASM route.

### Phase 1 — Tunnel + Streaming Proof ✅ DONE (2026-06-13)

**Goal:** Prove the core loop works before writing the runner or the browser client.

```
4090 box ran:
  - WireGuard server peer (wg-tee-server, 10.13.0.1/24)
  - wstunnel WebSocket→UDP bridge (ws://127.0.0.1:8080 → udp://127.0.0.1:51820)
  - TEE runner stub (tee/runner/runner.py, bound to 10.13.0.1:7998)
  - llama-server with Huihui-Qwen3.6-27B-abliterated Q4_K (native CUDA binary)

Test client (curl):
  - Sent POST to http://10.13.0.1:8000/v1/chat/completions through the tunnel
  - Received streamed SSE completion chunks back through the tunnel
  - Nothing hit R2 or any platform endpoint
```

**Result:** SSE tokens streamed back via 10.13.0.1 (tunnel IP). Runner signaled
ready and heartbeat to platform stub. 27B model loaded on 4090, ran at ~47 tok/s.

What this validated:
- WireGuard tunnel establishment and key exchange
- wstunnel as the WebSocket→UDP bridge
- llama-server running and streaming on the 4090 via native CUDA binary
- Runner lifecycle signals (ready, heartbeat) to platform stub
- Absolute path model loading — no download step when model is already on disk

What this does not validate (deferred to Phase 2):
- WASM WireGuard in the browser
- The browser shim UI

### Phase 2 — WASM WireGuard in Browser

**Goal:** Replace the native WireGuard client with a browser WASM implementation.

Build the Go WASM layer using `wg-web-demo` as the implementation reference:
- wireguard-go compiled with `GOOS=js GOARCH=wasm`
- gVisor netstack for userspace TCP/IP inside the WASM module
- WebSocket transport replacing UDP socket calls
- Keypair generation using `@noble/curves` or the Go WASM's own keygen

Shim frontend (Vite, no design, three interactions):
```
[ Generate Keys ]  →  shows pubkey, stores privkey in memory only
[ Connect ]        →  takes server endpoint + server pubkey, opens tunnel
[ Ping / Run ]     →  sends request through tunnel, shows streamed response
```

Pass criteria: browser tab streams an inference result through the WASM tunnel
with no platform traffic in the network inspector except the WebSocket to the pod.

Estimated effort: 2–4 weeks for the Go WASM glue.

### Phase 3 — Real TEE Hardware

**Goal:** Validate hardware attestation on an actual RunPod TEE pod.

What requires real TEE hardware:
- Intel TDX / AMD SEV attestation report generation
- Verifying the compute provider cannot inspect the enclave
- `Fundamentum.contentHash` attestation signing against the base image

In local dev, attestation is stubbed: `ATTESTATION_STUB=true` skips
the hardware check and returns a synthetic report. Everything else
ships and is validated before this step.

---

## TEE Attestation (stub → real)

`Fundamentum.contentHash` already exists for attestation signing. When a user
connects, they can optionally verify the attestation report from the pod:

1. Pod generates attestation report (hardware-signed by Intel TDX / AMD SEV)
2. Report includes hash of the base image running inside the enclave
3. User's client verifies report against known-good image hash
4. If verified: user knows the pod is running the unmodified TEE runner and
   that neither the platform nor RunPod can inspect the session

This is the cryptographic proof of the privacy guarantee. It is the only
part that requires real TEE hardware and is deferred to the first RunPod
TEE pod test. Everything else ships and is validated before this step.

---

## Open Questions

- **WireGuard key generation client-side**: private key must never leave the
  browser. WASM WireGuard handles this. Confirm the library supports in-browser
  keygen before provisioning endpoint is finalized.
- **WebSocket bridge**: evaluate `wstunnel` vs a small custom asyncio bridge
  in the runner itself. Custom gives us tighter control and one fewer dependency.
- **Model weight source**: HuggingFace direct pull is the default. User may
  want to supply their own URL. Runner should accept either.
- **Multi-GPU**: gpuClass param handles this at provision time. Runner recipes
  need `--tensor-parallel-size` for vLLM. Verify RunPod TEE pod availability
  for multi-GPU configs.
- **Session resumption**: if the browser disconnects mid-session, does the
  tunnel drop and the pod terminate? Or can the user reconnect? First version:
  disconnect = terminate. Resumption is a future concern.
