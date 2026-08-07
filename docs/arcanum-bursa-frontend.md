# Arcanum / Bursa — Frontend Design

**Status:** Backend live (2026-06-13). Frontend not yet built.  
**Purpose:** Reference document for when we get to the UI layer.

---

## Overview

The anonymous credit flow has five distinct stages, each of which needs a UI
moment. The key invariant that drives all UX decisions: **if the user loses
their note (nullifier + secret) before minting a purse, or loses their purse
token before spending it, the credits are unrecoverable.** Every stage must
make that clear without being so frightening it kills the flow.

The full user journey:

```
Generate note → Deposit ETH → Wait for indexing → Mint purse → Spend credits
```

---

## Stage 1 — Generate note

**What happens:** We generate a (nullifier, secret) pair in the browser using
snarkjs + Poseidon. We compute `commitment = Poseidon(nullifier, secret)` and
`nullifierHash = Poseidon(nullifier)`. These never leave the browser.

**UI:**
- Triggered by "Fund anonymously" (or "Top up with ETH" on the credits panel).
- We generate the note silently in-browser (fast — no network, no proof).
- Show the commitment hash in a small monospace box (user doesn't need to copy
  this — we use it internally to poll for the leaf).
- **Critical moment:** display the (nullifier, secret) pair as a recovery phrase
  with a "copy" button and a strong warning: *"Save these before you continue.
  If you close this page without saving, your deposit cannot be recovered."*
- Gate the "Continue" button behind a "I've saved my note" checkbox.
- Persist (nullifier, secret, commitment) to `localStorage` keyed by commitment
  immediately on generation — before the deposit tx — so a page refresh doesn't
  lose them.

**Backend:** Nothing yet.

---

## Stage 2 — Deposit on-chain

**What happens:** User sends ETH to the CreditVault address calling
`payETHAnonymous(commitment)`. The exact function and address are what matter;
the amount is up to the user (minimum: enough to cover at least one run).

**UI:**
- Show a "Send ETH" panel with:
  - The CreditVault address (with copy button + ENS if resolvable).
  - The commitment pre-filled as the calldata argument.
  - An amount field with a live credit estimate, computed client-side from ETH
    price (`ETH × $USD × 2703 credits/USD`) — there is no server price-feed
    endpoint; `GET /arcanum/purse/:token` looks up a minted purse's balance by
    its token, not a price quote.
- Two paths:
  - **Wallet connected (wagmi/viem):** show a "Send transaction" button. Encode
    the `payETHAnonymous(bytes32)` calldata and send. Show the tx hash on submit.
  - **No wallet:** show a QR code for the CreditVault address + a note that the
    user must call `payETHAnonymous` with the commitment as an argument from
    their own wallet (MetaMask, frame, etc.). Also show a raw calldata hex they
    can paste.
- After sending, transition automatically to Stage 3 (poll for leaf).

**Backend:** Nothing yet — tx is on-chain.

---

## Stage 3 — Wait for indexing

**What happens:** The Alchemy webhook detects the `AnonymousDeposit` event and
calls `arcanumTree.insert(commitment, valor)`. This is near-instant (sub-block)
but the user shouldn't be left on a blank screen.

**UI:**
- Show a "Waiting for confirmation" spinner / progress indicator.
- Poll `GET /arcanum/tree/leaf/:commitment` every 4 seconds.
- Show a live "Block confirmations: N" counter if we have the tx hash (via
  provider `waitForTransactionReceipt`).
- On leaf found → transition to Stage 4.
- **Edge case:** if the user returns to the app later (page close, mobile app
  backgrounded), check localStorage on load. If a (nullifier, secret, commitment)
  is found with no `purseToken`, resume polling from Stage 3. Label it clearly:
  *"You have a pending deposit — tap to continue."*
- Timeout after 10 minutes with a "still waiting" message; provide support link.
  Do not auto-clear the localStorage — the note is still valid indefinitely.

**Backend call:** `GET /arcanum/tree/leaf/:commitment`

---

## Stage 4 — Mint purse (proof generation)

**What happens:** With the leaf in the tree, we have everything needed to
generate a Groth16 proof: (nullifier, secret, leafIndex, merkleProof siblings).
We call snarkjs in-browser with the `.wasm` and `.zkey` artifacts, then `POST
/arcanum/purse` with the proof and get back a bearer token + credit balance.

**UI:**
- Show "Generating proof…" with a progress indicator. This takes 2–5 seconds
  in-browser depending on device; do not make it look stuck.
