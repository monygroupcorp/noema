# CSAM detection — vendor research & recommendation

**Purpose:** choose the detection provider(s) that plug into the two seams already built —
the input `PromptGuard` (generation boundary) and the output `CsamClassifier` (publish
boundary, inside the private `ModerationGate`) — plus NCMEC reporting.

**Status:** decision-support. Capabilities are accurate as of the assistant's knowledge
cutoff; **pricing and exact API shapes must be confirmed directly with each vendor** before
committing (they change, and access is application-gated).

> Bottom line: for a **generative** platform the requirement is **novel-content detection**
> (a classifier), not just hash-matching. That points at **Thorn (Safer / Safer Predict)** as
> the primary provider — purpose-built for CSAM, covers image + video + **text/prompts**, is
> aligned with NCMEC reporting, and leads the "Safety by Design for Generative AI" work.
> Layer the **free hash-matching baselines** (PhotoDNA, Google CSAI) underneath, and register
> with **NCMEC** for the CyberTipline reporting obligation.

---

## Answering the three questions first

**1. Can we roll our own classifier? — No.** Training a CSAM classifier requires CSAM to
train on, and possessing that material is a felony. There is no legal path to the training
data for a private company. (The only legal composition is *age-estimation* × *NSFW* models —
both trainable on legal data — but it's inaccurate near the 18 boundary and gives you **no**
NCMEC hash-sharing and **no** legal safe harbor. Backstop only.)

**2. Is there an open-source classifier?**
- **NSFW / nudity:** yes (NSFW.js, Falconsai, GantMan, LAION CLIP-based) — detects *adult*
  sexual content; useful as the "is this sexual" signal, **not** CSAM.
- **Age estimation:** yes, but poor near 18.
- **CSAM specifically:** **no, deliberately.** Thorn/Google/Microsoft models are access-
  controlled and never open-weighted, on purpose (next point).

**3. "Isn't a classifier a loaded weapon — can it be reversed into a generator?"** — A correct
and well-known concern. A classifier provides a **gradient** ("what would raise this score"),
which paired with a diffusion model becomes **classifier guidance** — steering a generator
toward what it detects. This is exactly why CSAM classifiers are **never open-weighted** and
are served **behind APIs that return a score, not weights or gradients**. The API boundary is
the safety mechanism. → **Decision: hosted, score-only API. Never self-host open weights for
anything CSAM-adjacent.**

**Privacy note (important for our TEE model):** the output classifier only ever sees content
that is *already headed to a public surface* (the feed/marketplace). Scanning public-bound
content is not a privacy violation — it's going public anyway. The **private** generation path
(TEE) is deliberately **not** scanned; the gate fires only at the trust boundary. So using a
third-party classifier API at the publish boundary is fully compatible with "we don't see your
private content." The prompt guard runs **locally** (no third party) at generation time.

---

## Vendor comparison

| Vendor / product | Known-hash match | **Novel classifier (image)** | Video | **Prompt / text** | NCMEC reporting | Access / cost | Delivery |
|---|---|---|---|---|---|---|---|
| **Thorn — Safer / Safer Predict** | ✅ (their DB + industry hashes) | ✅ **strong, its purpose** | ✅ | ✅ (Safer Predict text; sextortion/solicitation) | ✅ integrated workflows | Application-gated; contract (nonprofit — often reachable for smaller platforms) | **API** (score-only) + self-host options |
| **Hive AI** | ✅ | ✅ (broad visual moderation incl. CSAM) | ✅ | Partial (text moderation) | Via workflow | Commercial, pay-per-call | **API** (score-only) |
| **Google — Content Safety API + CSAI Match** | ✅ CSAI (video hash) | ✅ Content Safety API (prioritization classifier) | ✅ | ❌ | Aligned | Application-gated; **free** to qualifying orgs | API |
| **Microsoft — PhotoDNA / PhotoDNA for Video** | ✅ (known image/video) | ❌ **hash-only** | ✅ (hash) | ❌ | — | **Free** cloud service | API |
| **Cloudflare CSAM Scanning Tool** | ✅ (fuzzy hash vs NCMEC lists) | ❌ | — | ❌ | Assists | Free **if on Cloudflare** | Edge |

**Reading it:** PhotoDNA/Google/Cloudflare are **hash-only** → they catch *re-uploads of known*
material for free, but are **blind to fresh generated content**. Only **Thorn** and **Hive**
bring a **novel-content classifier**, and only **Thorn** also covers **prompt text** and is
purpose-built + reporting-integrated.

---

## Recommended stack

1. **Now, free, layer immediately** — **Microsoft PhotoDNA** (known-image hash) + **Google
   CSAI** (video hash) behind the `CsamClassifier` seam. Zero cost, catches known re-uploads.
   *Insufficient alone* for generated content — they don't see novel material.
2. **Primary (contract) — Thorn Safer + Safer Predict:**
   - **Output classifier** (novel image/video CSAM) → the `CsamClassifier` seam at the publish gate.
   - **Prompt-text classifier** → upgrades the `PromptGuard` from lexicon+rules to ML-backed,
     and can supply the out-of-band code-word lexicon (`CSAM_PROMPT_LEXICON_PATH`).
   - Best mission alignment ("protection of innocence"), generative-AI focus, NCMEC-integrated.
3. **Alternative to (2)** — **Hive AI** if you'd rather one commercial vendor across all
   moderation categories (also covers general NSFW/violence you may want later).
4. **Reporting — register as an NCMEC ESP.** Required for the CyberTipline submission
   (`deferredNcmecReporter` assembles the report today; ESP registration + legal sign-off
   turns on live submission). Thorn's tooling assists the reporting workflow.

**Do not** self-host an open classifier for CSAM (gradient/inversion risk, §"loaded weapon").

---

## What's already wired, waiting on the vendor decision

- `CsamClassifier` interface (`src/private/compliance/CsamModerationGate.ts`) — the output
  classifier seam. Picking a vendor = writing one HTTP transport behind it (a few hours), then
  a live test. Score-only, so no inversion exposure.
- `PromptGuard` (`src/private/compliance/PromptGuard.ts`) — running now with built-in rules;
  point `CSAM_PROMPT_LEXICON_PATH` at a vendor/industry lexicon to sharpen, or swap in a text
  classifier transport.
- Known-CSAM hash set loader (`CSAM_HASHSET_PATH`) — point it at PhotoDNA/NCMEC-shared hashes.
- NCMEC report assembly — done; needs ESP registration to submit live.

## Next actions (business/legal, not code)

1. Apply to **Thorn** (Safer) and, in parallel, **Microsoft PhotoDNA** + **Google** (free hash
   baselines) — access is application-gated; start now, they take time.
2. Begin **NCMEC ESP registration**.
3. Counsel touch-point: mandatory-reporting obligations, data-handling for flagged material
   (preservation), and the AI-generated-CSAM legal posture (it is CSAM under U.S. law).
4. Once a provider is selected, I wire its transport behind the existing seam + live-test.
