# Moderation classifier — spec

**Status:** design, not built. Companion to the built pieces: the input `PromptGuard`
(`src/crystal/PromptGuard.ts` port + private matcher), and the publish-boundary `ModerationGate`
+ `CsamClassifier` seam (private module, ADR-0012 §49). This spec is the build doc for a
fresh context — it covers every surface the implementation touches.

**Scope:** image/video classification on the publish path — a **self-hosted, open-source
NSFW/age model** (router + triage, no vendor) and the **Thorn API** (the single, authoritative
CSAM classifier, required before go-live). Plus the human-review, batch-triage, hosting, cost,
and testing surfaces.

---

## 0. TWO facts that drive the whole design (read first)

**(A) NSFW ≠ CSAM. A router is not a classifier.** An NSFW model detects *sexual* content —
which for adults is **allowed**. A CSAM classifier decides *CSAM*, whose verdict triggers
**reject + NCMEC CyberTipline report**. If you wire a bare NSFW model into the `CsamClassifier`
seam, every adult nude becomes `match:true` → auto-rejected **and a false NCMEC report is
filed**. Filing false reports is harmful and unlawful. **Therefore the host-side NSFW model is a
`SexualContentRouter`, a distinct interface from `CsamClassifier`.** The router only decides
"does this need the authoritative CSAM check / human review?" — it never produces a CSAM verdict.

**(B) The live gate is synchronous; the GPU batch is offline.** The gate's `scan()` runs
**synchronously inside `settle()` inside the `PublicationWorker`** (already off the request
path). A fast host-side classifier fits there with **zero worker changes**. A GPU-batch job
(minutes, cold-start) **cannot** run inside `scan()`. So the batch modus is an **offline triage
tool over the stored Actum corpus**, decoupled from the live publish gate — NOT a stage in the
live settle. (Using batch for live overflow would need a two-phase settle: `scan` defers →
verdict store → re-settle. That is explicitly **out of scope for v1**; call it out if ever
needed.)

---

## 1. The layered model

| Layer | Boundary | Interface | Role | Status |
|---|---|---|---|---|
| Prompt guard | generation (input) | `PromptGuard` | text minor∧sexual, fail-open, local | ✅ built |
| **Sexual-content router** | publish (output) | **`SexualContentRouter`** (new) | host-side open NSFW model → "escalate?" | 🟡 this spec |
| **CSAM classifier** | publish (output) | `CsamClassifier` (built seam) | **Thorn** — authoritative CSAM verdict + NCMEC | 🟡 seam ready, needs contract |
| Human review | publish (output) | review queue (new) | a person adjudicates escalated/uncertain items | 🟡 this spec |
| Offline batch triage | corpus / backlog | GPU-batch `Modus` | bulk NSFW read over stored Actum corpus | 🟡 this spec |

Roles are fixed: router = cheap, no-vendor, high-recall **escalation signal**; Thorn = the
**only** CSAM classifier and the **authoritative** gate (go-live requirement + NCMEC); human
review = the adjudicator for escalated items (and the interim decision-maker **before** Thorn).

---

## 2. Decision flow (the cascade)

Inside `ModerationGate.scan()` (private module), per media item, in order:

```
1. exact SHA-256 hash-match  → hit? → REJECT + NCMEC report        (built)
2. perceptual hash near-match → hit? → REJECT + NCMEC report        (built)
3. SexualContentRouter.route(bytes) → sexual?                        (NEW, host-side)
      no  → PASS  (high-recall router: not-sexual ⇒ not-CSAM)
      yes → 4
4. CsamClassifier.classify(bytes)  [Thorn]                           (seam; needs contract)
      match  → REJECT + NCMEC report
      clear  → PASS
   —— if NO CsamClassifier is configured (pre-Thorn) ——
      → HOLD for human review (NOT auto-reject, NOT auto-report)
```

**Safety invariants (unchanged):** internal tools may only ADD rejections or ESCALATE — never
sole-approve public image content. Hash/router "pass" ≠ clean for novel content. The gate stays
**fail-closed** at publish (unverifiable item ⇒ refuse). The router is tuned **high-recall**
(over-escalate "sexual") — a router miss is the one gap, mitigated by (a) Thorn as the real
decision and (b) periodic batch-triage sampling of the "passed" population to measure miss rate.

