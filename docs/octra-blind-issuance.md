# Octra Blind Issuance: Native OCT Funding Rail

**Status:** Specified, not yet implemented · sibling of [`arcanum-blind-issuance.md`](./arcanum-blind-issuance.md) (EVM rail, implemented)

This document specifies a third ingestion rail for Arcanum notes: a native Octra (OCT) payment that funds the **exact same note** as the EVM rail. It is implementation-ready, but several Octra protocol facts are **UNCERTAIN** against current (post-archive) sources and are flagged inline. The flags are not decoration — the rail is **not safe to run on mainnet until the items in Layer 0 are resolved empirically against a live mainnet-alpha node.**

A note on confidence flags used throughout:

- **[CONFIRMED]** — verified in a current reference client (`octra-labs/webcli`) or against Noema source on disk.
- **[CONFIRMED-ARCHIVED]** — seen only in the archived `octra_pre_client` / archived REST client; the live node may differ.
- **[UNCERTAIN]** — not verified against any current authoritative source (`docs.octra.org` returned 403 during research); must be confirmed on a live node before relying on it.

## What this is

The OCT rail is a **third way to mint the exact same Arcanum note**. Today a note is born one of two ways: a user deposits ETH or an ERC-20 against a commitment (the EVM blind-issuance path), and the platform inserts that commitment into `arcanumTree`. The OCT rail adds a third source — a native OCT payment carrying (or pointing at) the commitment — that lands at the **same** `arcanumTree.insert(commitment, valor)`. There is one tree, one anonymity set, one circuit, one verification key. OCT-funded and EVM-funded leaves are cryptographically indistinguishable the moment they are inserted.

This works because the Arcanum note is chain-agnostic by construction. A note is `commitment = poseidon(nullifier, secret)`, stored as `leaf = poseidon(commitment, valor)` in a depth-32 tree, and spent by proving Merkle membership of that leaf plus knowledge of the preimage. None of that references Ethereum, an address, or a token. "Where the money came from" is purely an *ingestion* concern — the note neither knows nor cares. The OCT rail is therefore a new ingestion front-end bolted onto an unchanged note core.

The leaf binds **only** `commitment` and `valor` (`leaf = poseidon(commitment, valor)`; verified against `src/arcanum/ArcanumTree.ts`). The nullifier is *not* part of the leaf. `nullifierHash` is never known, computed, or recorded at ingestion — it is revealed and recorded in `arcanum_nullifiers` (under a unique index) only at **spend** time. An OCT ingestion therefore carries only the commitment; it cannot and must not attempt to record a nullifier.

### EVM-rail → OCT-rail mapping

| EVM rail (blind issuance) | OCT rail | Notes |
|---|---|---|
| `commitment` passed as `bytes32` calldata to `payETHAnonymous` / `payAnonymous` | `commitment` recovered from a **single-use deposit address** the platform issued for that commitment (canonical), or from the tx `message` field (fallback) | See Layer 2. The single-use-address binding maps `address → commitment` server-side and is recovered from the immutable, signed `to_` field. The `message` binding is a fallback that depends on UNCERTAIN node behavior. |
| Contract emits `AnonymousDeposit(commitment, token, amount)` event | An **inbound OCT transaction** to a platform-controlled `oct…` address, carrying OCT in `amount` | No event/log model; there is just a tx with a `to_` of one of our addresses. The verified tx hash plays the role the event log played. |
| Alchemy **push webhook** (HMAC-signed) delivers logs | **Polling watcher** (`startOctraWatcher`) that pulls inbound txs via JSON-RPC and advances a Mongo cursor | Octra has no push delivery. HMAC validation is replaced by **local signature + tx-hash recomputation + multi-node quorum** (Layer 6) plus tx-hash idempotency. **[UNCERTAIN]** finality depth, pagination semantics, and exact JSON-RPC result shapes — verify empirically. |
| **`payer`** (`msg.sender` / `topics[1]`) deliberately ignored | **Sender `from` deliberately ignored** | OCT's `from` is plaintext on a public tx (PVAC gives amount confidentiality, *not* sender anonymity). The watcher records only `{ commitment, amount, txHash }`-class data, never the payer — exactly as the EVM rail discards `payer`. Anonymity comes from the shared tree, not from the rail. |
| `ethPrice` (live token→USD via PriceFeedService) | **OCT→USD** via an admin-set rate (v1), optionally DEX-derived (wOCT/ETH × ETH/USD) later | There is **no first-party OCT/USD oracle** and the only market is a single thin DEX pool. OCT amounts are integer **micro-units (1 OCT = 1e6)** [CONFIRMED, re-verify on live node]. Treat pricing as low-confidence; see Layer 4. The funding rate and the pinned `USD_PER_POINT = 0.000337` conversion are reused unchanged. |
| `arcanumTree.insert(commitment, valor)` | **SAME `arcanumTree.insert(commitment, valor)`** | Identical call, identical leaf. This is the whole point. |

## Layered design

The system is built in clearly separated layers, each with a single responsibility. Layers 1, 3 (the insert), 5, and the entire spend path are **shared, unchanged code**. Only Layers 0, 2, the watcher mechanics of 3, 4, and 6 are OCT-specific.

### Layer 0 — Verify-first (the gates)

Nothing in this spec should be built against mainnet until these are confirmed on a live mainnet-alpha node. They are launch blockers, not "verify later" notes.

1. **Decimal scale.** Confirm 1 OCT = 1,000,000 micro-units **as reported by the live node's tx detail**. A wrong scale mis-prices every deposit by a power of ten — in the dangerous direction it mints orders of magnitude too much valor against real funds. Gate with a known-value test deposit and a runtime per-deposit valor ceiling (Layer 4). **[CONFIRMED-ARCHIVED + wOCT contract; UNCERTAIN on live node.]**
2. **Finality / reorg semantics.** Confirm whether an epoch-assigned tx can be reverted. A `tree.insert` is **irreversible** (a leaf can never be removed; the tree never migrates), so the rail feeds an irreversible structure. If post-epoch txs can revert, the rail mints permanent, spendable notes against funds that may vanish, with no clawback. **Resolve with the Octra team before mainnet.** **[UNCERTAIN — undocumented.]**
3. **A real head/finalized-epoch RPC.** The confirmation gate is `headEpoch − tx.epoch ≥ OCTRA_CONFIRM_EPOCHS`. `headEpoch` **must** come from an authenticated chain-head query, never be derived from the epochs seen on a returned history page (that is circular and stalls or front-runs the gate). Confirm such an RPC exists. **[UNCERTAIN.]**
4. **`message` survivability (only if using the fallback binding).** Confirm the live node (a) accepts and (b) **durably returns** a `message` on inbound public standard txs, and whether `message` is inside the Ed25519-signed canonical blob. If `message` is stripped, not returned, or not signature-bound, the message binding is **non-viable** and the single-use-address binding (the canonical design) is mandatory, not optional. **[UNCERTAIN — clients disagree on signing; node enforcement unknown.]**
5. **JSON-RPC result shapes & pagination.** Confirm the exact shapes of `octra_account`, `octra_transaction`, `octra_balance`, the head-epoch method, and whether history can be paged past `limit`. **[UNCERTAIN.]**
6. **RPC trust.** A single RPC node is an unauthenticated oracle for "this tx exists, to us, amount X, epoch Y." Mint authenticity must not rest on one node (Layer 6). Decide the node-quorum / self-hosting posture before mainnet.

The RPC dialect lives behind a single `OctraClient` seam, so resolving 1/3/5 is a one-file change.

### Layer 1 — The note core (unchanged, chain-agnostic)

Identical to the EVM rail. `commitment = poseidon(nullifier, secret)` (circomlibjs Poseidon over BN254/alt-bn128). Stored as `leaf = poseidon(commitment, valor)` in a depth-32 tree with immutable zero values. Spent by a Groth16 proof of Merkle membership plus preimage knowledge. Public signal order is `[root, nullifierHash, valor, recipient]`. The OCT rail does not touch any of this.

