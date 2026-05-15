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

### 7. Phase 8 — Colloquium/Dictum not threaded into any flow
`Colloquium` and `Dictum` are ring-wired but `ExecuteFlow` has zero deps on them. No Dictum is created for a generation, so there is no conversation history, no thread linking generations together, no agent memory loop.

**Decision needed:** Dictum threading belongs in an agent/conversational flow, not in ExecuteFlow (which is one-shot). A future `ConversationFlow` or `AgentFlow` owns this. Not a bug in the current system — but should be scoped before Phase 8 is marked complete.

---

### 8. ~~SecurePodClient unreviewed~~ — reviewed, one bug fixed, two promoted to items 17 and 18

**Fixed — pod leak on SSH timeout:** `_waitForSsh` and `sshFactory` previously ran before the `try/finally` block, so if SSH polling timed out (pod provisioned but never ready) the pod was never terminated. Restructured: both are now inside the `try/finally`; `_terminatePod` always runs on any failure. Test added.

---

### 9. ~~TesseraCursor unreviewed~~ — reviewed, one bug fixed, two gaps documented

**Fixed — async acta tracking:** `run()` only appended `actum.id` to `modo.acta` when `result.kind === 'sync'`. Async jobs were invisible to the Modo — their IDs never landed in `acta`. Fixed: always append `actum.id` when a Modo is present; gate `impetusAccrued` update on sync only (async impetus is unknown until the webhook fires). Two tests added.

**Gap — budget enforcement absent:** `Signorum` has no `findByModoId()` method. `Modo` has no `budget` field. The tessera signum `valor` doc says "decremented on each use" but the ledger is append-only — no decrement mechanism exists. `TesseraCursor.run()` cannot check whether `impetusAccrued + cost ≤ tessera.valor` without a query path. Budget overspend is currently not caught. Fix requires either adding `findByModoId` to `Signorum` + `MemorySignorum` + `MongoSignorum`, or storing `budget` on the `Modo` record and passing it through.

**Gap — async impetusAccrued never updated at webhook time:** When a cursor returns `kind: 'async'`, the actual impetus is reported by the execution webhook. The webhook handler (`executionWebhook.ts`) calls `ActumCompletor.complete()` which settles signa — but no code path calls `modos.update({ impetusAccrued })` on webhook receipt. Sessions with async jobs will show `impetusAccrued` as permanently lower than actual spend.

**Intentional — Modo stays `'claiming'`:** `claiming → warming → active` transitions belong to the pod provisioning layer (MateriaFlow / SecurePodClient), not TesseraCursor. TesseraCursor creates the session token; a separate flow provisions the pod and advances the status.

**Files:** `src/crystal/TesseraCursor.ts`, `tests/unit/crystal/TesseraCursor.test.ts`

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

### 13. Compiler correctness
`src/crystal/Compiler.ts` converts `Modus + aditus → RunPod job payload`. The output feeds directly into ComfyUI. Unknown whether all field mappings, version pinning, and composed modus compilation are correct.

### 14. TraitMixer edge cases
Used by `CollectioCursor` for generative NFT trait selection. LCG seeding, collision avoidance, and rarity distribution are complex enough to deserve a dedicated audit.

### 16. Arcanum execution path unimplemented
`actum.nullifier` is declared on `Actum` and the three-hop crossing is documented, but no code writes it. An anima holding only arcanum signa cannot fund a modus execution — `ActumInceptor` passes `by: { arcanumHash }` correctly through balance/lock, but `actum.nullifier` is never stamped, so the spend proof is never recorded and the crossing path (`nullifier → arcanum signum → deposit → anima`) is inert.

**What's missing:** In `ActumInceptor.initiate()`, when `by` is `{ arcanumHash }` and the selected signa include an arcanum signum, the actum should be created with `nullifier` set to the arcanum's spend proof. This requires ZK proof verification logic (or a simpler hash-based proof for non-ZK mode).

**Files:** `src/execution/ActumInceptor.ts`, `src/types/actum.ts`

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
