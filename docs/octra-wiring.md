# Octra Funding Rail — Wiring Snippet

The OCT rail's new modules are **additive and gated**: they no-op unless
`OCTRA_RPC_URL` is set. `container.ts` and `index.ts` are not edited by the
scaffold (the stage-branch `container.ts` is large/elided) — apply these two
diffs by hand when ready to wire.

## Scaffolded files (already written)

| File | Role |
|---|---|
| `src/types/octra.ts` | Types: `OctraTx`, `OctraDeposit`, `OctraDepositorum`, `OctraCursor`, `OctraClient`; `BN254_FIELD_ORDER`, `OCT_DECIMALS` |
| `src/octra/commitment.ts` | Canonical wire encode + strict `parseCommitment` |
| `src/octra/octraPricing.ts` | `makeAdminPricer` — µOCT→valor, shared `usdToValor`, `OCT_FUNDING_RATE`, per-deposit circuit-breaker |
| `src/octra/OctraClient.ts` | `HttpOctraClient` — JSON-RPC seam, quorum reads, normalization (all `[UNCERTAIN]` wire bits here) |
| `src/crystal/MongoOctraDeposit.ts` | `octra_deposits` + `octra_cursors` store, atomic `claimTx` |
| `src/crystal/OctraWatcher.ts` | `startOctraWatcher` poll loop → **same `arcanumTree.insert`** |
| `src/api/octra/octraRouter.ts` | `POST /octra/intent` (only new client endpoint) |
| `scripts/octra-verify.ts` | Layer 0 live-node probe |
| `src/crystal/ensureIndexes.ts` | **edited** — `octra_deposits` + `octra_cursors` indexes added |

## Diff 1 — `src/container.ts`

```ts
// imports
import { HttpOctraClient } from './octra/OctraClient.js'
import { MongoOctraDeposit } from './crystal/MongoOctraDeposit.js'
import type { OctraClient, OctraDepositorum } from './types/octra.js'

// Ring interface — add:
  octraClient?: OctraClient
  octraDeposita?: OctraDepositorum

// inside createContainer(db), only if configured:
  const octraDeposita = new MongoOctraDeposit(db)
  const octraClient = process.env.OCTRA_RPC_URL
    ? new HttpOctraClient({
        rpcUrls: (process.env.OCTRA_RPC_URLS ?? process.env.OCTRA_RPC_URL).split(','),
        quorum: Number(process.env.OCTRA_QUORUM ?? 1),
      })
    : undefined

// add to the returned ring object:
  octraClient,
  octraDeposita,
```

## Diff 2 — `src/index.ts`

```ts
import { startOctraWatcher } from './crystal/OctraWatcher.js'
import { makeAdminPricer } from './octra/octraPricing.js'
import { createOctraRouter } from './api/octra/octraRouter.js'

// after the arcanum router is mounted, inside boot():
let stopOctra: (() => void) | undefined
if (process.env.OCTRA_RPC_URL && ring.octraClient && ring.octraDeposita) {
  const pricer = makeAdminPricer({
    octUsdRate: process.env.OCTRA_OCT_USD_RATE ? Number(process.env.OCTRA_OCT_USD_RATE) : undefined,
    setAtMs: process.env.OCTRA_OCT_USD_SET_AT ? Number(process.env.OCTRA_OCT_USD_SET_AT) : undefined,
    maxStalenessMs: Number(process.env.OCTRA_OCT_USD_MAX_STALENESS_MS ?? 3_600_000),
    maxValorPerDeposit: process.env.OCTRA_MAX_VALOR_PER_DEPOSIT
      ? BigInt(process.env.OCTRA_MAX_VALOR_PER_DEPOSIT)
      : undefined,
  })

  // TODO: real single-use address derivation from the platform seed
  //       ("oct" + base58(sha256(ed25519_pubkey))) — verify scheme on live node.
  const deriveDepositAddress = async (_commitmentWire: string): Promise<string> => {
    throw new Error('octra deriveDepositAddress not implemented — see Layer 0')
  }

  app.use('/octra', createOctraRouter(ring.octraDeposita, deriveDepositAddress))

  stopOctra = startOctraWatcher({
    arcanumTree: ring.arcanumTree,
    deposita: ring.octraDeposita,
    client: ring.octraClient,
    pricer,
    confirmEpochs: Number(process.env.OCTRA_CONFIRM_EPOCHS ?? 12),
  }, Number(process.env.OCTRA_POLL_INTERVAL_MS ?? 15_000))

  log.info('octra funding rail enabled')
}

// in graceful shutdown (if/when added): stopOctra?.()
```