The scalar field is alt-bn128 / BN254 (one curve, two names; use **BN254** throughout). Pin the modulus once as a single named constant, sourced from arcanum-core:

```ts
// One constant, used everywhere a commitment is validated.
const BN254_FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
```

### Layer 2 — Commitment binding & end-to-end flow

This pins down how the commitment travels from the client to `arcanumTree.insert(commitment, valor)` over the OCT rail, what the platform publishes as its deposit identity, and the hop-by-hop flow. It is the OCT analogue of the EVM rail's "commitment-in-`bytes32`-calldata → event" binding — but with no contract and no event.

#### Two binding schemes — single-use address is canonical

There are two ways to associate an inbound OCT tx with a commitment. **The single-use deposit-address scheme is canonical for v1.** The `message` scheme is a fallback usable only if Layer 0 item 4 passes.

**A. Single-use deposit address (canonical).** When a client wants to fund a note, it **registers a deposit intent** with the platform, supplying its commitment. The platform derives a fresh, single-use `oct…` address from the platform seed, stores `address → commitment` server-side, and returns the address to the client. The client sends a plain OCT transfer to that address with **no memo required**. The watcher recovers the commitment from the **receiving address** (the immutable, signed `to_` field), not from any user-supplied field.

This is the canonical scheme because it structurally eliminates three otherwise-fatal problems:

- **Front-running / griefing.** With a public `message`-carried commitment, an on-chain observer can read a victim's commitment from staging and race a dust tx carrying the same commitment; first-writer-wins dedup then burns the victim's larger payment. A single-use address is never public until the client receives it, and the `address → commitment` map is server-side, so there is nothing to copy.
- **Tamper-in-flight.** `message` may not be inside the signed blob (clients disagree, Layer 0). `to_` always is. Binding to `to_` means the commitment is cryptographically bound to the transfer.
- **Pagination completeness.** Each single-use address has at most one funding tx, so reconciliation is a bounded per-address lookup, immune to the "burst exceeds `limit`, deposits scroll off the page and are lost" failure of walking one shared address's unbounded history.

The `address → commitment` map is transient state, deleted after the note is issued and funds swept. Its only privacy cost is a short-lived server-side row.

**B. `message`-carried commitment (fallback, gated on Layer 0 item 4).** The client puts the commitment directly in the tx `message` and sends to the **one** published platform address. The watcher reads it back and validates it. Use **only** if a live node is confirmed to accept, durably return, and sign over `message`. Even then it inherits the front-run/grief and pagination risks above and must add the mitigations in Layer 6 (credit-first-confirmed-as-overpayment, not silent skip).

Decide A-vs-B by the Layer 0 verification. The rest of this doc assumes **A** and notes where **B** diverges.

#### Commitment encoding (load-bearing, one rule)

Whichever scheme is used, the commitment is normalized to the **decimal field-element string** `arcanumTree.insert` expects (verified against `ArcanumTree.ts`). The canonical **wire** form (when a commitment must be serialized — registration payload, or the `message` fallback) is:

- `0x` + **exactly 64 lowercase hex** chars (66 total), zero-padded left. Byte-identical to the EVM rail's `bytes32`, deliberately, so one commitment is valid on either rail.

The parser/validator MUST, in order: (1) require the `0x` prefix; (2) require exactly 64 lowercase hex chars after it; (3) parse to an integer in `[1, BN254_FIELD_ORDER)`; (4) **canonical re-encode** — re-encoding the parsed value via the rule above must equal the input (rejects decimal aliases, mixed case, leading junk, non-padded forms). Anything failing is recorded with a terminal skip status (Layer 3) and never inserted. This prevents two distinct strings from aliasing to one leaf. The reference parser and this wire rule are the same rule — do **not** accept bare decimal.

```ts
function parseCommitment(raw: string | null): string | null {
  if (raw == null) return null
  if (!/^0x[0-9a-f]{64}$/.test(raw)) return null          // prefix + exactly 64 lowercase hex
  const value = BigInt(raw)
  if (value <= 0n || value >= BN254_FIELD_ORDER) return null
  if (('0x' + value.toString(16).padStart(64, '0')) !== raw) return null // canonical
  return value.toString()                                  // decimal string for arcanumTree.insert
}
```

#### The platform oct-address(es)

Platform-controlled `oct…` addresses use the **[CONFIRMED]** model: `"oct" + base58(sha256(ed25519_pubkey))`, exactly **47 chars**, regex `^oct[1-9A-HJ-NP-Za-km-z]{44}$` (Bitcoin base58 alphabet; both reference clients agree). Under scheme A these are single-use addresses derived from the platform seed; under scheme B it is one static published `OCTRA_PLATFORM_ADDRESS`. The recipient field is `to_` — the **trailing underscore is load-bearing** in the Octra tx schema **[CONFIRMED]**. The platform **ignores `from`** on every inbound tx, the exact analogue of the EVM rail ignoring `msg.sender`.

#### End-to-end flow (numbered)

Steps 5–8 are **byte-for-byte the EVM-rail flow** and reuse the existing Arcanum router and spend path unchanged.

```
1. CLIENT   nullifier, secret  ←  random (32 bytes each)
            commitment = poseidon(nullifier, secret)         // circomlibjs, BN254
            store (nullifier, secret, commitment) locally — never transmitted
            (nullifier is NEVER sent; the platform never learns it until spend)

2. CLIENT   register deposit intent with the platform, sending commitment (hex wire form)
            → platform stores address→commitment, returns a single-use depositAddr (47 chars)
            (scheme B: skip registration; commitment will ride in `message`)

3. CLIENT   build + sign an OCT transfer (Ed25519, local) from a FRESH oct-wallet:
              to_     = depositAddr                          // scheme A
              amount  = chosen OCT, integer µOCT string      // 1 OCT = 1e6 [re-verify]
              message = (none)                               // scheme A; scheme B: hex commitment

4. CHAIN    tx accepted, leaves staging, matures past OCTRA_CONFIRM_EPOCHS
            (never ingest staging — that is pre-confirmation) [finality UNCERTAIN]

5. WATCHER  poll inbound txs; for each NEW, CONFIRMED tx to a platform address:
              a. verify Ed25519 signature + recompute tx hash locally (Layer 6)
              b. quorum-confirm existence/amount/epoch across ≥2 nodes (Layer 6)
              c. dedup on tx hash (octra_deposits unique index)
              d. recover commitment: scheme A → address→commitment map;
                 scheme B → parseCommitment(message)  (terminal-skip if invalid)
              e. dedup on commitment (arcanumTree.findLeaf; terminal-skip if present)
              f. amount(µOCT) → OCT → USD → valor   (rate pinned at confirmation, Layer 4)
              g. arcanumTree.insert(commitment, valor)        ← SAME call as EVM rail
              h. mark octra_deposits row processatum; advance cursor

6. CLIENT   poll GET /arcanum/tree/leaf/:commitment  until 200
            → { commitment, leafIndex, valor, insertedAt }

7. CLIENT   GET /arcanum/tree/proof/:leafIndex
            → { root, pathElements[32], pathIndices[32] }

8. CLIENT   generate Groth16 proof locally (WASM):
              private: (nullifier, secret, pathElements, pathIndices)
              public:  [root, nullifierHash, valor, recipient]
            call inceptor with { arcanumProof }; arcanumVerifier.verify();
            nullifierHash recorded in arcanum_nullifiers; note spent, never replayable
```

**Why this produces an indistinguishable leaf.** Step 5g calls `arcanumTree.insert(commitment, valor)` with `commitment` as the canonical decimal field-element string and `valor` as a `bigint` — exactly the types `ArcanumTreeStore.insert` already accepts (verified against `ArcanumTree.ts`). The resulting `leaf = poseidon(commitment, valor)` is bit-for-bit a leaf the EVM rail could have produced. Nothing downstream — `findLeaf`, `getProof`, the circuit, the verifier, the nullifier set — can tell an OCT-funded leaf from an EVM-funded one. That co-mingling in one tree is the entire point.

