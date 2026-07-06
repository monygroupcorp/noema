# CSAM / content-moderation — go-live handoff (2026-07-03)

**TL;DR.** The **engineering surface is complete** (Track A A1–A4 + C1 + the human-review
confirm-and-report action), all hermetic-green, none staging/GPU-verified. What remains is
**vendor/legal (Track B)** and **integration that depends on it (C2–C6)**. The key strategic
finding of this thread: **go-live does NOT have to wait on Thorn.** A **Thorn-independent path**
— free hash layer + the validated NSFW router + human review + NCMEC reporting — is viable, and
its hard dependency is **NCMEC ESP registration**, which is more attainable than a Thorn contract.

Canonical docs: `docs/spec/moderation-classifier.md` (build spec), the private compliance
module's `corpus-read-findings.md` (model-validation numbers), this file (go-live map).

---

## 1. What's built (all hermetic-green, NOT staging/GPU-verified)

| Piece | Where | Role |
|---|---|---|
| **PromptGuard** | private `PromptGuard.ts` (port `src/crystal/PromptGuard.ts`) | input-side minor∧sexual text filter, fail-OPEN |
| **ModerationGate** (CSAM cascade) | private `CsamModerationGate.ts` (port `src/crystal/ModerationGate.ts`) | publish-boundary: hash → perceptual → router → classifier → hold; fail-CLOSED |
| **Hash layer** | private `loadCsamHashSet.ts` + `JimpPerceptualHasher.ts` | exact SHA-256 + perceptual match vs a known-CSAM set (ships empty) |
| **SexualContentRouter / OnnxNsfwRouter** (A1) | port `src/crystal/SexualContentRouter.ts`, impl private `OnnxNsfwRouter.ts` | host-side NSFW escalation signal (Falconsai). NOT a CSAM verdict (§0-A) |
| **Human review** (A2) | `Editio.reviewOutcome` + `CrystalApi` list/approve/reject + `PublicationWorker` skip | held items → a person adjudicates; approve re-publishes, reject blocks |
| **Batch triage** (A3) | `BatchTriage.ts` + `TriageStore` + `scripts/triage-corpus.ts` | offline corpus read; measure + prioritize, never publish/report |
| **Verdict cache + scan fee** (A4) | `VerdictCache.ts` + `ScanFeeCharger.ts` | identical re-publish reuses verdict; billable-gated fee forwarding |
| **ThornClassifier** (C1) | private `ThornClassifier.ts` | authoritative CSAM classifier transport; LIVE-UNVERIFIED |
| **Confirm-and-report** | port `src/crystal/CsamReviewReporter.ts`, impl private `CsamReviewReporter.ts` | reviewer confirms CSAM → reject + NCMEC report (the human-review terminal action) |
| **NCMEC report assembly** | private `deferredNcmecReporter` / `assembleCyberTipReport` | assembles + preserves a CyberTipline report; does NOT live-submit yet |

