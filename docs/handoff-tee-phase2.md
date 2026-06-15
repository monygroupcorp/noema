# TEE Private Compute — Phase 2 Handoff
**Date:** 2026-06-13
**Branch:** chainengine-migration
**Author:** session handoff — pick up here with fresh context

---

## What This Is

Noema Crystal is building a private compute product: a user provisions a rented
GPU pod, a WireGuard tunnel is established between their browser and the pod, and
all inference runs inside that tunnel — the platform never sees prompts, outputs,
or model identity. Payment is either anonymous (Bursa ZK credit) or account-based;
the session privacy guarantee is the same either way.

The canonical architecture is at `docs/north-star.md`. The full TEE runner spec
is at `docs/tee-runner.md`. Read both before touching anything.

---

## What Phase 1 Proved (done, 2026-06-13)

Phase 1 validated the core loop using native tools on the local 4090 box:

- WireGuard tunnel established between two local peers (`wg-tee-server` 10.13.0.1,
  `wg-tee-client` 10.13.0.2)
- wstunnel bridging WebSocket→UDP in the middle (matching production topology)
- TEE runner stub (`tee/runner/runner.py`) bound to 10.13.0.1:7998, signaling
  ready/heartbeat to a platform stub
- llama-server (native CUDA binary) loaded Huihui-Qwen3.6-27B-abliterated Q4_K
  from `/mnt/data/models/gguf/`, running on the 4090, streaming via SSE
- curl hitting `http://10.13.0.1:8000/v1/chat/completions` through the tunnel
  and receiving streamed tokens back

**Streaming inference through a WireGuard tunnel is proven.** The architecture is sound.

---

## What Phase 2 Must Prove

Replace curl + native WireGuard with a browser tab. The user should be able to:

1. Open a page in the browser
2. Click "Generate Keys" — WireGuard Curve25519 keypair generated client-side,
   private key never leaves the browser
3. Click "Connect" — WASM WireGuard connects to the wstunnel WebSocket bridge
   on the 4090 box, tunnel establishes
4. Click "Run" — browser sends a chat completion request through the tunnel,
   streamed tokens appear in the page

## Phase 2 Result — DONE (2026-06-13)

**Pass. All criteria met.**

- Keypair generated in-browser (MacBook), private key never left the client
- WASM WireGuard tunnel established: MacBook browser → Tailscale → gost SOCKS5+WS
  → wg-tee-server (Linux/4090) — no native WireGuard client on the user side
- Inference streamed end-to-end: POST /v1/chat/completions through the tunnel,
  SSE tokens from Huihui-Qwen3.6-27B-abliterated Q4_K appeared in the browser
- Zero platform traffic during inference — only the WebSocket to gost visible

**Key findings vs handoff assumptions:**

- Transport: gost SOCKS5+WS replaces wstunnel (wstunnel speaks raw UDP-over-WS,
  incompatible with socksgo; gost is the correct server-side component)
- Keypair generation: done in Go WASM (curve25519 in wgo), not @noble/curves
- No Vite needed: tee/browser/ is plain HTML + Go WASM, served by python3 -m http.server
- Browser must use the server's reachable IP (Tailscale/public), not 127.0.0.1 —
  the WebSocket originates from the client machine's network stack

**Artifacts produced:**