**Client polling contract (steps 6–7).** `GET /arcanum/tree/leaf/:commitment` returns `404` until the watcher's `insert` has landed, then `200` with `{ leafIndex, valor, insertedAt }`. The client must poll because `leafIndex` is assigned **server-side** at insert time. `GET /arcanum/tree/proof/:leafIndex` then yields the current `{ root, pathElements, pathIndices }`. Both endpoints are reused **verbatim** from the EVM/identified rails.

### Layer 3 — Ingestion: the OctraWatcher

This is the bulk of the new code. Octra gives us no webhook and no event log, so we **poll**. The watcher walks platform addresses' inbound history, recovers `(commitment, valor)` per eligible tx, and calls the **same `arcanumTree.insert()`** the Alchemy path uses. It does **not** use `ArcanumIssuer.issue()` — that function (verified at `src/ledger/ArcanumIssuer.ts:54-110`) requires `from.animaId` and unconditionally runs a Signorum balance check and debits identified signa; an OCT deposit has no animaId and no pre-funded balance, so `issue()` would always throw. The EVM blind path likewise bypasses the issuer and inserts directly; the OCT rail does the same. The watcher's one and only write is `arcanumTree.insert(commitment, valor)` — no animaId, no signum, no ledger entry.

> **Dialect.** Build against the current **webcli JSON-RPC 2.0** dialect (`POST /rpc`; methods `octra_account`, `octra_transaction`, `octra_submit`, `octra_balance`, plus a head/finalized-epoch method). The REST paths from the archived client (`/address/{addr}`, `GET /tx/{hash}`, `POST /send-tx`, `GET /balance`, `/staging`) are **archived/stale — do not implement them.** All wire uncertainty is quarantined in `OctraClient`; result shapes are **[UNCERTAIN]** until verified on a live node, so the client normalizes any shape into the dialect-independent `OctraTx`.

#### Why polling, and what the watcher owns

The Alchemy handler is push-based and HMAC-authenticated. The OCT watcher owns four responsibilities the webhook got for free: **authenticity** (Layer 6 — local signature/hash verification + node quorum, since there is no HMAC), **discovery** (find unseen txs), **resumption** (a durable cursor surviving restarts), and **de-duplication** (never insert twice, even though the cursor deliberately over-reads pending txs). This mirrors the repo's background-work patterns (`startIdleReaper`, `startStudioBilling`): an interval loop persisting its resume point to Mongo.

#### Module placement

Following repo conventions (Latin-named state entities, `Mongo*` store class per collection, `start*` factory returning a stop function):

```
src/types/octra.ts                  # OctraTx, OctraDeposit, OctraDepositorum, OctraCursor, OctraClient ifaces
src/octra/OctraClient.ts            # RPC seam: head epoch, history, tx detail, balance, submit (UNCERTAIN bits)
src/octra/octraPricing.ts           # octToValor(microAmount): Promise<bigint> — admin-set rate (Layer 4)
src/crystal/MongoOctraDeposit.ts    # Mongo impl of OctraDepositorum + cursor
src/crystal/OctraWatcher.ts         # the poll loop — calls arcanumTree.insert()
src/api/octra/octraRouter.ts        # register-intent + (reuses arcanum leaf/proof endpoints)
```

`OctraWatcher.ts` is shaped after `src/api/webhooks/alchemyWebhook.ts`: a `deps` bag, a top-level dispatcher, and a per-tx handler returning a processed/skipped boolean. The difference is the entry point is a timer, not an HTTP request, plus the cursor and the staging/confirmation gate.

#### State: the `octra_deposits` collection (durable state machine — canonical)

The rail uses a **durable per-deposit state machine**, not tree-only dedup. Tree-only dedup cannot record "received but not minted" txs (bad memo, dust, price-unavailable), so a single confirmed un-mintable tx would re-block the walk forever and there would be nowhere to track funds owed remediation. `octra_deposits` (Latin store `OctraDepositorum`) holds one document per deposit, from intent through terminal state.

```ts
// src/types/octra.ts

export type OctraDepositStatus =
  | 'expectatum'     // intent registered (scheme A) or first-seen pending
  | 'confirmatum'    // tx confirmed at depth, awaiting a valid price
  | 'processatum'    // valor minted, leaf inserted — terminal success
  | 'remansum'       // received but un-mintable (terminal-skip): bad memo / dup commitment /
                     // dust(valor 0) / mistakenly-shielded — funds received, nothing issued

export interface OctraDeposit {
  id: string
  depositAddr: string          // scheme A single-use address (also the recovery key)
  commitment?: string          // recovered commitment (decimal string)
  status: OctraDepositStatus
  reason?: string              // for remansum: 'bad-message' | 'dup-commitment' | 'dust' | 'shielded'
  txHash?: string              // the funding tx, once seen + verified
  epoch?: number
  amountMicro?: string         // integer µOCT, from the confirmed on-chain tx (never user-claimed)
  octUsdRate?: string          // pinned at confirmation
  fundingRate?: string         // pinned at confirmation
  valor?: string               // bigint, decimal string
  natum: Date
  mutatum: Date
}

/** Normalized inbound transaction, dialect-independent. */
export interface OctraTx {
  hash: string                 // recomputed locally from canonical bytes (Layer 6), not trusted from node
  to: string                   // recipient oct-address (to_) — a platform address
  from: string                 // plaintext sender — verified for signature, then DISCARDED, never stored
  amount: bigint               // micro-units (1 OCT = 1e6), parsed from the node's string
  nonce: number                // sender account nonce (NOT a global ordering key — see cursor note)
  timestamp: number            // Unix seconds (advisory; client-supplied)
  epoch: number | null         // null while in staging / unconfirmed
  message: string | null       // optional memo (scheme B only)
  signature: string            // base64 Ed25519
  publicKey: string            // base64 Ed25519 verify key
}

export interface OctraDepositorum {
  registerIntent(depositAddr: string, commitment: string): Promise<OctraDeposit>
  byDepositAddr(depositAddr: string): Promise<OctraDeposit | null>
  byTxHash(txHash: string): Promise<OctraDeposit | null>
  claimTx(txHash: string): Promise<boolean>     // atomic first-writer claim (unique index)
  save(d: OctraDeposit): Promise<void>
  pending(): Promise<OctraDeposit[]>            // status in {expectatum, confirmatum}
}

/** Resume marker. Single doc per platform-seed scope. */
export interface OctraCursor {
  id: string                   // scope key (the platform identity), also _id
  lastEpoch: number            // highest fully-processed epoch
  lastTxHash: string           // hash of the most recent processed tx (recognizer for the walk)
  lastSeenAt: number           // Unix seconds, ops hint
  mutatum: Date
}
```

**Indexes** (add alongside the existing `arcanum_leaves` / `arcanum_nullifiers` creation in `src/crystal/ensureIndexes.ts`):

- `unique` on `octra_deposits.depositAddr` — one intent per single-use address.
- `unique, sparse` on `octra_deposits.txHash` — an inbound tx funds at most one deposit; primary replay guard and the **atomic claim point** (`claimTx`).
- `unique, sparse` on `octra_deposits.commitment` — secondary dedup; the **authoritative** dedup is the existing unique index on `arcanum_leaves.commitment` (a racing double-insert fails closed there).
- plain on `status` for the pending scan.
- `octra_cursors` is a tiny single-doc collection keyed by `_id`; no extra index needed.

> **Cursor note — sender nonce is not a global key.** Each sender has an independent nonce space, so `nonce` cannot order or detect gaps across a shared address's inbound history. The cursor uses `lastEpoch` + `lastTxHash` only. Under scheme A, completeness does **not** rely on history paging at all: reconcile each pending intent by looking up its single-use `depositAddr` directly (bounded, gap-free). The shared-address history walk applies only to scheme B, and there a burst exceeding `limit` is a known funds-loss risk that must trigger a loud failure + backfill, not a silent drop (Layer 0 item 5).