## New env vars (add to `.env-example`)

```env
# Octra (OCT) funding rail — optional; rail is OFF unless OCTRA_RPC_URL is set
OCTRA_RPC_URL=https://octra.network
OCTRA_RPC_URLS=                       # comma-separated for node quorum (mainnet: >=2)
OCTRA_QUORUM=1                        # nodes that must agree (DEV=1; mainnet>=2)
OCTRA_CONFIRM_EPOCHS=12               # OUR conservative depth (finality UNCERTAIN)
OCTRA_POLL_INTERVAL_MS=15000
OCTRA_OCT_USD_RATE=                   # admin-set OCT/USD (no reliable oracle)
OCTRA_OCT_USD_SET_AT=                 # Unix ms when the rate was set
OCTRA_OCT_USD_MAX_STALENESS_MS=3600000
OCTRA_MAX_VALOR_PER_DEPOSIT=          # circuit-breaker ceiling (impetus points)
# sweeper (separate isolated process — NOT the watcher):
OCTRA_PLATFORM_SEED=                  # derives single-use addresses (hot)
OCTRA_TREASURY_ADDRESS=               # cold sweep destination
```

## Remaining real work before mainnet (in order)

1. **Run `scripts/octra-verify.ts`** against a live node → resolve `OctraClient`
   method names + result shapes, confirm `OCT_DECIMALS`, confirm a head-epoch RPC.
2. **Confirm finality/reorg with the Octra team** (validators private — cannot
   self-verify). If post-epoch reverts are possible, cap mintable valor per
   unconfirmed-finality window or do not ship.
3. **Port the Octra codec** (address derivation, canonical tx bytes, Ed25519
   sign/verify, local hash recompute) from `octra-labs/webcli`; implement
   `deriveDepositAddress` and the `normalizeTx` signature/hash verification.
4. **Build the isolated sweeper** (holds the only spend key; cold treasury).
5. **Testnet end-to-end**: idempotency, reorg/shallow rejection, dup/bad
   commitment → `remansum`, price-unavailable hold, two-replica race.

See `docs/octra-blind-issuance.md` for the full spec.

---

## Live probe findings — 2026-05-30 (checkpoint 1: connect & trust)

First run of `scripts/octra-verify.ts` + curl against `https://octra.network`:

- **Reachable and live** — `GET /` → 200 in ~277ms.
- **Both dialects exist — REST *and* a real `octra_*` JSON-RPC surface.**
  - REST is live: `GET /staging` → `{"count":0,"staged_transactions":[],...}`;
    `/balance/{addr}`, `/health`, `/status` all respond.
  - `POST /rpc` is real: most guessed names → `-32601`, **but `octra_balance` is a
    genuine method** (returned `-32602 invalid params: missing required param
    address` — i.e. it exists and takes an address). So the JSON-RPC surface is
    real but its method catalogue is undiscovered. Enumerate it on a healthy node.
  - **Action:** point `OctraClient` at whichever surface is complete. REST covers
    `/staging` + `/balance` + `/status` today; confirm `/address/{addr}` and
    `/tx/{hash}` (or their `octra_*` equivalents) for history + tx detail.

- **🟢 Layer 0 item 3 (authenticated head-epoch) — RESOLVED.** `GET /status`
  returns `current_epoch` and **`head_epoch`** directly
  (`current_epoch:979664, head_epoch:979663`). The confirmation gate has its
  authenticated head source. No need for a separate head RPC.

- **🟢 Layer 0 item 1 (decimal scale) — STRONGLY CONFIRMED = 6.** `/status`
  reports `total_supply:"626706998.542636"` (six fractional digits) and
  `encrypted_supply:"12413100"`. `OCT_DECIMALS = 6` is correct. (Still confirm a
  real tx `amount` is integer µOCT on a tx-detail probe.)

