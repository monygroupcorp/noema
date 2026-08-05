# Spec — /private must own the user-facing tunnel (stop handing off to /tee)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started

## Finding
The freshly wired React screen `src/platforms/web/app/src/screens/Tee.tsx` (route `/private`,
commit `4448fda7`) does the session lifecycle right — in-browser x25519 keypair, `POST
/v1/sessions/tee`, Phasis-mapped progress, end-session — but for the actual tunnel it hands the
user to **`/tee/` and tells them to paste their private key there**. Owner ruling (2026-07-10):
`/tee` (the Go WASM client at `tee/browser/`, express-static in `src/index.ts` ~1181) **is a
testing tool, not a user-facing endpoint**. No user flow may terminate there.

## Goal
`/private` completes the whole private-session journey itself: provision → tunnel up → private
chat → end. The user never sees `/tee`, never copies a private key anywhere.

## Shape (the crystal-first cut)
1. **Embed the tunnel in the React app.** The Go WASM bundle (`tee/browser/app.wasm` +
   `wasm_exec.js`) already implements WireGuard-over-WebSocket (gost `proxyUrl`) + an HTTP
   client through the tunnel. Extract its JS surface into a lazy-loaded module the React app
   imports (mirror how snarkjs is lazy-loaded off the main bundle in `lib/ceremony.ts`).
   The keypair `Tee.tsx` already generates/stores (`noema-tee` in localStorage) feeds it
   directly — the paste step disappears.
2. **Private chat inside /private.** Once the tunnel is up, render the minimal chat loop against
   the pod's OpenAI-compatible endpoint through the tunnel (the E2E-proven Qwen path,
   [[project_tee_tunnel_status]]). This replaces the dead "Open private chat" promise the old
   mock screen made.
3. **`/tee` demoted.** Keep it deployed for debugging, but remove every user-facing link to it.
   Optionally gate it behind an env flag (`TEE_DEBUG_CLIENT=1`) so prod doesn't ship it at all.

## Constraints
- Session/keys stay client-side only; the platform still sees just the meter (spec's redaction
  contract is already honest in the UI — keep it).
- Lazy-load the WASM (it's large); the /private screen must stay fast when no session exists.
- Screen states already handled by `Tee.tsx` (provisioning phases, failed, ended) carry over —
  this spec adds the tunnel+chat stage after `status='ready'`, it does not rewrite the lifecycle.

## Acceptance
- A user on `/private` can: provision → watch phases → chat privately → end session, with zero
  navigation away and zero manual key handling.
- No link/button anywhere in the React app points at `/tee`.
- Hermetic-green; tunnel loop live-verified once on staging (RunPod SECURE tier).

## Leads
- `tee/browser/main.go` — what the WASM exposes today (keygen, session create, tunnel, HTTP).
- `src/platforms/web/app/src/screens/Tee.tsx` — lifecycle + `noema-tee` store to reuse.
- `TeeSessionView.proxyUrl` (`CrystalApi.ts` ~2596) — the gost SOCKS5+WS URL the WASM needs.
- Post-MVP roadmap context: [[project_tee_roadmap]] ("frontend redesign", "user compute endpoint").
