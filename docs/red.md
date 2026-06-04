# Red — Critical Gaps in the Crystal

Working document. Items are removed when resolved, not marked done.
Last updated: 2026-05-14

---

## 🔴 Silent bugs — look done, aren't

_(none outstanding)_

---

## 🟠 High — real gaps, not yet causing visible failures

### 4. ~~Expired actum recovery~~ — resolved
`findExpired()` was implemented but only queried `nascens` (missed `agens`), and was never called. Fixed: queries both statuses, boot sweep in `index.ts` now runs on startup.

---

### 5. ~~Ledger hook math unaudited~~ — resolved
Audited all six hooks. Math correct. Three bugs found and fixed:
- **Missing payload fields**: `nexus.emit` was called without `modusAuctorAnimaId` so `spellRoyaltyHook` always returned `[]`. Fixed: `modorum` threaded into webhook deps; modus looked up after completion to populate `modusAuctorAnimaId`.
- **`royalty_fired` never emitted**: `platformSkimHook` was registered but the `royalty_fired` event was never fired. Fixed: after `execution_spend` emit, if any royalty signa returned, we emit `royalty_fired` with the summed valor; both batches land in one `createMany` call.
- **Self-referral not guarded**: `referralSplitHook` would pay a referral to a user who referred themselves. Fixed: added `if (referrerAnimaId === signum.animaId) return []`.

Royalty math: 20% host cut + 10% spell royalty + 5% model royalty = 35% of impetus distributed. Platform takes 5% of baseValor (full execution impetus) when royalties fire — not 5% of the royalty pool. sessionSpend and referralSplit are correct.

**Test suite note:** The fake nexus mock that papered over this (returned signa regardless of payload) has been replaced. Ledger tests now use real Nexus + real hooks + MemorySignorum + MemoryModorum + MemoryActorum. MemoryActorum and MemoryModorum were also fixed to match their Mongo counterparts (agens in findExpired, update() method).

---

### 6. ~~CollectioCursor.onActumCompleta not called for collection acta~~ — resolved
Added `CollectioCursor.findCollectioIdForActum(actumId)` which searches the in-memory `running` sets. Added `collectioRouter?` dep to `ExecutionWebhookDeps` (structural interface: `findCollectioIdForActum` + `onActumCompleta`). Webhook now checks for a collection owner and calls `onActumCompleta(collectioId, actumId, success/false)` on both COMPLETED and FAILED paths. `ring.collectioCursor` passed as `collectioRouter` in `index.ts`. Collection acta completing after restart are properly routed: `rehydrate()` rebuilds the `running` sets, so `findCollectioIdForActum` works correctly post-restart.

---

## 🟡 Medium — structural gaps, not immediately broken

### 8. ~~SecurePodClient unreviewed~~ — reviewed, one bug fixed, two promoted to items 17 and 18

**Fixed — pod leak on SSH timeout:** `_waitForSsh` and `sshFactory` previously ran before the `try/finally` block, so if SSH polling timed out (pod provisioned but never ready) the pod was never terminated. Restructured: both are now inside the `try/finally`; `_terminatePod` always runs on any failure. Test added.

---

### 9. ~~TesseraCursor unreviewed~~ — reviewed, two bugs fixed, budget enforcement closed as non-issue

**Fixed — async acta tracking:** `run()` only appended `actum.id` to `modo.acta` when `result.kind === 'sync'`. Async jobs were invisible to the Modo — their IDs never landed in `acta`. Fixed: always append `actum.id` when a Modo is present; gate `impetusAccrued` update on sync only (async impetus is unknown until the webhook fires). Two tests added.

**Fixed — async impetusAccrued never updated at webhook time:** When an async job completes, the execution webhook now updates `modo.impetusAccrued` using `actum.modoId` (already present on Actum). `modos?: ModoStore` added to `ExecutionWebhookDeps`; wired via `ring.modos` in `index.ts`. Three tests added (updates on COMPLETED, no-op when dep absent, no-op when actum has no modoId).