- **Network facts captured:** `network_version: v3.0.0-irmin`,
  `storage_backend: irmin-pack`, `total_accounts: 1,456,450`,
  `encrypted_supply: 12413100` (a live shielded supply exists — relevant to the
  v2 shielded-deposit path).

- **Public node had a degraded explorer/DB during the incident** (`/health`:
  "Public explorer pages are temporarily limited during incident recovery") yet
  `/status` and `/rpc` served fine. *Trust signal:* the single public node is not
  dependable end-to-end — reinforces quorum / run-your-own-node, not optional.

### Checkpoint 1b — RPC + codec resolved against live `/rpc` (2026-05-30)

The "incident" only affects the **explorer/REST** layer (`/address`, `/balance`,
`/staging` via nginx → 503/504). The **JSON-RPC surface at `POST /rpc` is fully
live** and is the dialect we build against. Confirmed working methods:

- **`octra_balance` / `octra_account`** `[CONFIRMED]` — params `[address]` →
  `{ address, balance: "100001205.146166", balance_raw: "100001205146166",
  nonce: 47680, has_public_key: true }`. (Both return the same shape; no history
  param observed — `octra_account` with `[addr, 10]` ignored the limit.)
- **`octra_nonce`** `[CONFIRMED]` — params `[address]` → `{ address, nonce }`.
- **`octra_transaction`** `[CONFIRMED exists]` — params `[hash]`; unknown hash →
  `result: null`; real hash → tx detail (couldn't fetch a real one while explorer
  was down). This is the watcher's tx-detail call.
- **`octra_submit`** `[CONFIRMED exists]` — the send method; empty body →
  `code 105 "malformed transaction: Expected JSON object"`, i.e. it takes the
  signed tx object. Sweeper-only.

- **🟢🟢 `OCT_DECIMALS = 6` — PROVEN on a real account.** `balance_raw`
  `100001205146166` ÷ `balance` `100001205.146166` = exactly 1e6. Use
  `balance_raw` (integer µOCT) everywhere; never parse the decimal `balance`.

- **🟢 Transaction codec — FULLY RESOLVED from `octra_pre_client/cli.py`:**
  - Tx body: `{ from, to_, amount: str(int(oct*1e6)), nonce: int, ou: "1"|"3",
    timestamp: float, message?, signature, public_key }`.
  - **Signed blob = compact JSON of the tx EXCLUDING `message` and `signature`**
    (`json.dumps({k:v for k,v in tx if k!='message'}, separators=(',',':'))`),
    signed with **Ed25519 (NaCl)**, signature base64.
  - **tx hash = `sha256(blob).hexdigest()`** — we recompute this locally for
    authenticity (never trust the node's hash). ⚠️ verify whether the node's
    canonical blob includes `message` before relying on hash match when a memo is
    present.
  - `public_key` = base64 of the Ed25519 verify key.
  - **🔑 Security consequence:** `message` is **NOT in the signed blob** → a memo
    is not signature-bound. This *independently confirms* the canonical
    **single-use-address binding** (commitment via `to_`, which IS signed) over
    the `message` fallback. Good — our design already chose this.

### Genuinely remaining (small, all discoverable — no Octra-team dependency for build)

1. **Address derivation from pubkey** — the one code gap. Not in `cli.py` (it only
   loads `addr` from `wallet.json`); it lives in `webcli` C++ (`wallet.hpp`,
   TweetNaCl). Pattern is `^oct[1-9A-HJ-NP-Za-km-z]{44}$` (base58, 47 chars).
   Get it by reading `wallet.hpp` (GitHub was rate-limiting; retry) OR — simplest —
   generate one wallet with the official client and read the addr/priv it writes.
2. **History/inbound endpoint shape** — `octra_account` returned no tx list; the
   tx history is the REST `/address/{addr}` path (down during incident). Re-probe
   when the explorer recovers, OR just rely on per-single-use-address polling
   (scheme A doesn't need shared-address history at all).
3. **A real `octra_transaction` result shape** — need any real tx hash to see the
   field names (amount/to/from/epoch/message). One test send resolves this.
4. **Finality** — treated as legitimate per decision; hedge with conservative
   confirm-depth + valor cap. No build dependency.