---

## 3. `SexualContentRouter` — the host-side open model

### 3a. Interface (private module, alongside `CsamClassifier`)
```ts
export interface SexualContentRouter {
  /** Cheap, high-recall "is this sexual → escalate to the CSAM check / review?" */
  route(item: { bytes: Buffer; url: string; contentType: string }): Promise<{
    sexual: boolean
    confidence?: number     // provider score in [0,1]
    ageSignal?: 'minor' | 'adult' | 'unknown'   // best-effort; face-only; booster not gate
    source: string
  }>
}
```
Returns `sexual` (the escalation decision, from the NSFW score vs a **private, tunable
threshold**), plus a best-effort `ageSignal` (raises severity when a face is present; NEVER
gates). It does **not** return a CSAM verdict.

### 3b. Model (open source, permissive license — ADR-0012 discipline)
We serve+bill on this (catalog-tier), so pick a **clean permissive** license.
- **NSFW router (recall):** `Falconsai/nsfw_image_detection` — ViT binary NSFW, **Apache-2.0**,
  small, ONNX-exportable. Clean license, simple score.
- **Nudity corroborator (precision):** `NudeNet` (`notAI-tech/NudeNet`) — ONNX-native, per-region
  exposed-nudity detection. **Verify its license** before adopting.
- **Age (defer to v2):** face-detect (RetinaFace/SCRFD ONNX) + age head (e.g. MiVOLO — **verify
  license; several are non-commercial**). Face-centric ⇒ unreliable on generated/no-face content.
  Ships as `ageSignal`, booster only. **Recommend: omit from v1.**

**Empirically validated (163k-corpus read, 2026-07 — the go-to flow):** the two models are
COMPLEMENTARY, not alternatives. Falconsai is **high-recall / loose-precision** — it catches
essentially all sexual content but over-flags suggestive-but-clothed images (its training defines
"NSFW" broadly), and this is *confident* over-flagging, so raising its threshold does NOT recover
precision. NudeNet is **precise but narrow** — it fires only on visibly exposed regions (≈ actual
nudity). Run over the corpus, the two purpose-built models corroborate each other where it counts,
while the old CLIP zero-shot tagging correlated with neither (≈ noise) — do not use CLIP.
- **The nudity-grade signal = Falconsai ∩ NudeNet** (NudeNet-corroborated). This is the tight,
  high-accuracy set — use it wherever a *precise* nudity flag is wanted.
- **The escalation signal = Falconsai alone** (over-inclusive by design). A router false positive
  costs a human review, not a wrong auto-action (§0-A) — so high recall is the correct property
  for the router slot; the corroborator raises precision on the escalated set.
- Neither model addresses **age** (adult vs minor) — that stays the authoritative-classifier +
  human layer. This is why *nudity* detection and *CSAM* detection are different problems.
- The corpus numbers, the score distributions, the ensemble thresholds, and the folder taxonomy
  are **PRIVATE** (§49 — cascade routing logic + tuning): see the private compliance module's
  the corpus read-through findings.

### 3c. Execution (host-side, in-process, synchronous)
Mirror the existing host-side runtimes (`JimpLayerCompositeEngine`, ffmpeg cursors):
- **Runtime:** `onnxruntime-node` (new dep; prebuilt binaries). NOT `@tensorflow/tfjs-node`.
- **Lazy-load** the native module (`await import('onnxruntime-node')`) so a failed binary install
  on the Node 20 Linux image degrades to the fail-closed stub, never crashes boot.
- **Persistent worker thread:** run inference in a `worker_thread` with the **model resident**
  (loaded once, reused) — loading weights per call is the expensive part. A single warm worker (or
  a tiny pool) serves the publish trickle without blocking the main event loop (which also serves
  the bot/API/webhooks/ledger). This is the one hard engineering requirement.
- **Video:** decode + sample N frames (ffmpeg, already available), route each; `sexual` = any
  frame sexual. Images: route directly.
- **Throughput:** ~tens of ms/image on CPU — ample for per-publish volume.