**Closed — budget enforcement:** The tessera signum `valor` IS the budget. Hard enforcement is already handled by `signorum.lock()` failing when the payer has insufficient signa — no overspend is possible at that layer. Soft pre-dispatch estimation is not meaningful given cold-start and run-time variance. No `budget` field needed on Modo; no `findByModoId` needed on Signorum.

**Intentional — Modo stays `'claiming'`:** `claiming → warming → active` transitions belong to the pod provisioning layer (MateriaFlow / SecurePodClient), not TesseraCursor.

**Files:** `src/crystal/TesseraCursor.ts`, `src/crystal/MemoryModo.ts`, `src/api/webhooks/executionWebhook.ts`, `tests/unit/crystal/executionWebhook.test.ts`

---

### 10. ~~Privacy partition enforcement unverified~~ — verified clean, one gap noted

Partition holds structurally:
- `Actum` type has no `animaId` field — confirmed
- No code path writes `animaId` onto an Actum — grep clean
- `MongoSignorum` and `MemorySignorum` both throw at write time if arcanum/tessera signum has `animaId`
- All Signorum queries (`balance`, `history`, `lock`, `settle`) keyed on `AuctorKey { animaId } | { arcanumHash }` — never raw actumId
- `TesseraCursor` keeps anonymous forma — no animaId written anywhere in tessera path

**Gap found (not a violation):** `actum.nullifier` is declared in the type and the three-hop crossing (`actum.nullifier → signum(arcanum) → signum(deposit) → anima`) is documented throughout. But nothing in the codebase ever *writes* nullifier onto an Actum. The arcanum-funded execution path is scaffolded (type exists, design is documented) but not implemented — arcanum signa can't currently fund an execution. Not a privacy leak; the partition holds. This is a missing feature, tracked separately as item 16.

---

## 🟢 Low — known gaps, lower urgency

### 11. Discord allocutio absent
Mirrors `TelegramAllocutio` (~1 day to implement). Blocking Discord users from the crystal.

### 12. ~~ValidateAditus coverage~~ — reviewed, two bugs fixed

Implementation and test coverage were both solid. Two coercion bugs found and fixed:

- **Empty and whitespace-only strings for `int`/`float` silently became `0`**: `Number('')` and `Number('   ')` both return `0` in JavaScript, which is finite and not NaN, so the old `Number.isNaN` guard never fired. A form field left blank would coerce to `0` instead of raising a validation error. Fixed: guard is now `!Number.isFinite(n) || String(value).trim() === ''`.
- **`Infinity` passed through `int` fields**: `Number.isNaN(Infinity)` is `false`, so `Math.round(Infinity)` returned `Infinity` as a valid integer. Fixed by the same `!Number.isFinite()` change.

Seven new tests added covering empty string, whitespace-only string, and Infinity for both `int` and `float`.

### 13. ~~Compiler correctness~~ — audited, one bug fixed

**Fixed — `'increment'` seed strategy never fired:** `_resolveSeed` had `case 'incremented':` but the type defines the value as `'increment'`. Any collection using `seedStrategy: 'increment'` (base + pieceIndex) would throw `UNKNOWN_SEED_STRATEGY` at runtime. Fixed: `case 'increment':`. One test added.

**No other bugs found.** Slot map traversal, model resolution, seed strategies (shuffle/fixed/increment), cook flag merging, hash determinism, and error paths all correct.

**Intentional gap — composed modus compilation:** The crystal `Compiler` only handles `Essentia` with `runpodSpec`. Composed modi are not supported — `index.ts` throws clearly if `runpodSpec` is absent. Composed compilation remains in the legacy JS layer for now.

**Files:** `src/crystal/Compiler.ts`, `tests/unit/crystal/Compiler.test.ts`

### 14. ~~TraitMixer edge cases~~ — audited, tag-group exclusion added