**Model validation (corpus read, 2026-07):** Falconsai = reliable high-recall router (over-flags
suggestive content, by design good for escalation); **NudeNet corroboration = the precise nudity
signal** (`Falconsai ∩ NudeNet`); CLIP zero-shot = noise, dropped; **age is unsolved by any model**
→ human/authoritative only. The production router should be **Falconsai + NudeNet corroboration**
(documented refinement to A1's `OnnxNsfwRouter`, not yet wired). Detail: private `corpus-read-findings.md`.

---

## 2. Two go-live paths

**Path A — Thorn-first (original).** Feed opens only after a Thorn contract (B1, application-gated,
slow, may not approve a small platform). Automated novel-CSAM classification at scale.

**Path B — Thorn-INDEPENDENT (recommended to de-risk).** Human review is the adjudicator; Thorn
becomes a later scale upgrade. The pipeline:

```
publish → hash-match (known CSAM, silent)         [needs a hash set — FREE sources]
        → NSFW router (Falconsai ∩ NudeNet)        [built; escalate novel sexual content]
        → HUMAN REVIEW                              [built; judges novel + AGE]
              approve → publish
              reject  → blocked (no report)
              confirm-CSAM → reject + NCMEC report  [built]
```

Why Path B works: a human is *better* than any model at the one thing that defines CSAM — **age**
— and a human confirmation is "actual knowledge" (18 U.S.C. §2258A), which is exactly what a valid
NCMEC report needs. The free hash layer keeps *known* material off reviewers' eyes (welfare + legal).

**Both paths still require NCMEC ESP registration + counsel.** Path B just removes Thorn from the
critical path.

---

## 3. What flips what (the seams / env vars)

| Capability | Enabled by | Needs (Track B) | Status |
|---|---|---|---|
| Hash-match layer | `CSAM_HASHSET_PATH` → `loadCsamHashSet` | a hash set (**B3/B5**: PhotoDNA / Google / NCMEC-sharing — free) | code done (C3 = wire the file) |
| NSFW router | `NSFW_MODEL_PATH` (+ `NSFW_THRESHOLD`, `NSFW_MODEL_SOURCE`) | Falconsai weights → R2 mirror; onnxruntime-node builds on Node 20 | code done; weights + build **unverified** |
| Router precision (NudeNet corroboration) | — | wire NudeNet as a 2nd stage in `OnnxNsfwRouter` | **not built** (validated, documented refinement) |
| Thorn classifier | `THORN_API_KEY` (+ `THORN_ENDPOINT`, `THORN_THRESHOLD`) | Thorn contract (**B1**) — OPTIONAL under Path B | code done (C1); API shape **unverified** (C2) |
| NCMEC reporting (assemble+preserve) | `NCMEC_ESP_NAME` / `NCMEC_ESP_ID` | — | done (deferred; `submitted:false`) |
| NCMEC **live submission** | replace `deferredNcmecReporter`'s no-submit with a real CyberTipline transport | **B2** ESP registration + **B4** counsel | **not built** (C4) |
| Gate active (else fail-closed deny) | any detection configured above | — | done; `MODERATION_ALLOW_UNSCANNED=1` is the dev-only opt-in |

Default with nothing configured: the public feed is **fail-closed DENY** (safe). That is the
current production posture until the above land.

---

## 4. Dashboard surface (backend ready; UI to build)

Admin/reviewer endpoints (all platform-admin-scoped except the author-read on the queue):

- `GET  /v1/editiones/review` — the review queue (author sees own held; admin sees all)
- `POST /v1/editiones/:id/approve` — clear the hold → re-settles + publishes
- `POST /v1/editiones/:id/reject` — decline → terminal `rejected` (files **no** report)
- `POST /v1/editiones/:id/confirm-csam` — confirm CSAM → reject **+ file NCMEC report**

`confirm-csam` today assembles + preserves the report (`submitted:false`); it goes live once
C4 (real transport) + B2 (ESP account) land. The dashboard should surface: the held queue, the
media, the four actions, and the report/preservation state.

---

## 5. Remaining blockers (mapped B → C)

**Track B (vendor/legal — not code; START NOW):**
- **B2 — NCMEC ESP registration.** The one HARD dependency of Path B. Flips report preservation
  into live CyberTipline submission. No real reports can be filed without it.
- **B3/B5 — Provision a CSAM hash set.** FREE sources (PhotoDNA, Google CSAI/Content-Safety,
  NCMEC hash-sharing). Feeds the built hash layer via `CSAM_HASHSET_PATH`.
- **B4 — Counsel sign-off.** Mandatory-reporting duties, reviewer-viewing/preservation procedures,
  AI-generated-CSAM posture, and the go/no-go on **"open the feed pre-Thorn on hash+router+review."**
- **B1 — Thorn contract.** OPTIONAL under Path B (scale upgrade). Still worth starting (slow).

**Track C (integration — needs B + a staging deploy):**
- **C2** — live-test `ThornClassifier` with Thorn's benign fixtures (needs B1). Path B skips.
- **C3** — wire the hash set at deploy (needs B3). Trivial once the file exists.
- **C4** — build + wire the **live NCMEC CyberTipline transport** (needs B2 + B4). The last
  code piece for real reporting.
- **C5** — staging/GPU verification of the WHOLE stack (gate, router, review, confirm-report).
  **Nothing is verified beyond hermetic tests.**
- **C6** — open the public feed. Path B: after B2 + B3 + B4 + C3 + C4 + C5. Path A: also B1 + C2.

---

## 6. Honest status caveats

- **Nothing is staging/GPU/live-verified** — all green is hermetic (fakes) only. C5 is real.
- **Falconsai weights + onnxruntime-node on Node 20** — not acquired / not build-verified.
- **NudeNet corroboration** (the validated precision refinement) is **not wired** into the router.
- **ThornClassifier's API shape** is a best guess — unconfirmed against Thorn's real contract.
- **NCMEC live submission is unbuilt** — reports are assembled + preserved, not sent. **B2 is the
  gating dependency for any real reporting, on either path.**
- The **age** dimension is not solved by code — it is a human-review responsibility. Nudity ≠ CSAM.

---

## 7. Recommended next actions

1. **Start B2 (NCMEC ESP registration) + B3 (PhotoDNA/Google hash-set applications) now** — these
   are the real critical path and are free/attainable.
2. **Get B4 counsel answer** on opening pre-Thorn on hash+router+review (Path B go/no-go).
3. **Build the dashboard** against the four endpoints in §4 (backend is ready).
4. When B2 lands → **C4** (live NCMEC transport) is the final reporting code.
5. Optionally wire **NudeNet corroboration** into `OnnxNsfwRouter` for a precision-graded signal.
6. **C5 staging verification** before C6 (open feed).
