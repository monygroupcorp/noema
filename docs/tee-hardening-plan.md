# TEE Private Compute — Hardening Plan

**Written:** 2026-06-19, after first end-to-end inference confirmed (session 8)
**Branch:** chainengine-migration
**Status:** MVP proven. This doc is the roadmap from spike to product.

---

## Context

The TEE spike proved the full private compute stack in 8 sessions:

```
Browser WASM (WireGuard) → SOCKS5+WS → RunPod SECURE pod
  → tee-wg-server (userspace WG, gVisor vtun)
  → runner.py (FastAPI, tunnel-only, unreachable from public internet)
  → llama-cpp-python (installed at setup time via fundamentum)
  → Qwen2.5-0.5B (downloaded at setup time via intellae)
  → SSE tokens streamed back through tunnel to browser
```

Platform sees: session ID, pod ID, GPU cost, duration. Nothing else.
The model, the prompt, and the response are invisible to us and to RunPod.

The development loop was painful (every change = Docker rebuild + RunPod pod spin-up at $3.29/hr + 3-5 min wait). The result is an MVP that works but is **too brittle for real users**. This doc captures what needs to happen before we ship it.

---

## Why hardening comes before features

The nature of this product makes bad UX uniquely harmful:

- Users are paying GPU rates ($3-5/hr) while things break
- Errors are opaque by design — the platform can't see into the tunnel to diagnose
- A user left with a running pod they can't kill is burning money with no recourse
- A user who can't tell if their model is loading or has crashed will lose trust permanently

We have to build the trust layer first, then the feature surface.

---

## Hardening work

### 1. Async setup with progress streaming

**Current state:** `/setup` on runner.py is a single blocking HTTP call that takes 2-3 minutes (pip install + GGUF download + server start). The browser shows "installing model through tunnel…" with no updates. If anything fails, the error only surfaces at the end.

**What we need:**
- `/setup` returns immediately with `{ essentiaId, status: "installing" }`
- `/setup-status/{essentiaId}` returns SSE stream of progress events:
  ```json
  { "phase": "installing", "step": "pip install llama-cpp-python", "progress": null }
  { "phase": "downloading", "file": "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf", "progress": 0.43 }
  { "phase": "launching", "cmd": "python3 -m llama_cpp.server ..." }
  { "phase": "ready", "port": 8000 }
  ```
- `huggingface-cli download` emits progress to stderr — capture and parse it
- `_run()` in runner.py should stream stderr lines to a queue the status endpoint reads from
- Browser polls `/setup-status/{essentiaId}` via `wgStream` through the tunnel and renders a progress bar

**Priority:** High. The 2-3 min black box is the single worst UX moment in the flow.

---

### 2. Session persistence across platform restarts

**Current state:** `teeSessions` is an in-memory `Map` in `CrystalApi.ts`. If the platform (staging or production) restarts — deploy, crash, OOM — all session records are gone. Live pods keep billing. The user's browser polls and gets 404. The pod runs until it's manually killed or until it times out on its own heartbeat response.

**What we need:**
- Persist sessions to MongoDB (`tee_sessions` collection) on creation and on every status change
- Rehydrate on startup: load all sessions that were `provisioning` or `ready`, attempt to terminate their pods (they're orphaned — we can't reconnect to them), set them to `ended` with `error: "platform restarted"`
- Index on `sessionId`, `auctor.animaId`, `status`, `createdAt`
- TTL index: auto-expire sessions older than 24h

**Priority:** High. Without this, every deploy risks stranding users on live pods.

---

### 3. Error message normalization

**Current state:** Multiple paths set `session.status = 'ended'` with no `session.error`, causing the browser to show "session ended unexpectedly." The user has no idea if their balance ran out, the pod crashed, or there was a network issue.

**Errors that need distinct messages:**
- Budget exhausted → "session ended: balance depleted"
- Runner exited cleanly → "session ended by runner"
- Runner crashed → "runner exited unexpectedly — pod terminated"
- WS probe failed 3 times → "no GPU with working proxy found after 3 attempts"
- Platform restarted → "session ended: platform restarted"
- User ended → (no error, expected)

**Priority:** Medium. The fix is already partially in place (session 8). Needs completion and a browser-side display pass.