Audit findings:
- **No bugs found.** LCG seeding, weighted selection, exclusion filtering, and prompt assembly are all correct.
- **`rarity` naming**: used as a selection weight (higher = more common). Counterintuitive for NFT context — documented in the type comment.
- **No uniqueness guarantee**: the algorithm doesn't prevent two pieces from sharing identical trait combinations. Statistically unlikely for large collections; acceptable for now.
- **Tag-group mutual exclusion added**: `tags?: string[]` on `TraitValor` + `tagRules?: string[][]` on `selectForPiece`. Each inner array is a mutually exclusive group — once a valor with tag `'fantasy'` is selected, all subsequent valors tagged `'sci-fi'` are filtered out (and vice versa). Stacks with the existing label-level `excludes` mechanism. Five new tests added.

**Files:** `src/types/collectio.ts`, `src/crystal/TraitMixer.ts`, `tests/unit/crystal/TraitMixer.test.ts`

### 16. ~~Arcanum execution path unimplemented~~ — resolved

**ArcanumIssuer** (`src/ledger/ArcanumIssuer.ts`): converts identified balance → arcanum signum in one call. Generates 32-byte secret, computes `arcanumHash = sha256(secret)`, locks and settles identified signa, issues arcanum signum with `testis: arcanumHash`. Returns `{ secret, arcanumHash, signumId }` — secret never stored; platform cannot reverse the anonymization. `signumId` is the future nullifier.

**Nullifier stamping** (`ActumInceptor.initiate()`): when `by = { arcanumHash }`, finds the arcanum signum in the selected set, checks `findByNullifier()` for double-spend, then stamps `actum.nullifier = arcanumSignum.id`. Identified path (`by = { animaId }`) is unchanged.

**Double-spend protection**: `findByNullifier()` added to `Actorum` interface, `MemoryActorum`, and `MongoActorum`. Any second attempt to spend the same arcanum signum is rejected before the lock step.

No ZK needed: nullifier = arcanum signum's UUID ID. The crossing (`actum.nullifier → signum(arcanum) → signum(deposit) → anima`) is now live.

**Tests:** 8 tests in `ArcanumIssuer.test.ts` (issuance, refund, privacy partition, secret entropy), 3 in `ActumInceptor.test.ts` (no nullifier on identified path, nullifier stamped on arcanum path, double-spend rejected).

---

### 17. ~~SecurePodClient: no fetch timeouts on RunPod REST calls~~ — resolved
Added `_fetchWithTimeout(url, init, ms)` helper wrapping `AbortController`. Used in:
- `_provisionPod`: 30s default (`provisionTimeoutMs`). AbortError propagates — provision failure is fatal and kills the submit() call.
- `_getSshInfo`: 10s default (`sshInfoTimeoutMs`). AbortError is caught → returns `null`, so a single slow poll counts as "not ready yet" and `_waitForSsh`'s overall deadline (`sshReadyTimeoutMs`) still governs the give-up point.

Both timeout values are injectable via `SecurePodConfig` for test control. Three new tests verify: provision abort rejects `submit()`, SSH poll abort leads to FAILED webhook, and pod is terminated after SSH poll timeouts.

---

### 18. ~~SecurePodClient: COMPLETED webhook failure silently degrades to FAILED actum~~ — resolved
Added `_postWebhook(url, body)` helper with configurable retry + exponential backoff. Replaces the bare `fetchFn` call for the COMPLETED webhook POST. Retries both on thrown errors (network blip, connection refused) and non-2xx responses. After exhausting retries the error propagates as before, which fires the FAILED webhook from the outer `.catch()`.

Config knobs: `webhookRetries` (default 3) and `webhookRetryDelayMs` (base delay, doubles each attempt, default 1000ms). Both are injectable for test control.

The FAILED webhook in `submit().catch()` remains a single best-effort call — no retries needed there since the job genuinely failed.

Three new tests: retry succeeds on second attempt; FAILED fires after all retries exhausted; pod terminated even when all retries fail.

---

### 15. ~~`embed` / `embedImage` not wired~~ — service built, search API live