### 3d. Model-weight hosting
Small (a few MB). Acquire from HuggingFace once, then **mirror to R2** (reuse `R2Uploader`) and
load from there at boot (don't hot-depend on HF at runtime) — or bake into the deploy image. The
GPU-batch modus (below) gets the same weights baked into its pod image. Pin the model version.

---

## 4. Human-review surface (new — required)

Escalated items need a person. Two triggers: (a) **pre-Thorn**, every router-`sexual` item HOLDS
for review (the interim decision-maker); (b) **post-Thorn**, borderline/low-confidence Thorn
results can HOLD (policy choice). Reuse the **`CollectioCursor.reviewOutcome`** precedent
(`'pending' | approved | rejected` on an artifact) rather than inventing a parallel system.

- **State:** add a `held` outcome path. Options: a new `EditioStatus:'held'` (touches
  `EditioStatus` + `Editionum.update`'s allowed patch keys + the feed query which already filters
  to `published`), **or** a `reviewOutcome` field on the Editio (mirrors Collectio) leaving status
  `pending`. **Recommend a `reviewOutcome`** field — smaller blast radius, matches the precedent.
- **Queue + API:** a `GET`/adjudicate surface (list held Editiones, approve→continue-settle,
  reject→`rejected`). Author/admin-scoped. The `PublicationWorker` skips `held` items until
  adjudicated (approve re-enqueues the settle).
- **Never auto-report from a hold.** A human confirming CSAM triggers the report via the existing
  `deferredNcmecReporter`; the router/NSFW model never files reports.

---

## 5. Offline batch triage (the "get a read" use)

A GPU-batch `Modus` running the **same NSFW model** over the stored **Actum corpus** (the
~163k-gen corpus-space dataset) and any accumulated backlog — **decoupled from the live gate**.

- **Definition:** a `Modus` + `Fundamentum` (`runtime` per ADR-0007; a small pod image with the
  ONNX model). Dispatched over the runner + provisioner; the **idle reaper** tears the pod down
  when the batch drains.
- **Input:** a list of Actum media URLs (from the corpus / a backlog query). **Output:** scores
  written to a **triage store** (not the live Editio path) → feeds the human-review queue.
- **Nothing is published or reported from a triage run without human review.** It's a
  measurement + prioritization tool: how much flagged material exists, router false-positive rate
  on real content, review prioritization.
- **NOT the live path.** Live publishing uses the synchronous host-side router (§3c). Batch-for-
  live-overflow (two-phase settle) is explicitly deferred.

---

## 6. `CsamClassifier` transport — Thorn (the authoritative gate)

- A `ThornClassifier implements CsamClassifier` HTTP transport (score-only API) in the private
  module, LIVE-UNVERIFIED until credentials (like `HfHttpTransport`). Wired by
  `configureModerationGate` when `THORN_API_KEY` is present.
- Thorn is the **only** CSAM-classification vendor (no Hive/Google alternatives).
- On `match` → REJECT + `deferredNcmecReporter` (report assembly built; live submission needs the
  ESP registration).
- **Go-live gate:** the feed does not open to real traffic without Thorn + NCMEC ESP registration.

---

## 7. Cost & fee forwarding

| Layer | Cost |
|---|---|
| Prompt guard | $0 (local) |
| Host-side router (in-process CPU, worker) | ~$0 |
| GPU-batch triage | rented pod, amortized, reaper-torn-down |
| Thorn (per public publish) | per-scan — **forwarded to user** as a publish fee (config amount until Thorn quotes) |

- Thorn fires only on **public** publishes, and only on router-`sexual` items → paid volume is a
  small fraction of gens.
- **Per-publish scan fee:** hook into the existing fee machinery (`platformSkim` / the publication
  worker). Amount is a config knob until Thorn quotes. Owner approved forwarding it.
- **Verdict cache:** content-addressed (reuse the SHA-256 the gate already computes) → identical
  re-publishes reuse the verdict, not re-charged / re-scanned. Small store keyed by digest.

---

## 8. Testing (never touch real CSAM)

- **Router + gate:** unit-test with fake `SexualContentRouter`/`CsamClassifier` (already the
  pattern) — assert cascade order, escalation, hold-pre-Thorn, fail-closed. No model needed.
- **The ONNX model:** test on **benign** images (a nude-art sample vs a landscape) to confirm the
  router *escalates sexual / passes non-sexual* and measure its threshold — this is adult-content
  testing, fully legal.
- **CSAM path (Thorn):** live-test with the **vendor's benign test fixtures** (EICAR-style — a
  harmless image the vendor pre-registers as a test-positive). Confirm the pipeline escalates →
  Thorn returns positive → gate rejects → report assembles. **Never generate or possess CSAM.**
  Model accuracy on real material is Thorn's responsibility, validated under their legal authority.