#### Confirmation depth and staging

A `tree.insert` is irreversible, so only believed-final txs are inserted. Per poll, a tx is **eligible** only if it has left staging (has an `epoch`) **and** `headEpoch − tx.epoch ≥ OCTRA_CONFIRM_EPOCHS`, where `headEpoch` comes from the **authenticated head-epoch RPC** (Layer 0 item 3) — **never** from `max(epoch)` over the returned page (circular; stalls under sparse traffic and is attacker-inflatable). `OCTRA_CONFIRM_EPOCHS` is **our** conservative constant, not a protocol guarantee; start high and revisit once finality is documented. Staging entries are **never** ingested. The cursor advances past a tx only once it is eligible and reaches a terminal state (`processatum` or `remansum`), so pending txs are re-read every poll — this deliberate over-reading is why idempotency (below) is mandatory.

#### Idempotency (two layers, mirroring the EVM path)

1. **Commitment-in-tree (authoritative).** Before inserting, `arcanumTree.findLeaf(commitment)`; if present, the deposit is already done — mark it terminal and advance. `arcanum_leaves.commitment` has a unique index, so `arcanumTree.insert` is the **atomic** dedup point: a unique-constraint violation MUST be caught and treated as "already processed", not surfaced as an error. `findLeaf`-then-`insert` is a check-then-act race made safe only by catching that violation.
2. **Processed-tx claim (cheap pre-filter).** `octra_deposits.claimTx(txHash)` atomically claims a tx via the unique `txHash` index before pricing/inserting. A replayed or re-observed tx is claimed at most once.

#### Pricing and amount parsing

Amount → valor reuses the exact shared pricing chain (Layer 4) — no discount or premium for the OCT rail. The only OCT-specific step is unit normalization: amounts arrive as **strings of integer micro-units, 1 OCT = 1,000,000** [CONFIRMED, re-verify on live node], matching wOCT's 6 decimals. All amount math stays in `bigint` µOCT until the single USD step. Amount is read **only** from the confirmed on-chain tx — there is no user-claimed amount to forge.

> **Shielded transfers cannot bind a commitment.** The shielded `private_transfer` payload has **no `message` field**, and it is UNCERTAIN whether any memo is accepted on a shielded send. The OCT rail therefore accepts **public `standard` transfers only**. A shielded inbound transfer to a platform address is recorded `remansum / reason: "shielded"` (logged at `warn`) and never credited. Do not advertise a shielded deposit path in v1 (see Layer 6 for the v2 possibility).

#### The watcher (skeleton, shaped like `alchemyWebhook`)

```ts
// src/crystal/OctraWatcher.ts
import type { ArcanumTreeStore } from '../arcanum/ArcanumTree.js'
import type { OctraClient } from '../octra/OctraClient.js'
import type { OctraDepositorum, OctraCursorStore, OctraTx } from '../types/octra.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:octra-watcher')

export interface OctraWatcherDeps {
  arcanumTree: ArcanumTreeStore
  deposita: OctraDepositorum
  cursors: OctraCursorStore
  client: OctraClient                 // quorum-backed; verifies sig + recomputes hash internally
  priceToValor: (amountMicro: bigint) => Promise<bigint | null> // null => price unavailable
  isPlatformAddress: (to: string) => Promise<string | null>     // → commitment (scheme A) or '' (scheme B base addr)
  maxValorPerDeposit: bigint          // circuit-breaker: reject+alert if exceeded (Layer 4/6)
  confirmEpochs: number               // OCTRA_CONFIRM_EPOCHS — ours, not the chain's
  pageLimit: number
}

export function startOctraWatcher(deps: OctraWatcherDeps, intervalMs = 15_000): () => void {
  const poll = async (): Promise<void> => {
    try {
      const headEpoch = await deps.client.fetchHeadEpoch()   // authenticated head — NOT max(page)
      // Scheme A: reconcile each pending intent by its single-use address (gap-free).
      for (const dep of await deps.deposita.pending()) {
        const tx = await deps.client.fetchInbound(dep.depositAddr) // ≤1 funding tx per address
        if (tx) await handleOctraTx(tx, headEpoch, deps)
      }
      // (Scheme B variant walks the shared address history with a recognizer cursor;
      //  a burst exceeding pageLimit must raise a loud backfill alert, not drop silently.)
    } catch (err) {
      log.warn('octra poll failed', { error: String(err) })
    }
  }
  const timer = setInterval(() => { void poll() }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

/** Returns true iff the tx reached a terminal state this pass (processatum or remansum). */
async function handleOctraTx(tx: OctraTx, headEpoch: number, deps: OctraWatcherDeps): Promise<boolean> {
  // a. Recipient must be a platform address; recover commitment (scheme A) or expect memo (scheme B).
  const bound = await deps.isPlatformAddress(tx.to)
  if (bound === null) return false

  // b. Confirmation: left staging AND deep enough (depth is OURS; head is authenticated).
  if (tx.epoch === null) return false                       // pending — re-read later
  if (headEpoch - tx.epoch < deps.confirmEpochs) return false

  // c. Authenticity: OctraClient already verified Ed25519 sig + recomputed hash + quorum.
  //    Claim the tx atomically (unique txHash). A loser of the race is already handled.
  if (!(await deps.deposita.claimTx(tx.hash))) return true

  // d. Recover commitment. Scheme A from the bound map; scheme B parses+validates the memo.
  const commitment = bound !== '' ? bound : parseCommitment(tx.message)
  if (!commitment) { await terminal(tx, 'remansum', 'bad-message', deps); return true }

  // e. Commitment-in-tree is authoritative idempotency.
  if (await deps.arcanumTree.findLeaf(commitment)) { await terminal(tx, 'processatum', undefined, deps); return true }

  // f. Price (pinned at confirmation). Null => leave confirmatum and retry (bounded), do NOT mint.
  const valor = await deps.priceToValor(tx.amount)
  if (valor === null) { await markConfirmedAwaitingPrice(tx, deps); return false }
  if (valor <= 0n)    { await terminal(tx, 'remansum', 'dust', deps); return true }
  if (valor > deps.maxValorPerDeposit) { await alertAndHold(tx, valor, deps); return false } // circuit-breaker

  // g. The one write: SAME tree, SAME insert as the EVM blind path. Catch unique-violation as done.
  try { await deps.arcanumTree.insert(commitment, valor) }
  catch (e) { if (!isUniqueViolation(e)) throw e }
  await terminal(tx, 'processatum', undefined, deps)
  log.info('octra commitment inserted', { hash: tx.hash, valor: valor.toString() })
  return true
}
```

Note the parallels to `alchemyWebhook.ts`: a `deps` bag, a recipient-address filter (vs. the vault-address filter), a per-event handler returning a processed/skipped boolean, idempotency before any state change. The structural differences are the cursor, the authenticated confirmation gate, the durable `remansum` terminal state for un-mintable txs (so they never re-block the walk), and the per-deposit valor circuit-breaker.

#### The RPC seam (`OctraClient`)

All wire uncertainty lives here. The interface covers everything the watcher and sweeper need:

```ts
// src/octra/OctraClient.ts
import type { OctraTx } from '../types/octra.js'

export interface OctraClient {
  // --- read (watcher) ---
  fetchHeadEpoch(): Promise<number>                          // authenticated chain head (Layer 0 item 3)
  fetchInbound(addr: string): Promise<OctraTx | null>        // scheme A: ≤1 funding tx for a single-use addr
  fetchHistory(addr: string, limit: number): Promise<OctraTx[]> // scheme B: newest-first page
  fetchTxDetail(hash: string): Promise<OctraTx>              // amount/message/nonce/epoch
  getBalance(addr: string): Promise<{ balanceMicro: bigint; nonce: number }>
  // --- write (sweeper only; signs locally) ---
  submitTx(signed: unknown): Promise<{ hash: string }>
}
```