---

### 4. Billing guard at session start

**Current state:** A user with low balance can start a session (balance > 0 check passes), connect, and have it killed on the first heartbeat 60 seconds later if their balance can't cover the window. They paid for GPU time and got nothing.

**What we need:**
- At session creation, estimate minimum viable balance: `cost_per_hr * minimum_session_minutes / 60`
- Refuse provisioning if balance < minimum (e.g. 5 minutes of GPU time)
- Surface the estimate clearly: "this will cost approximately $X for a 10-minute session"
- `TEE_BILLING_DISABLED=true` remains in `.env.staging` for development

**Priority:** Medium. Protects users from the frustrating "60 seconds and kicked" failure mode.

---

### 5. Pod termination coverage

**Current state (post session 8):** `handleRunnerHeartbeat` and `handleRunnerEnded` now call `terminate()`. But there are still gaps:
- Platform restart: orphaned pods aren't terminated (see #2)
- WS probe retry: if all 3 attempts fail, `terminate()` is called but failure is silent
- `endTeeSession` (user-initiated): terminate is called but not awaited — if the platform crashes immediately after, the pod keeps running

**What we need:**
- Idempotent terminate: if the pod is already gone, swallow the 404
- Retry terminate on failure: 3 attempts with backoff before giving up
- Log all termination outcomes (success, failure, already-gone)

**Priority:** Medium.

---

## Feature extensions

### User compute endpoint

Users may want to use their TEE session as a transparent compute endpoint for local tooling (OpenCode, Hermes, Cursor, etc.) without going through the Noema frontend. The model endpoint would be:

```
POST https://noema.art/v1/completions
Authorization: Bearer <session-token>
```

The platform holds an open tunnel connection per session and proxies API requests through it to the runner. This is an inversion of the current model (browser holds the tunnel; platform is just a session broker). In this mode:
- Platform opens and holds the WireGuard client connection after session is ready
- External tool hits the platform's standard API
- Platform proxies through the tunnel to `http://10.13.0.1:7998/infer/{essentiaId}/...`
- Response streams back

This requires a persistent server-side WG client — a Go or Node process per live session holding the tunnel open. Non-trivial, but it's the path to TEE as infrastructure rather than TEE as a UI.

---

### Non-text modalities

The runner.py architecture generalizes to any compute. The fundamentum's `install[]` + `launchTemplate` + `readyProbe` pattern works for:

**Image generation (ComfyUI + FLUX):**
- `install`: install ComfyUI + dependencies
- `launchTemplate`: start ComfyUI API server
- Inference: POST workflow JSON through tunnel → runner.py proxies to ComfyUI
- Output: ComfyUI writes to `/tmp/output/` → expose via `/download/{essentiaId}/{filename}`

**User uploads into the machine:**
- New runner.py endpoint: `PUT /upload/{essentiaId}/{path}` — receives binary body, writes to `/tmp/workspace/{essentiaId}/{path}`
- Use: upload reference images for img2img, upload LoRA weights, upload audio for music generation

**Content downloads from the machine:**
- New runner.py endpoint: `GET /download/{essentiaId}/{path}` — streams file back through tunnel
- Content is never sent to the platform — goes directly browser→tunnel→pod→browser

**Video generation:**
- Same pattern as image, longer `readyProbe` timeout, larger output files

---

### Privacy attestation and adversarial testing

The privacy claim needs to be proven, not just asserted. What we should document and test:

**As the platform (us):**
- Can we read the prompt from the `/runner/ready` callback? No — runner.py sends only session ID + WG public key
- Can we read inference traffic from the heartbeat? No — heartbeat only sends `{ gpuHours, status }`
- Can we inspect pod memory/disk via RunPod API? No — SECURE pods have no SSH access from our side
- Can we MITM the WireGuard tunnel? No — WG is authenticated with the client's keypair generated in the browser WASM (never sent to us)

**As RunPod (the GPU provider):**
- Can they read pod memory? Yes — they own the hardware. This is the limit of the current MVP.
- Mitigation path: hardware TEE (Intel TDX, AMD SEV) encrypts memory at the hardware level. Phase 3.

