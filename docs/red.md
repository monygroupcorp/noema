# Red — Critical Gaps in the Crystal

Working document. Items are removed when resolved, not marked done.
Last updated: 2026-05-13

---

## 🔴 Silent bugs — look done, aren't

_(none outstanding)_

---

## 🟠 High — real gaps, not yet causing visible failures

### 4. ~~Expired actum recovery~~ — resolved
`findExpired()` was implemented but only queried `nascens` (missed `agens`), and was never called. Fixed: queries both statuses, boot sweep in `index.ts` now runs on startup.

---

### 5. Ledger hook math unaudited
Six hooks (`hostCut`, `spellRoyalty`, `modelRoyalty`, `platformSkim`, `sessionSpend`, `referralSplit`) were wired and are now live. Their implementations in `src/ledger/hooks/` have never been read in this session. The percentages, conditions, and edge cases (missing auctor, zero royalty, self-referral) are unknown.

**Verify:** Read all six. Check: do royalty percentages sum correctly? Does platformSkim fire on zero-royalty executions? Does referralSplit handle the case where referrer === payer?

**Files:** `src/ledger/hooks/*.ts`

---

### 6. CollectioCursor.onActumCompleta not called for collection acta
`CollectioCursor.rehydrate()` now reconstructs state on boot. But `onActumCompleta()` must be called when each actum from a collection finishes — who calls it? The webhook handler calls `flowRouter.handleActumComplete()` but there is no bridge from `FlowRouter` to `CollectioCursor.onActumCompleta()`. Collection acta that complete after a restart are silently dropped; the collection never marks completa.

**Verify:** Trace the path from `handleExecutionWebhook` → `flowRouter.handleActumComplete` → `CollectioCursor`. If the bridge is missing, wire it.

**Files:** `src/api/webhooks/executionWebhook.ts`, `src/flow/FlowRouter.ts`, `src/crystal/CollectioCursor.ts`

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