- The `.zkey` file is large. Strategy:
  - Cache it in `localStorage` or IndexedDB after first download (keyed by
    content hash so upgrades invalidate automatically).
  - Show a one-time "Downloading proof key (~X MB)…" progress bar on first use.
  - Subsequent mints are fast (cached).
- On proof success, call `POST /arcanum/purse`. On success:
  - Store `purseToken` in localStorage (alongside or replacing the note).
  - Optionally: let the user export / copy the token as a string.
  - Clear the raw (nullifier, secret) from localStorage — they've been spent.
- Show the minted balance: *"Your anonymous purse: 4,523 credits (~$1.67)"*.
- Transition to normal app use (Stage 5).

**Error cases:**
- Proof verification fails on server: *"Proof rejected — this commitment may
  have already been spent."* Check `nullifierHash` in the tree.
- Network error: retry is safe — the proof is deterministic; re-submitting the
  same proof is idempotent (nullifier already marked spent → 409, which is the
  same as "already minted").

**Backend call:** `POST /arcanum/purse`  
**Artifacts needed:** `ARCANUM_ZKEY_URL` env var pointing at R2 `.zkey` (not
yet set on staging).

---

## Stage 5 — Spend credits

**What happens:** Normal app usage, but auth is the bearer token instead of an
identity. Every `POST /v1/runs` sends `x-bursa-token`. The purse balance drains
per run.

**UI:**
- The credits panel shows purse balance: *"🔒 923 credits"* (or similar anon
  indicator — no username, no wallet address shown).
- Fetch balance from `GET /arcanum/purse/:token` on load and after each run.
- Show per-run cost estimates before dispatch (use `POST /v1/runs/quote`).
- When balance drops below ~1 run's worth: *"Running low — top up."* Link back
  to Stage 1 (user can deposit again; a new purse will be minted and can
  coexist with the old one — they're independent bearer tokens).
- On `credits: 0`: disable the run button with *"No credits — fund your purse
  to continue."*

**Key storage contract:**
```
localStorage['arcanum:pending:<commitment>'] = { nullifier, secret, commitment }
localStorage['arcanum:purse:<token>'] = { token, credits, createdAt }
localStorage['arcanum:active'] = token   // pointer to current active purse
```
Multiple purses can coexist; the active pointer tracks which one to use. Old
spent purses can be pruned after `credits === 0n`.

**Backend calls:** `GET /arcanum/purse/:token`, `POST /v1/runs`,
`GET /v1/runs/:id` (with `x-bursa-token` header)

---

## Cross-cutting concerns

### Key loss / recovery
- If `purseToken` is lost: no recovery. Credits are gone. This must be
  communicated clearly at Stage 4, but not so repeatedly that users tune it out.
- If note (nullifier + secret) is lost before Stage 4: no recovery. The deposit
  sits in the tree forever unspent.
- We deliberately do NOT offer a "link to account" recovery path — that would
  break anonymity. This is by design; document it honestly in the UI.

### Multi-device
- The bearer token is copy-pasteable. Show a "Use on another device" export
  that just displays the raw token string. Import: paste token into an "I have
  a purse token" field on the top-up screen.
- We don't sync across devices; local storage is local.

### The .zkey artifact
- Must be served from R2 with correct CORS headers.
- Consider chunked streaming + IndexedDB storage to avoid OOM on mobile.
- Once cached, proof generation is the only browser-side heavy lift (~100ms
  WASM compute + ~2–4s witness generation on a mid-range device).

### Privacy UX
- Never show the wallet address in the UI after Stage 2.
- The commitment and nullifier hash are fine to display (they're public-chain
  data) but the raw nullifier + secret must never appear in logs, analytics,
  or error reports.
- No telemetry events that include the purse token.

---

## What's already done (backend)

| Component | Status |
|-----------|--------|
| CreditVault `payETHAnonymous` | Live (mainnet + Base) |
| Alchemy webhook → ArcanumTree insert | Live (mainnet only; Base pending) |
| `GET /arcanum/tree/leaf/:commitment` | Live |
| `POST /arcanum/purse` (proof verify + mint) | Live |
| `GET /arcanum/purse/:token` (balance) | Live |
| `POST /v1/runs` with `x-bursa-token` | Live |
| `GET /v1/runs/:id` with `x-bursa-token` | Live |
| snarkjs artifacts (`.wasm`, `.zkey`) | `.wasm` local; `.zkey` not on R2 yet |

## What's needed before frontend can ship

1. Upload `.zkey` to R2, set `ARCANUM_ZKEY_URL` env var on staging + prod.
2. Base chain webhook (so Base ETH deposits work — broader user base).
3. A `POST /v1/runs/quote` that accepts `x-bursa-token` for anonymous cost
   preview (currently quote works; needs a test).