**Built:**
- `clip_service/` — Python FastAPI wrapping OpenCLIP ViT-B/32 (512-dim, CPU, ~50ms). Single and batch endpoints for text + image. L2-normalised vectors. Weights baked into Docker image at build time.
- `src/index.ts` — `CLIP_SERVICE_URL` → `embed` + `embedImage` wired into `createContainer`. Warns at startup when absent.
- `src/api/vestigia/vestigiaRouter.ts` — `GET /api/vestigia/search` (semantic, per promptum/imago/intella), `GET /api/vestigia` (recent history), `GET /api/vestigia/:id`. Returns 503 when CLIP service absent.
- `docker-compose.yml` / `docker-compose.prod.yml` — `clip` service on `hyperbot` network with healthcheck.

**Still open:**
- `scripts/migration/backfill-vestigia-embeddings.ts` — phase 1 (embed all prompts/intella) + phase 2 (kNN rarity scoring for regen candidates)
- Atlas `$vectorSearch` upgrade in `MongoVestigiorum.search()` (in-memory fallback fine until ~10k records)
- Atlas Search index definitions (see `docs/embed-spec.md`)

---

## ⛔ Blocked — depends on other work, do not start yet

These are designed/scaffolded but intentionally parked. They sit on top of
foundations that are not finalized; starting them now would build on shifting
ground. Listed last on purpose.

### 19. Octra (OCT) confidential funding rail + economics layer — BLOCKED

**Blocked by:** Arcanum system not finalized. The entire OCT effort ends in
`arcanumTree.insert(commitment, valor)` and reuses the Arcanum note, circuit,
tree, and spend path verbatim. Until Arcanum is locked, anything built on it can
shift underneath. Also gated on more-primary roadmap work taking priority.

**State (design + scaffold done, NOT wired, NOT running):**
- Spec: `docs/octra-blind-issuance.md` (public rail v1 + Layer 7 encrypted rail v2).
- North-star: `docs/octra-economics-layer.md` (two-axis privacy; royalties →
  blind balance → settlement Circle; dual-accounting "drain to regular" rule).
- Scaffolds (additive, gated on `OCTRA_RPC_URL`, no-op when unset): `src/types/octra.ts`,
  `src/octra/{commitment,octraPricing,OctraClient}.ts`,
  `src/crystal/{MongoOctraDeposit,OctraWatcher}.ts`, `src/api/octra/octraRouter.ts`,
  `scripts/octra-verify.ts`; `ensureIndexes.ts` has the octra indexes.
  Typechecks clean; NOT wired into `container.ts`/`index.ts` (diffs in `docs/octra-wiring.md`).

**Live-network facts already resolved (so re-discovery isn't needed when unblocked):**
- `/rpc` JSON-RPC is the live dialect; `octra_balance/account/nonce/transaction/submit`
  confirmed. `OCT_DECIMALS = 6` proven on a real account. `head_epoch` from `/status`.
  Tx codec resolved (Ed25519/NaCl, signed blob excludes `message`, `sha256(blob)`).
  Address = `oct + base58(sha256(pubkey))`. Inbound history = `octra_account.recent_txs[]`.

**Remaining work before this can ship (in order), once unblocked:**
1. Finalize Arcanum (the actual blocker).
2. Rewrite `OctraClient` against the confirmed live `/rpc` methods + implement
   `deriveDepositAddress` + Ed25519 codec + local hash recompute (port from `webcli`).
3. Wire `container.ts`/`index.ts` per `docs/octra-wiring.md`; testnet e2e.
4. **Needs from us:** a funded `oct` wallet (testnet ideal) to verify derivation +
   do a real test send. Finality is treated as legitimate (validators private),
   hedged by conservative confirm-depth + per-deposit valor circuit-breaker.

**Economics-layer follow-ons (each blocked by the one before, all after v1 rail):**
anonymous royalty pots → blind credit balance → settlement Circle. The regular
`Signum` economy is **never migrated** — the confidential economy is an opt-in
parallel lane that always drains back to the regular ledger (same `valor` unit).