- **Prompt guard:** already tested with synthetic strings (legal — text isn't CSAM).

---

## 9. Privacy (TEE) alignment

The router + classifier only see content **already headed to a public surface** — scanning
public-bound content is not a privacy violation. **Private/unlisted/TEE generations are never
scanned** (the gate fires only at the public trust boundary). The router runs **locally**; only
router-`sexual` public items are sent to Thorn.

---

## 10. Component build list

**New — private module (`src/private/compliance`, §49):**
- `SexualContentRouter` interface + `OnnxNsfwRouter` impl (lazy `onnxruntime-node`, persistent
  worker_thread, high-recall threshold, optional `ageSignal`).
- `ThornClassifier implements CsamClassifier` (HTTP, score-only, LIVE-UNVERIFIED).
- Extend `configureModerationGate` to wire router + classifier + the cascade + hold-pre-Thorn.
- The score→decision thresholds + routing logic (private).

**New — public / crystal:**
- Cascade wiring in `ModerationGate.scan()` (insert router step 3 before classifier step 4).
- Human-review surface: `reviewOutcome` on Editio (+ `Editionum` support), review queue + API,
  `PublicationWorker` skips `held`.
- Verdict cache (content-addressed store) + per-publish scan-fee hook (`platformSkim`).
- Offline triage: a moderation `Modus`/`Fundamentum` + a triage store + a corpus/backlog dispatcher.
- Add `onnxruntime-node` dep; **verify it builds on the Node 20 staging/prod image**.

**Reused:** `CsamClassifier` seam, `ModerationGate`, `PublicationWorker` (store-is-queue), RunPod
runner + provisioner + idle reaper, `R2Uploader`, ffmpeg (video frames), `CollectioCursor`
reviewOutcome precedent, `deferredNcmecReporter`, the fee hooks.

## 11. Build order

1. **Now (no vendor):** `SexualContentRouter` + `OnnxNsfwRouter` host-side (worker_thread) behind
   the cascade; unit tests; benign-image threshold test.
2. **Now:** human-review `reviewOutcome` + queue/API + worker skip → the pre-Thorn decision path.
3. **Now:** offline triage modus + triage store → run the ~163k corpus read.
4. **Now:** per-publish scan-fee hook + verdict cache.
5. **Before go-live (contract):** `ThornClassifier` transport + NCMEC ESP registration; cascade
   router → Thorn; live-test with benign vendor fixtures.

## 12. Open decisions

- NSFW model: **Falconsai (Apache-2.0)** vs **NudeNet (granular; confirm license)**.
- Age in v1? — recommend **defer** (face-only, weak on generated).
- Human-review state: **`reviewOutcome` field** (recommended) vs new `EditioStatus:'held'`.
- Confirm `onnxruntime-node` installs on the Node 20 image (else consider a sidecar inference
  process / the GPU-batch path only).
- Worker: single warm worker vs small pool (by publish volume).

## 13. What stays private (ADR-0012 §49)

Model *choice* + this architecture are public (the ports already are). PRIVATE: the router
threshold + tuning, the cascade routing logic, any code-word lexicon, the CSAM hash set, and the
Thorn transport — all in `src/private/compliance`, injected at deploy.

## 14. What building this does NOT close (non-code go-live blockers)

Completing this spec closes the **engineering** surface for input+output classification, review,
and triage. It does **not** close the thread's real go-live gates, which are **business/legal**:
1. **Thorn contract** (application-gated, slow — start now).
2. **NCMEC ESP registration** → turns on live CyberTipline submission.
3. **Provisioning the CSAM hash set** out-of-band (for the built hash-match layer).
4. **Counsel sign-off** — mandatory-reporting obligations, flagged-material preservation/handling,
   AI-generated-CSAM posture, and whether the feed may open pre-Thorn on router+review alone.
Until those land, the gate stays **fail-closed** and the public feed stays off — which is safe.
