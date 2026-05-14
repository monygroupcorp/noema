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

### 8. SecurePodClient unreviewed (299 lines)
The real pod provisioning path — provisions a RunPod SECURE pod, SSH bootstraps it, and orchestrates the full job lifecycle. Largest file in the project. We have not read it. Unknown whether it handles edge cases (provision timeout, SSH failure, partial webhook delivery).

**Files:** `src/crystal/SecurePodClient.ts`

---

### 9. TesseraCursor unreviewed
Bridges tessera (signum-gated session) to RunPod execution. Unknown whether it correctly handles session expiry mid-job, double-spend prevention, or partial execution.

**Files:** `src/crystal/TesseraCursor.ts`

---

### 10. Privacy partition enforcement unverified
The design is clear: Actum has no animaId, the crossing is three hops via nullifier. But this is documented intent, not verified enforcement. Nothing in the crystal prevents accidentally writing animaId onto an Actum or crossing the partition in a shortcut.

**Verify:** Confirm `Actum` type has no animaId field. Confirm no code path writes one. Check that Signorum queries are keyed on identity-safe constructs.

---

## 🟢 Low — known gaps, lower urgency

### 11. Discord allocutio absent
Mirrors `TelegramAllocutio` (~1 day to implement). Blocking Discord users from the crystal.

### 12. ValidateAditus coverage
`src/execution/validateAditus.ts` validates aditus against Modus schema at cast time. Unknown how complete this is — missing or extra fields, type coercion, required vs optional handling.

### 13. Compiler correctness
`src/crystal/Compiler.ts` converts `Modus + aditus → RunPod job payload`. The output feeds directly into ComfyUI. Unknown whether all field mappings, version pinning, and composed modus compilation are correct.

### 14. TraitMixer edge cases
Used by `CollectioCursor` for generative NFT trait selection. LCG seeding, collision avoidance, and rarity distribution are complex enough to deserve a dedicated audit.

### 15. `embed` / `embedImage` not wired in index.ts
`MongoVestigiorum` accepts `embed` and `embedImage` functions but they are not passed in `createContainer()`. The fire-and-forget index calls silently no-op. Intentional (models not yet baked into RunPod image) — low priority until pod image is ready.