- tee/browser/main.go    — Go WASM: wgGenerateKeys, wgConnect, wgDisconnect, wgStream
- tee/browser/go.mod     — same dep versions as wg-web-demo (asciimoth/* stack)
- tee/browser/index.html — three-button shim, pre-filled defaults
- tee/browser/build.sh   — GOOS=js GOARCH=wasm go build + wasm_exec.js copy
- tee/scripts/setup-phase2.sh — server side: wg-tee-server + gost

**Nothing platform-side should appear in the browser's network inspector except
the WebSocket connection to the pod.** No R2, no platform API calls during inference.

---

## WASM WireGuard — Library Landscape (researched 2026-06-13)

No turnkey npm package exists. Must be assembled. Key findings:

### The only working full-stack browser demo
**`asciimoth/wg-web-demo`** — https://github.com/asciimoth/wg-web-demo
- Last commit: May 20, 2026. Live demo at https://asciimoth.github.io/wg-web-demo/
- Architecture: wireguard-go compiled `GOOS=js GOARCH=wasm` + gVisor netstack
  (`vtun`) + SOCKS-over-WebSocket
- Undocumented but the source is the implementation reference
- This is the closest starting point

### Production precedent
**Tailscale** ships wireguard-go compiled to WASM in their browser SSH console.
Blog: https://tailscale.com/blog/ssh-console
- Confirms the architecture is production-viable
- Not extractable as a library (deeply entangled with Tailscale overlay)

### Crypto primitives (for keypair generation only)
`@noble/curves` v2.2.0 — `x25519.generateKeyPair()` — audited, ESM, zero deps.
This is the right pick for in-browser Curve25519 keypair generation.

### What does NOT work in browser
- `wireguard-js` (npm) — Node ≥22.18 only, uses `dgram`
- `@aria-cli/wireguard` — NAPI-rs, Node only
- `wireguard` (npm) — 912-byte stub
- Cloudflare boringtun — no WASM build, no WASM CI

### WebSocket relay (server side — already validated in Phase 1)
`wstunnel` v10.5.5 — `~/.local/bin/wstunnel` on the 4090 box.
Listens on ws://127.0.0.1:8080, forwards to udp://127.0.0.1:51820.

---

## Recommended Build Approach

**Go WASM route** using `wg-web-demo` as the implementation reference.

The browser-side stack:
```
browser tab
  └── WASM module (wireguard-go + gVisor netstack, compiled GOOS=js GOARCH=wasm)
       └── sends WireGuard UDP frames over WebSocket
            └── ws://[pod-ip]:8080  (wstunnel WebSocket bridge)
                 └── wg-tee-server WireGuard peer (10.13.0.1)
                      └── llama-server (10.13.0.1:8000)
```

The WASM module replaces what `wg-tee-client` (the native WireGuard interface)
did in Phase 1. Everything else — wstunnel, the runner, llama-server — stays
identical.

### Build steps
1. Study `wg-web-demo` source to understand the Go WASM → WebSocket TUN adapter
2. Build wireguard-go with `GOOS=js GOARCH=wasm`, replacing its UDP socket calls
   with a WebSocket transport
3. Wire in gVisor netstack so HTTP requests inside the WASM module route through
   the WireGuard tunnel
4. Compile to `wireguard.wasm`, load it in a Vite page via a Web Worker
5. Keypair generation: use `@noble/curves` x25519 in JS, pass pubkey to Go WASM
   for the handshake

### The shim frontend (minimal — no design, three interactions)
```
[ Generate Keys ]  — calls @noble/curves x25519.generateKeyPair()
                     shows pubkey, holds privkey in memory only
[ Connect ]        — takes server endpoint + server pubkey as input
                     initializes WASM WireGuard, opens WebSocket to wstunnel
[ Run ]            — sends POST /v1/chat/completions through the tunnel
                     streams tokens into the page via SSE
```

Single Vite page. No auth, no session management, no design. Three buttons, prove
the tunnel, move on.

---

## Local Environment

**Machine:** archbox, RTX 4090 (24079 MiB), Arch Linux, kernel 6.18.9

**Key paths:**
```
/home/rth/projects/main/noema-crystal/tee/   — all Phase 1/2 work lives here
  runner/runner.py                            — TEE runner (FastAPI, bound to 10.13.0.1:7998)
  runner/recipes.py                           — llama.cpp recipe (uses native binary)
  runner/.venv/                               — Python venv
  platform-stub/stub.py                       — platform lifecycle stub (port 7999)
  platform-stub/.venv/
  scripts/setup-local.sh                      — brings up WG interfaces + wstunnel
  scripts/teardown-local.sh
  scripts/test-inference.sh
  scripts/setup-python.sh                     — creates venvs

/home/rth/projects/ai/llama.cpp/build/bin/llama-server   — native CUDA binary
/mnt/data/models/gguf/                                    — local GGUF models
  Huihui-Qwen3.6-27B-abliterated-ggml-model-Q4_K.gguf   — validated working
  Qwen_Qwen3.5-9B-Q4_K_M.gguf
  huihui-ai_Qwen3-14B-abliterated-Q6_K.gguf
~/.local/bin/wstunnel                                     — v10.5.5
```

**Network layout (Phase 1, still valid for Phase 2 server side):**
```
wg-tee-server   10.13.0.1/24   WireGuard server peer (pod side)
wg-tee-client   10.13.0.2/24   WireGuard client peer (in Phase 2, replaced by WASM)
wstunnel server ws://127.0.0.1:8080 → udp://127.0.0.1:51820
wstunnel client udp://127.0.0.1:51821 → ws://127.0.0.1:8080
runner API      http://10.13.0.1:7998
llama-server    http://10.13.0.1:8000
platform stub   http://127.0.0.1:7999
```

**To restart Phase 1 environment:**
```bash
bash tee/scripts/setup-local.sh          # terminal 1 (needs sudo for WG interfaces)
tee/platform-stub/.venv/bin/python tee/platform-stub/stub.py   # terminal 2
RUNNER_BIND=10.13.0.1:7998 ATTESTATION_STUB=true \
  tee/runner/.venv/bin/python tee/runner/runner.py              # terminal 3

# load model — Essentia+Fundamentum pushed inline, no recipe needed
curl -X POST http://10.13.0.1:7998/setup \
  -H 'Content-Type: application/json' \
  -d '{
    "essentiaId": "huihui-qwen3-27b",
    "essentia": {
      "fundamentum": {
        "runtime": "llama.cpp",
        "launchTemplate": "llama-server --model {model} -ngl -1 --port {port} --host 0.0.0.0",
        "readyProbe": "GET http://localhost:{port}/health",
        "intellae": [{ "id": "/mnt/data/models/gguf/Huihui-Qwen3.6-27B-abliterated-ggml-model-Q4_K.gguf", "role": "lm" }]
      }
    }
  }'
```

---

## What Phase 2 Produces

On completion of Phase 2:
- `tee/browser/` — Vite shim with WASM WireGuard, three-button UI
- `tee/browser/wireguard.wasm` — the compiled Go WASM module
- `tee/browser/wg-worker.js` — Web Worker that hosts the WASM and handles tunnel I/O

Pass criteria: browser tab streams an inference result from the 27B model through
the WASM tunnel with no platform traffic in the network inspector except the
WebSocket to port 8080.

---

## What Comes After Phase 2

Phase 3: real TEE hardware on a RunPod TEE-capable pod. Only then does hardware
attestation (`Fundamentum.contentHash`) get wired up. Everything before that is
local validation.

After all three phases are validated, the production build adds:
- TEE session provisioning endpoint on the REST allocutio (`POST /v1/sessions/tee`)
- Time-based Signorum billing (GPU-hours, not per-run)
- Base image published to a container registry
- WireGuard client config delivery to the user's browser on session open

---

## Key Documents
- `docs/north-star.md` — canonical architecture, the north star test
- `docs/tee-runner.md` — full TEE runner spec, validation plan, open questions
- `docs/crystal-master-plan.md` — crystal ring phases (Phases 0–9 done)
- `docs/arcanum-bursa-frontend.md` — Bursa frontend (anonymous payment, LIVE)

---

## Phase 2.5 — Handoff (pick up here)

**Date:** 2026-06-14
**Status:** Phase 2 complete. Phase 2.5 not started.

---

### The Core Design Issue to Resolve First

`tee/runner/recipes.py` reimplements knowledge that already exists in the
Essentia type system. It must be replaced before anything else in the runner
is extended.

**Current state (wrong):**
```python
# runner.py
class SetupRequest(BaseModel):
    server: str      # "vllm" | "llama.cpp" | "comfyui"
    model: str       # hardcoded HF ID or path
    options: dict = {}

RECIPES = {
    "vllm":    VllmRecipe(),
    "llama.cpp": LlamaCppRecipe(),
    "comfyui": ComfyUIRecipe(),
}
```

Each Recipe class hardcodes model-specific knowledge: command templates, env
vars, HF paths, git URLs. This will not scale. Every new model would require
a new Recipe subclass in `recipes.py` — the runner becomes a bottleneck.

**Target state (correct):**
```python
# runner.py
class SetupRequest(BaseModel):
    essentiaId: str
    essentia: dict   # full EssentiaDefinition pushed inline by browser
    options: dict = {}

EXECUTORS = {
    "vLLM":             VLLMExecutor(),
    "llama.cpp":        LlamaCppExecutor(),
    "python-modelcard": PythonModelExecutor(),
    "ComfyUI":          ComfyUIExecutor(),
}

# POST /setup handler:
runtime = req.essentia["fundamentum"]["runtime"]
executor = EXECUTORS[runtime]
executor.setup(req.essentiaId, req.essentia, req.options)
```

The runner reads `fundamentum.runtime` to select the executor. All model-
specific knowledge (weights ID, install script, arg map, workflow template)
lives in the Essentia definition the browser pushes through the tunnel.
The Essentia definition is what the user selected in the UI — the browser
already holds it. The platform never sees it. Privacy holds.

**Why not fetch Essentia from the platform inside the runner?**
The runner must not call back to the platform to resolve an `essentiaId`.
That call would tell the platform which model is being installed — breaking
the privacy guarantee. Browser pushes the definition inline. Runner is
stateless with respect to the platform catalog.

---

### Phase 2.5 Work Order

These are the four things to complete before moving to RunPod. They are
engineering completion — no new unknowns. The architecture is proven.

**1. Rewrite `tee/runner/recipes.py` → four executor classes**

Replace `recipes.py` entirely. Each executor class gets one `setup()` method:

```python
class VLLMExecutor:
    def setup(self, essentia_id, essentia, options):
        model_id = essentia["fundamentum"]["intellae"][0]["id"]
        gen_params = essentia.get("inferentia", {}).get("genParams", {})
        # launch: python -m vllm.entrypoints.openai.api_server --model model_id ...

class LlamaCppExecutor:
    def setup(self, essentia_id, essentia, options):
        model_id = essentia["fundamentum"]["intellae"][0]["id"]
        # resolve to local path or pull GGUF from HF
        # launch: LLAMA_SERVER_BIN --model resolved_path -ngl -1 ...

class PythonModelExecutor:
    def setup(self, essentia_id, essentia, options):
        script = essentia["script"]
        # git clone script["repo"], run script["install"], launch script["entry"]

class ComfyUIExecutor:
    def setup(self, essentia_id, essentia, options):
        template = essentia["workflowTemplate"]
        # clone ComfyUI, start server, post template as prompt
```

**2. Update `tee/runner/runner.py` SetupRequest + dispatch**

- `SetupRequest`: `essentiaId: str`, `essentia: dict`, `options: dict = {}`
- `/setup` handler: dispatch on `essentia["fundamentum"]["runtime"]`
- `/stop` handler: `{ essentiaId: str }` not `{ server: str }`
- `/status` response: `essentiae` list not `servers` list

**3. Add `POST /peer/register` to runner**

Currently, WireGuard peer configuration is done manually (`wg set wg-tee-server peer ...`).
The runner needs to do this programmatically when the browser registers.

```python
@app.post("/peer/register")
async def register_peer(req: PeerRegisterRequest):
    # subprocess: wg set wg-tee-server peer {req.wgPublicKey} allowed-ips 10.13.0.{n}/32
    # return: { serverPublicKey, endpoint, tunnelIp }
```

Allocate tunnel IPs from a pool (start at 10.13.0.2, increment per registration).

**4. Write Dockerfile + entrypoint.sh**

The base image replaces `scripts/setup-phase2.sh`. It should:
- Start WireGuard server (wg-tee-server) at boot
- Start gost SOCKS5+WS bridge on a configurable public port
- Read server keypair from env or generate at boot (private key logged once to stdout for provisioning, then lives in kernel only)
- Start the TEE runner (FastAPI) bound to `10.13.0.1:7998`
- Boot parameters via env: `SESSION_ID`, `PLATFORM_CALLBACK_URL`, `GOST_PORT`

---

### Current Local Environment State (2026-06-14)

Phase 2 environment may still be running. To verify:

```bash
# check what's alive
ps aux | grep -E "gost|wg|runner|stub|llama"
ip link show wg-tee-server 2>/dev/null && echo "WG up" || echo "WG down"
```

To tear down cleanly:
```bash
bash tee/scripts/teardown-local.sh
```

**Phase 2 server-side setup (Phase 2.5 work uses the same):**
```bash
# terminal 1 — platform stub
tee/platform-stub/.venv/bin/python tee/platform-stub/stub.py

# terminal 2 — runner (current, uses old recipes.py — to be replaced)
RUNNER_BIND=10.13.0.1:7998 ATTESTATION_STUB=true \
  tee/runner/.venv/bin/python tee/runner/runner.py

# manual peer setup (to be replaced by POST /peer/register in Phase 2.5)
# sudo wg set wg-tee-server peer <BROWSER_PUBKEY> allowed-ips 10.13.0.2/32
```

**gost command (replace 8080 with public port on RunPod):**
```bash
gost -L "socks5+ws://:8080?udp=true&udpBufferSize=4096&bind=true"
```

---

### What Phase 3 Needs From Phase 2.5

Phase 3 (RunPod TEE hardware) only starts once Phase 2.5 delivers:
- A Docker image that boots into a working TEE environment (gost + wg-tee-server + runner)
- `/setup` accepting Essentia definitions (not `{server, model}`)
- `/peer/register` for dynamic WireGuard peer addition
- The four executor classes functional for at least vLLM and LlamaCppExecutor

Phase 3 adds only attestation (hardware TDX/SEV) and the provisioning endpoint
(`POST /v1/sessions/tee` in REST allocutio). Nothing else changes.