**As a network observer:**
- Can they read the WebSocket traffic? No — WSS is TLS encrypted
- Can they distinguish TEE traffic from other HTTPS? Maybe — the SOCKS5 WS upgrade pattern is distinctive
- Can they read the WireGuard payload? No — WG is encrypted with the session keypair

**Adversarial testing program:**
- Run the above attacks ourselves and document results
- Consider a public bug bounty: "intercept a prompt from an active TEE session"
- The rules: attacker gets our platform credentials, gets their own RunPod account, tries to read what a browser sends through the tunnel
- What they'd need to win: demonstrate plaintext prompt capture from any point in the stack
- Marketing value: independently verified privacy is the differentiator vs every other AI API

---

### TEE frontend redesign

The spike frontend (`tee/browser/index.html`) was built for iteration speed, not users. Before integrating TEE into the main frontend (React + ReactFlow), design it independently:

**What the spike UI gets wrong:**
- No progress feedback during setup (2-3 min black box)
- Raw JSON essentia editing is not a user surface
- No model picker — users shouldn't type HuggingFace model IDs
- No session history — if the page refreshes, all context is gone
- No way to manage multiple models in a session
- No download mechanism for generated content

**What a real TEE UX looks like:**
- Session status card: connecting → installing [progress bar] → downloading [X%] → ready
- Model picker: browse catalog, or paste HuggingFace ID
- Chat interface that routes through the tunnel transparently
- File manager: upload inputs, download outputs
- Session timer + cost estimate displayed in real time
- "Copy endpoint" button: copies the tunnel endpoint URL for use in external tools

**Integration path:**
1. Design the standalone TEE UI (can be a separate React app or page)
2. Prove the UX works end-to-end in isolation
3. Integrate as a surface in the main frontend (the canvas layer, or a dedicated `/private` page)

---

## Development loop improvements

The spike loop was: code change → Docker rebuild → push → RunPod pod → wait → test → terminate → repeat. Every iteration costs $0.05-0.15 and 3-5 minutes. For 8 sessions this added up to real money and real friction.

**For the hardening phase:**

1. **Keep a warm dev pod** during active development sessions. Don't terminate between tests — just re-run `/setup` with a new essentia. The pod boot is the slow part; the tunnel reconnects fast.

2. **Local-first for non-pod work.** `go run ./tee/wg-server` locally handles all tunnel/SOCKS5/WG work without RunPod. Only spin a real pod when testing pod-specific behavior (CUDA, HuggingFace download, llama-cpp-python GPU inference).

3. **Autonomous test script before browser test.** Run `tee/scripts/test-runpod.mjs` to confirm the server-side is healthy before opening the browser. Don't spend 5 minutes on a browser session only to discover the WG server is broken.

4. **Version Docker images with commit SHA**, not `:latest`. RunPod caches `:latest`. Already doing this (`0619a`), keep it up.

5. **Separate platform deploys from image deploys.** Platform code (CrystalApi.ts, billing, session lifecycle) can be deployed to staging without rebuilding the runner image. Keep them on separate commit tracks.

---

## Current state summary

| Component | Status |
|-----------|--------|
| WireGuard tunnel (browser WASM ↔ pod) | ✓ proven |
| SOCKS5+WS GostUDPTun relay | ✓ proven |
| runner.py session lifecycle | ✓ proven |
| llama-cpp-python text inference | ✓ proven |
| HuggingFace model download | ✓ proven |
| /infer proxy (vtun→kernel stack) | ✓ proven |
| SSE token streaming through tunnel | ✓ proven |
| Session billing | ✓ working (disabled on staging for dev) |
| Pod auto-terminate on session end | ✓ fixed session 8 |
| Async setup progress | ✗ not built |
| Session DB persistence | ✗ not built |
| User compute endpoint | ✗ not built |
| Image generation | ✗ not proven |
| File upload/download | ✗ not built |
| Privacy attestation document | ✗ not written |
| Hardware TEE (memory encryption) | ✗ Phase 3 (different hardware) |
| Production-ready frontend | ✗ not built |

Runner image: `monygroup/tee-runner:0619a`
Spike frontend: `tee/browser/index.html` (dev only)
Debug journal: `docs/spikes/tee-wg-debug.md`