Implementation MUST: normalize any dialect into `OctraTx`; **verify the Ed25519 signature and recompute the tx hash locally** from the canonical bytes (never trust the node's `hash`); back reads with a **node quorum** (≥2 independently operated nodes must agree on existence/amount/epoch) before a tx is treated as authentic (Layer 6). History returns only `{hash, epoch}` in the archived shape, requiring a second `fetchTxDetail` per tx — batch these, they are the hot path. No JS/TS SDK exists; this is hand-rolled HTTP + JSON. Signing is needed only for sweeps (Layer 5), never for ingestion.

#### DI wiring and startup

The whole rail is **additive and gated**: it no-ops if `OCTRA_RPC_URL` is unset.

```ts
// src/container.ts — add to createContainer() and the Ring interface
const octraClient = makeOctraClient(OCTRA_RPC_URLS)         // quorum of nodes
const octraDeposita = new MongoOctraDeposit(db)             // 'octra_deposits' + 'octra_cursors'
// return { ...existing, octraClient, octraDeposita }

// src/index.ts — startup block, only if configured
let stopOctra: (() => void) | undefined
if (OCTRA_RPC_URL) {
  stopOctra = startOctraWatcher({
    arcanumTree: ring.arcanumTree,
    deposita: ring.octraDeposita,
    cursors: ring.octraDeposita,
    client: ring.octraClient,
    priceToValor: (amount) => octToValor(amount),
    isPlatformAddress: (to) => ring.octraDeposita.byDepositAddr(to).then((d) => d?.commitment ?? null),
    maxValorPerDeposit: OCTRA_MAX_VALOR_PER_DEPOSIT,
    confirmEpochs: OCTRA_CONFIRM_EPOCHS,
    pageLimit: OCTRA_PAGE_LIMIT,
  }, OCTRA_POLL_INTERVAL_MS)
  log.info('octra watcher started')
}
// add stopOctra?.() to the graceful-shutdown handler alongside the other stop functions.
```

Mount `createOctraRouter` (register-intent endpoint) on the API; it reuses the existing `GET /arcanum/tree/leaf/:commitment` and `/proof/:leafIndex` for the client poll — the OCT rail adds **no** new client-facing endpoint beyond intent registration.

### Layer 4 — OCT→valor pricing & oracle

**This is the single riskiest real-world dependency in the rail.** Everything else is deterministic mechanics. The OCT→USD rate is external, manipulable, and thinly traded; getting it wrong mints the wrong valor against irreversible funds. Treat every UNCERTAIN here as a launch blocker.

#### Conversion path — OCT gets no special treatment

The only new step is OCT→USD. The USD→valor step is the **shared helper**, identical to ETH and every ERC-20. No anonymous discount, no rail-specific fudge.

```
microOCT (string, integer)
  ──(÷ 10^OCT_DECIMALS)──>  OCT
  ──(× octUsdRate)──>       grossUsd
  ──(× fundingRate)──>      userUsd          // risk haircut, NOT a per-USD discount
  ──(shared USD→valor)──>   valor (bigint impetus points)
```

```ts
const grossUsd = (Number(microOct) / 10 ** OCT_DECIMALS) * octUsdRate   // step 1: OCT→USD (NEW)
const userUsd  = grossUsd * OCT_FUNDING_RATE                            // step 2: shared funding-rate haircut
const valor: bigint = usdToValor(userUsd)  // step 3: floor(userUsd / USD_PER_POINT), USD_PER_POINT = 0.000337
```

Keep amounts as `bigint` µOCT until the divide; cross into float only at the USD step, exactly as `tokenDecimalService.calculateUsdValue` does. `valor` is and stays a `bigint` (no fractional points): `valor = max(0n, floor(userUsd / 0.000337))`. Encode the scale as one constant `OCT_DECIMALS = 6` used in exactly one place; never scatter `1e6` literals.

#### Canonical v1 source: admin-set rate

OCT is young (TGE ~Apr 20 2026). There is **no first-party OCT/USD oracle** and **no confirmed reliable CEX market** (MEXC's `OCT/USDT` maps to a different asset, "Omnity Network" — do not trust it). The only genuine market is **wOCT/ETH on Uniswap V4** (Ethereum mainnet), ~$0.7–1.0M/24h — thin, manipulable, and volatile. Aggregators (CoinGecko/CMC `octra`) source from that same pool.

**v1 uses an admin-set rate.** It is auditable and immune to feed manipulation. The pricing helper and watcher deps are built around this single source — there is no DEX-fetch path in v1 code. Concrete parameters (pin these, not placeholders):

- `OCT_USD_RATE` — admin-set, carries `setAt`.
- `OCT_USD_MAX_STALENESS_MS = 3_600_000` (1h) — beyond this the rate is stale and pricing returns `null` (skip-and-retry, below).
- `OCT_FUNDING_RATE = 0.75` — one constant, in the shared token config next to the ETH/USDC entries. Lower than ETH's 0.85 because OCT is volatile and illiquid; this is a risk haircut, not a credit discount.
- `OCTRA_MAX_VALOR_PER_DEPOSIT` — a circuit-breaker ceiling; a single deposit pricing above it is **held and alerted**, never auto-minted, so a scale error or a bad rate cannot silently mint an enormous note.

**Optional later (v1.x): DEX-derived feed.** Read the Uniswap V4 wOCT/ETH pool (use a short **TWAP**, not spot) × a Chainlink ETH/USD feed, bounded by guardrails: reject moves > 15% vs. the last good rate, reject if the TWAP window is too short or pool liquidity below a floor, circuit-break to the last admin rate on any anomaly. **[UNCERTAIN: wOCT contract `0x4647e1fE715c9e23959022C2416C71867F5a6E80`, 6 decimals, is from Etherscan/search — verify on-chain before wiring a feed.]**

#### Pin the rate at confirmation time

Resolve `octUsdRate` **once, at confirmation**, and persist it on the `octra_deposits` row (with `fundingRate`, `grossUsd`/`userUsd`/`valor`), mirroring the EVM `pricing_snapshot`. Never re-price a `processatum` deposit. "Confirmation" = the watcher's eligibility point (epoch assigned, left staging, past `OCTRA_CONFIRM_EPOCHS` against the authenticated head). **[UNCERTAIN: if a reorg can unwind a confirmed tx, pin-at-confirmation is moot — the whole issuance would need to be reversible, which it is not (Layer 0 item 2).]**

#### Fallback when no price is available — skip, never guess

If no fresh, valid rate exists at confirmation (admin rate stale past `OCT_USD_MAX_STALENESS_MS`, or a feed fails its bounds), the watcher **does not invent a price and does not mint**: leave the deposit `confirmatum`, re-attempt pricing on subsequent ticks **up to a bounded retry cap**, and **emit an operational alert** (this is a human-attention condition, not a silent loop). Skip-and-retry is deliberately preferred over auto-substituting a possibly-stale admin rate. The deposit is durably recorded (`octra_deposits`), so retrying loses only time. A manual operator override is an explicit admin action that re-pins a fresh rate.

### Layer 5 — Custody, keys & treasury sweep

Custody of collected OCT: the hot deposit key, the sweep to a cold treasury, and an optional later consolidation onto the EVM treasury via wrapped OCT.

#### What custody involves

Ingestion is **read-only**: the watcher only reads (`octra_account` / `octra_transaction` / `octra_balance` / head-epoch) and needs **no private key**. The only operation requiring the Ed25519 secret is **sweeping** collected OCT off the deposit address(es) (`octra_submit`). This asymmetry is the basis of the design: **the always-on component holds no spend authority.** Under scheme A, funds accumulate across single-use addresses all derived from one platform seed; the sweeper derives each address's key from that seed to sweep.

**Key formats [CONFIRMED]:** archived `wallet.json` is `{ "priv": <b64 ed25519 seed>, "addr": "oct…", "rpc": … }`; current `webcli` stores `data/wallet.oct` as AES-256-GCM under a 6-digit PIN (PBKDF2-SHA256). For server use, declare the raw seed via env (like `BOT_TOKEN` / `MONGODB_URI` in `src/index.ts`), not a PIN-encrypted file. **No SDK [CONFIRMED]:** the sweeper reimplements Ed25519 detached-signature signing over the canonical signed JSON, with `public_key` as base64 of the 32-byte verify key; port and unit-test the codec against `webcli` (`lib/tx_builder.hpp::canonical_json`, `wallet.hpp::derive_address`) before trusting real funds. The two clients **disagree** on whether `message`/`op_type` are in the signed blob — verify which blob the live node validates before signing **[UNCERTAIN]** (sweeps carry no `message`, but `op_type` inclusion matters).

#### Building a sweep

A sweep is an ordinary outbound transfer from a platform address to the cold treasury. Fields (carry the **[UNCERTAIN]** dialect flags):

```jsonc
{
  "from": "<platform deposit address>",
  "to_": "<OCTRA_TREASURY_ADDRESS>",   // [CONFIRMED] trailing underscore load-bearing
  "amount": "<balance - reserve>",     // string, integer µOCT
  "nonce": <next outbound nonce>,      // see below
  "ou": "1",                            // "1" if amount < 1000 OCT else "3"  [CONFIRMED fee tiers]
  "timestamp": <unix_seconds_float>,
  "op_type": "standard",               // webcli only; absent in archived client [UNCERTAIN]
  "signature": "<base64 ed25519>",
  "public_key": "<base64 ed25519 pubkey>"
}
```

- **No `message` on a sweep.**
- **Nonce:** the next outbound account nonce **of the sending platform address**, reconciled only against that address's own staged outbound txs — derived from a **verified/quorum** source, never a single node (a malicious node can feed a stale nonce to force a stuck or replayable sweep). Treat staged entries as **unconfirmed**.
- **Fee [CONFIRMED-ARCHIVED]:** ~`0.001` OCT (`ou=1`) / `0.003` (`ou=3`). Keep `OCTRA_SWEEP_RESERVE` ≥ the worst-case fee so the sweep doesn't underfund; bound sweep amount per run.
- **Submit + confirm:** `octra_submit`, then poll `octra_transaction(hash)` (verifying the **locally recomputed** hash) until it has an epoch and has left staging. **Never resubmit until the prior attempt is provably gone**, to avoid a reorg double-spend. Define an explicit retry/bump/abort state machine.

#### Sweep policy

Keep hot addresses near-empty. Sweep on threshold (`balance > OCTRA_SWEEP_THRESHOLD`) and/or schedule, to a **cold** `OCTRA_TREASURY_ADDRESS` whose key is held offline. **Sweeps are the only outbound txs the platform makes.** The sweeper is a **separate, isolated process** — not the watcher, not the API server — and is the **only** process whose environment holds `OCTRA_SIGNER_PRIVATE_KEY`. A sweep failure must never block `arcanumTree.insert`: the two concerns share an address, not a code path.

#### Optional consolidation to the EVM treasury (out of scope for v1)

Octra runs a native bridge for **OCT ↔ wOCT on Ethereum mainnet** **[CONFIRMED]** — lock OCT → mint wOCT; burn wOCT → unlock OCT; ~2 min, **1:1, 6 decimals both sides**. **There is NO direct Octra→Base bridge [CONFIRMED]** — consolidation is two hops:

```
cold OCT treasury ──(Octra native bridge, 1:1)──> wOCT on Ethereum mainnet
                  ──(standard ERC-20 bridge, separate)──> Base / CreditVault treasury
```

Contracts (verify on-chain before each run — docs page was 403 to research, treat as **sanity-check-required**): wOCT `0x4647e1fE715c9e23959022C2416C71867F5a6E80`; EthereumBridge `0xE7eD69b852fd2a1406080B26A37e8E04e7dA4caE`; OctraLightClient `0xC01cA57dc7f7C4B6f1B6b87B85D79e5ddf0dF55d`. Bridging for custody is 1:1 and slippage-free; **swapping** wOCT on the thin Uniswap V4 pool is slippage/manipulation-exposed — size small or hold wOCT. The bridge signer is distinct from the deposit/sweep key.

#### Minimal-trust recommendation

1. **Read-only watcher, no key.** Compromise of the always-on service leaks no spend authority.
2. **Quorum of nodes you control/trust** as `OCTRA_RPC_URLS`. A malicious RPC is the only party that can mint free notes by fabricating confirmations — owning the nodes (plus local sig/hash verification, Layer 6) closes that hole.
3. **Isolated sweeper, minimal hot balance, cold treasury** whose key never touches a server.
4. **Local signing only.** Never POST a raw private key to any node (the archived shielded REST path did — never do that).
5. **Defer EVM consolidation** until there is a concrete need.

### Layer 6 — Privacy model & threat model

The OCT rail gives the user the **same privacy guarantee** as the EVM rail: the platform learns the commitment and the amount, never *who* funded it. It carries one rail-specific residual leak (sender visibility on a public ledger) and one rail-specific *opportunity* (native shielded transfers, a possible v2).

#### Privacy parity table

| Layer | Platform knows | Platform cannot link |
|---|---|---|
| On-chain deposit (OCT) | platform `oct…` address, amount, commitment (via address map or memo), **sender `oct…` (visible on-chain, deliberately not recorded)** | sender ↔ animaId / real identity |
| Watcher / `octra_deposits` | txHash, depositAddr, commitment, amount (µOCT), valor, pinned `octUsdRate` | any identity (no `from` stored) |
| Merkle tree (`arcanum_leaves`) | commitment, leafIndex, valor | rail of origin (OCT vs EVM), identity |
| Spend | nullifierHash, valor, root, recipient | commitment, funding wallet, animaId |

Rows 2–4 are identical in kind to the EVM rail; the tree row is byte-for-byte the same leaf; the spend reveals only the same four public signals. **OCT- and EVM-funded notes co-mingle in one anonymity set**, so the rail of origin is itself unlinkable post-`insert`. Even an adversary with full read access to the platform DB cannot determine who obtained which note.

#### Residual on-chain sender visibility (the `msg.sender` analogue)

Row 1 differs exactly as EVM does: a **plain OCT transfer exposes `from`** on Octra's public ledger — the analogue of `msg.sender` in EVM calldata. The platform's watcher **ignores `from`** (reads `to_`, `amount`, the bound commitment, and the verified hash). A chain observer can still see `from`.

**Mitigation — identical to the EVM rail: fund from a fresh `oct…` wallet.** A user wanting unlinkability even against chain observers generates a new Octra keypair (`"oct" + base58(sha256(ed25519_pubkey))`, 47 chars) with no history tying it to their identity, funds it, and sends from there. The platform declines to record the one field that is already public. **Document this prominently, with the same weight as the EVM spec.**

#### Threat model — the watcher

The watcher is the new trust surface. There is **no HMAC-authenticated callback**; authenticity rests on **local signature/hash verification + a node quorum + on-chain confirmation depth**.

| Threat | Defense |
|---|---|
| **Free-mint via malicious / spoofed RPC node** | A single node is an unauthenticated oracle. Defenses (all required for mainnet): (1) **node quorum** — ≥2 independently operated nodes must agree on existence/amount/epoch before insert; (2) **verify the tx Ed25519 signature and recompute the tx hash locally** from canonical bytes, so a node cannot fabricate a tx it could not have signed; (3) **per-deposit and per-epoch valor circuit-breakers** with alerting, so a compromised feed cannot mint unbounded notes before a human intervenes. "Run your own node" alone only relocates the trust; until Octra exposes verifiable inclusion proofs, treat the rail as trusted-operator-only and say so. |
| **Reorg removes an already-inserted leaf** | `tree.insert` is irreversible. Eligibility requires a conservative `OCTRA_CONFIRM_EPOCHS` depth against an **authenticated head-epoch** (never `max(page)`, which an attacker can inflate to slip a shallow tx past the gate). Staging is never ingested. A reconciliation job detects a now-missing previously-confirmed tx and quarantines affected leaves. **Finality is [UNCERTAIN] (Layer 0 item 2) — a hard launch blocker; if post-epoch reverts are possible, cap valor mintable per unconfirmed-finality window or do not ship.** |
| **Front-running / griefing a public commitment** | The **canonical single-use-address binding eliminates this**: the commitment is never public and the `address → commitment` map is server-side, so no stranger can race a dust tx carrying the same commitment to burn a victim's larger payment. The `message` fallback is exposed to this; if used, credit the **first sufficiently-confirmed** tx and treat later same-commitment txs as refundable overpayments (`remansum`), never a silent skip, and warn users that a memo-carried commitment is observable. |
| **`message` tamper-in-flight** | `message` may not be in the signed blob (Layer 0 item 4), so it is not cryptographically bound to the transfer. The single-use-address binding uses the **signed `to_` field**, closing this. The `message` fallback is only permitted if a live node is confirmed to sign over `message`; otherwise it is non-viable. |
| **Forged / malformed commitment** | Strict canonical validation (Layer 2 parser) before insert. A *well-formed* commitment a stranger supplies only mints a note whose preimage that stranger already controls — they paid for it, so there is no theft; validation just keeps junk out of the tree. |
| **Duplicate commitment across txs** | `arcanumTree.findLeaf(commitment)` + the `arcanum_leaves.commitment` unique index (the authoritative dedup; a racing insert fails closed and is caught as "already processed"). Under scheme A a duplicate cannot arise from a stranger; document "one commitment per payment." |
| **Amount spoofing** | Credited amount is read from the **confirmed on-chain tx `amount`**, never from user metadata. There is no separate claimed-amount field. |
| **Units / decimal spoofing** | A single `OCT_DECIMALS` constant; the 1 OCT = 1e6 scale is **a Layer 0 launch blocker** (verify on live node with a known-value test deposit) plus a runtime per-deposit valor ceiling. A wrong scale mis-prices by a power of ten. |
| **Cursor wedge / DoS via un-mintable tx** | Confirmed-but-un-mintable txs (bad memo, dust, shielded, dup) reach the durable **`remansum`** terminal state and advance past, so a single dust tx cannot permanently block the walk. Only genuinely *pending* txs hold the cursor. |
| **Pagination gap → dropped deposits** | Scheme A reconciles per single-use address (bounded, gap-free), so no history walk is needed. Scheme B's shared-address walk must raise a **loud backfill alert** on a suspected gap, never drop silently. |
| **Received-but-not-issued funds** | Every skip path (`remansum`) and the price-unavailable hold are durably recorded with a reason, alerted, and routed to an operator workflow. See "Refund vs. privacy" below. |
| **Oracle manipulation** | Admin-set rate (v1); pinned at confirmation and persisted; never re-priced. If a DEX feed is later used, TWAP + guardrails + circuit-breaker to the admin rate. |
| **Hot-key compromise** | Watcher holds **no key**. Spend authority lives only in the isolated sweeper process. |
| **Two watcher replicas double-processing** | Single-instance enforcement (one replica; leader election if scaled) plus the atomic `arcanumTree.insert` unique-violation catch and the `octra_deposits.txHash` claim. `insert` is the atomic dedup point; a unique violation is "already processed", not an error. |
| **Anonymity-set leakage by amount/timing** | A distinctive valor (driven by OCT's volatile price → oddly-specific points) plus insert timing can link a spend to a specific on-chain OCT deposit (whose `from` is public). Mitigate by quantizing valor to coarse buckets / standard denominations rather than minting bespoke per-deposit valor, and document the linkage risk for non-standard amounts alongside the fresh-wallet guidance. |

#### Refund vs. privacy (received-but-not-issued)

Funds can arrive, confirm, and yield no note (`remansum`: bad memo, dup commitment, dust, mistakenly-shielded; or a price-unavailable hold). The privacy stance (do not store `from`) means the platform **cannot unilaterally refund**. Resolve the tension explicitly per deployment: either (a) declare these edge-case funds **non-refundable** and warn users prominently in the client flow, or (b) record minimal sender data **only on the `remansum` path** (accepting the documented privacy cost on that path) to enable an operator-driven refund. The price-unavailable hold has a bounded retry cap and surfaces as an alert, not a silent loop.

## Layer 7 — v2: the encrypted (shielded) payment rail

The v1 rail is a **public** OCT transfer: the amount is visible on Octra's ledger
(only the sender is "ignored," and even that only by *us* — a chain observer sees
it). The v2 rail accepts OCT via Octra's **native shielded transfer**, hiding the
**amount** on-chain. It mints the **same Arcanum note** through the **same**
`arcanumTree.insert(commitment, valor)`. It is **additive** — a swap of the
ingestion *source*, not a new note system, not a tree change.

### The binding is NOT an open question — it already works

An earlier draft flagged "can a shielded transfer carry the commitment?" as a
blocker because the shielded payload has **no `message` field**. That worry is
**moot**: the canonical v1 binding was never the message field — it is the
**single-use deposit address** (`to_`). A shielded transfer is still *addressed to
a recipient*. So the commitment binding (`address → commitment`, server-side)
survives a shielded transfer **completely unchanged**. The encrypted rail drops
onto the binding we already chose. The `message` fallback (scheme B) does not
apply to shielded transfers and is simply unavailable there — fine, we don't use
it.

### How it works — claim-based ingestion

Octra shielded transfers are **claim-based** (not push-to-balance). The endpoints:
`/private_transfer` (sender creates), `/pending_private_transfers?address=`
(recipient lists claimable), `/claim_private_transfer` (recipient pulls into their
encrypted balance). The PVAC engine is Ristretto255 commitments + Bulletproofs
range proofs (`octra_stealthOutputs`, `octra_encryptedBalance`). Flow:

```
1. CLIENT  register intent → single-use depositAddr  (SAME as v1)
2. CLIENT  private_transfer → depositAddr            (amount encrypted on-chain)
3. WATCHER poll /pending_private_transfers?address={depositAddr} → claimable seen
4. CLAIMER claim_private_transfer (signs with depositAddr key) → OCT lands in OUR
           encrypted balance for that address
5. CLAIMER decrypt OUR OWN encrypted balance (we hold the key) → exact µOCT known
6. WATCHER amount → valor (pinned rate), then SAME arcanumTree.insert(commitment, valor)
7+         identical to v1: client polls /arcanum/tree/leaf → proof → spend
```

### What it buys (and what it does not)

| Property | v1 public rail | v2 encrypted rail |
|---|---|---|
| **Amount on-chain** | visible | **hidden** ✅ |
| Sender `from` on-chain | visible (we ignore it) | **still plaintext** ⚠️ |
| Commitment binding | deposit address | deposit address (identical) |
| Note minted | identical | identical |

The real win: it **kills the amount-fingerprinting linkage** (Layer 6) — a
distinctive `valor` can no longer be correlated to a distinctive public deposit
amount, because the deposit amount is no longer public. This makes the OCT
encrypted rail **privacy-stronger than the ETH rail**, which cannot hide amounts
at all. It does **not** hide the sender (PVAC shields amounts, not identities), so
**fresh-wallet discipline still applies**. It is strictly better than v1, not a
full cloak.

### The one real cost — ingestion is no longer read-only

v1's best property: **the watcher holds no key** (read-only ingestion; compromise
leaks no spend authority). v2 **breaks this** — `claim_private_transfer` requires
*signing a claim* with the deposit address's key. So claiming needs spend
authority on the always-on path. Design around it:

- A **separate "claimer" process** (sibling of the Layer 5 sweeper) holds the
  claim key. The watcher only **detects and queues** claimable transfers; the
  isolated claimer signs and submits the claims. The minting watcher stays
  key-less; only the claimer (and sweeper) hold keys.
- Each claim costs a **tx fee** and adds a **second step** (transfer→claim) vs.
  v1's one-step inbound. Bound and batch claims.

### Hard prerequisites (do not build v2 until these clear)

1. **Read `webcli`'s PVAC shielded flow** (`pvac/`) and reimplement claim +
   encrypted-balance decryption with **local signing only**. The **archived REST
   shielded endpoints required POSTing the raw private key to the node — never do
   that.** This is the gating investigation item.
2. **Confirm the claim/decrypt reveals an exact integer µOCT** we can price (Layer
   4 pricing is unchanged; it just needs a clean amount).
3. **Confirm `pending_private_transfers` is pollable per-address** (it is the
   ingestion source, replacing v1's inbound history).

### Why v2, not v1

v1 proves the entire pipeline (intent → watcher → mint → note) with **read-only
ingestion and zero key risk** — the safest possible first cut. v2 is then a
**source swap** (`pending_private_transfers` + `claim` instead of plain inbound)
onto the same binding and the same insert, **plus** the claimer-process security
work. Clean, additive, sequenced after v1 ships.

## What doesn't change

Everything past `arcanumTree.insert` is byte-for-byte the same as the existing rails. The OCT rail must not touch any of it; if any of these had to change to accommodate OCT, the design would be wrong.

- **The leaf lookup endpoint** (`GET /arcanum/tree/leaf/:commitment`) — same endpoint, same response.
- **The Merkle proof** (`pathElements`×32, `pathIndices`×32, root) and the depth-32 tree with immutable zero values.
- **The Groth16 verifier and circuit**, including public-signal order `[root, nullifierHash, valor, recipient]`.
- **Nullifier spend semantics** — `nullifierHash = poseidon(nullifier)`, recorded once in `arcanum_nullifiers` under a unique index at spend time, never replayable. nullifierHash plays **no role at ingestion**.
- **The trusted setup / verification key** — the same bundled key; a different key would make every existing note unspendable.
- **The shared anonymity set** — OCT- and EVM-funded notes co-mingle in one tree, cryptographically indistinguishable at spend.
- **`USD_PER_POINT = 0.000337`** and the shared USD→valor conversion (`src/ledger/rates.ts`, `src/core/constants/economy.js` — keep in sync, do not fork).
- **`ArcanumIssuer.issue()` is NOT used** — it requires an animaId and debits identified signa; the OCT rail (like the EVM blind path) inserts directly into the tree.

The OCT rail is additive ingestion only: one new collection (`octra_deposits` + `octra_cursors`), one new env block, one `start*` call, one register-intent endpoint. It reuses the existing `arcanumTree`, pricing chain, and background-work/shutdown conventions.

## Implementation order

1. **`OctraClient`** — the wire seam. Reimplement Ed25519 signing + canonical JSON + JSON-RPC 2.0 transport against the **webcli dialect**. Implement address validation (`oct` + base58, 47 chars), µOCT math (1 OCT = 1e6, integer strings), and reads: head-epoch, `octra_account`, `octra_transaction`, `octra_balance`. Add local signature verification + tx-hash recomputation + node quorum. This is the largest cost and where all UNCERTAIN bits live; verify shapes empirically (DEVNET first), keep a thin normalization layer.
2. **`octra_deposits` + `octra_cursors`** collections + the state machine; add indexes to `ensureIndexes.ts`.
3. **`octToValor`** (admin-set rate, pinned, guardrails, circuit-breaker ceiling).
4. **`OctraWatcher`** — the poll loop; calls `arcanumTree.insert()` directly.
5. **`octraRouter`** — register-intent endpoint (scheme A); reuse arcanum leaf/proof endpoints for the client poll.
6. **Wire into `Ring` + `index.ts`** (DI + env, no-op if `OCTRA_RPC_URL` unset) and the graceful-shutdown handler.
7. **DEVNET end-to-end**, then a mainnet-alpha smoke test — only after Layer 0 passes.

### Canonical env table

One name, one default per setting. Read at the top of `src/index.ts`; the rail no-ops if `OCTRA_RPC_URL` is unset.

| Var | Default | Who reads it | Purpose |
|---|---|---|---|
| `OCTRA_RPC_URL` / `OCTRA_RPC_URLS` | — | watcher | JSON-RPC node(s); ≥2 for quorum. Rail disabled if unset. |
| `OCTRA_PLATFORM_SEED` | — | router (derive single-use addrs), sweeper | platform key material (scheme A) |
| `OCTRA_PLATFORM_ADDRESS` | — | watcher | static published address (scheme B only) — PUBLIC |
| `OCTRA_CONFIRM_EPOCHS` | `6` | watcher | confirmation depth (ours; conservative) |
| `OCTRA_POLL_INTERVAL_MS` | `15000` | watcher | poll cadence |
| `OCTRA_PAGE_LIMIT` | `50` | watcher (scheme B) | history `limit` arg |
| `OCT_DECIMALS` | `6` | pricing | µOCT scale [re-verify on live node] |
| `OCT_USD_RATE` | — | pricing | admin-set OCT→USD (with `setAt`) |
| `OCT_USD_MAX_STALENESS_MS` | `3600000` | pricing | beyond this, price is stale → skip+retry |
| `OCT_FUNDING_RATE` | `0.75` | pricing | risk haircut (shared token config) |
| `OCTRA_MAX_VALOR_PER_DEPOSIT` | — | watcher | circuit-breaker ceiling per deposit |
| `OCTRA_SIGNER_PRIVATE_KEY` | — | **sweeper only** | b64 Ed25519 seed; never in the watcher's env |
| `OCTRA_TREASURY_ADDRESS` | — | sweeper | cold treasury destination |
| `OCTRA_SWEEP_THRESHOLD` | — | sweeper | µOCT; sweep above this |
| `OCTRA_SWEEP_RESERVE` | — | sweeper | µOCT left behind for fees (≥ worst-case fee) |

### Test plan

**DEVNET first** (webcli is documented compatible with DEVNET and MAINNET ALPHA); do not point at mainnet until the Layer 0 items are confirmed.

1. **Client conformance (live DEVNET).** Verify all Layer 0 UNCERTAIN items: result shapes (`octra_account`/`octra_transaction`/`octra_balance`/head-epoch); whether `message` is in the signed blob and durably returned; the µOCT scale via a known-value deposit; pagination behavior; the canonical signed-blob/`op_type` for sweeps.
2. **Happy path (scheme A).** Register an intent, send a public transfer to the returned single-use address, assert the watcher confirms, prices, inserts the leaf, and the client retrieves it via the leaf/proof endpoints.
3. **Idempotency.** Two poll cycles over one tx → exactly one leaf and one terminal `octra_deposits` row. Replay the same `txHash` and the same `commitment` independently → each rejected (txHash claim, commitment unique index, and `tree.insert` unique-violation backstop).
4. **Replay / restart.** Kill mid-batch and restart → cursor resumes without re-issuing or skipping; cursor advances only on terminal state.
5. **Reorg / finality.** A staging-only tx → no credit; a tx below `OCTRA_CONFIRM_EPOCHS` → no credit; only at depth does it issue. If the team confirms post-epoch reverts, add an appears-then-disappears tx and assert no credit (and the reconciliation/quarantine job fires). Keep depth conservative until confirmed.
6. **Pricing edge cases.** Stale rate → no credit + alert; dust → `remansum`/0 points; per-deposit ceiling exceeded → held + alert; manipulated spike (DEX path) → TWAP + haircut keep points bounded.
7. **Skip/match failures.** No memo (scheme B) / unknown deposit address / shielded inbound → `remansum` with the right reason, never credited to the wrong intent, never wedges the walk.
8. **Sweep (DEVNET).** Codec-verified sweep with correct nonce from a quorum source; confirm inclusion of the locally recomputed hash; assert no resubmit before the prior is provably gone.
9. **Mainnet-alpha smoke.** Only after 1–8 pass: one small live deposit from a fresh wallet, end-to-end, confirming live shapes; sanity-check wOCT/bridge addresses on-chain before any sweep.

No changes to the EVM deposit path, the Arcanum circuit, the verifier, or the trusted setup are required by any of the above.
