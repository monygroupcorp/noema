# Compliance Landscape

**Date:** 2026-06-11
**Status:** Living reference. Update as statutes change and as we add models/rails.
**Disclaimer:** This is an engineering/operations reference, **not legal advice**. Every
structural decision below must be reviewed by qualified counsel (a crypto/MSB attorney and a
trust-and-safety/child-safety advisor) before we rely on it.

---

## Core principle: privacy ≠ lawlessness

We refuse to *know who* performs lawful work. We do **not** facilitate specific crimes
(CSAM, NCII of real people, sanctioned actors). Both are achievable simultaneously by
scanning at the **publish boundary** — hashes and classifiers — rather than surveilling user
identity. This is how legitimate privacy tech operates and it is the posture that lets us exist.

Our delivered posture is data minimization (no retention of prompt/output content), anonymous
rails (ZK spend proofs), and single-tenant WireGuard-tunneled pods. The **confidential-compute
TEE tier** (hardware-sealed, browser-attested, provider-out-of-trust-boundary) is **in
development and not yet delivered** — do not predicate the compliance strategy on it as if it
shipped. Today the "Full Case" is network-isolated, not cryptographically blind; the compute
provider is still inside the trust boundary. The "Simple Case" (Telegram bot as trusted client)
sees content because the user elected to skip the privacy machinery. Compliance controls must
work in **both** cases and must not assume the TEE tier exists yet.

---

## 1. Child safety — non-negotiable, existential

Crossing this line ends the business and creates personal criminal liability, regardless of
revenue.

- **18 U.S.C. § 2258A** — electronic service providers **must** report apparent CSAM to
  **NCMEC's CyberTipline** upon actual knowledge, and must preserve evidence. There is **no
  general duty to proactively monitor** (§2258A(f)), but once we *know*, reporting and
  preservation are mandatory; knowingly generating/hosting is a felony.
- **AI-generated CSAM is illegal** (obscenity law + PROTECT Act cover virtual/CG CSAM). An
  image generator is the obvious abuse vector — we will be held to a high standard.
- **TAKE IT DOWN Act** (federal, 2025) — criminalizes non-consensual intimate imagery
  *including AI deepfakes*; 48-hour takedown mandate, FTC-enforced.
- **REPORT Act** (2024) — expanded provider reporting + retention duties.
- **Bodies:** NCMEC (CyberTipline + clearinghouse), DOJ, FBI, ICAC task forces; IWF (UK),
  EU equivalents internationally.

**Required controls (privacy-preserving):**
- Input + output **hash-matching** against known-CSAM hash sets (PhotoDNA / NCMEC lists).
- Prompt + output **classifiers** at the model boundary.
- **Capability refusals** for prohibited generation classes.
- A **NCMEC reporting + evidence-preservation pipeline** for actual-knowledge cases.
- All of the above run at the trust boundary (incl. inside the enclave) — no persistent
  surveillance of lawful users required.

## 2. Non-consensual / deepfake imagery of real people

- TAKE IT DOWN Act (above) + a thick layer of **state deepfake laws** (porn + election).
- **EU DSA** takedown obligations if serving EU users.
- **Controls:** output classifiers + a documented takedown pipeline (target ≤48h).

## 3. Money transmission & crypto rails — biggest *licensing* exposure

This is where anonymity collides hardest with law. Structure determines exposure.

- **Danger:** holding, converting, or moving value *between parties* may make us a **Money
  Services Business** under FinCEN (federal registration + AML/KYC program + SARs) and
  require **state Money Transmitter Licenses** (up to 49 states; they require identifying
  customers — incompatible with our principles).
- **Safe harbor (build around this):** we are **the merchant selling our own compute** and
  credits are **closed-loop** — spendable only on our platform, non-transferable,
  non-cashable. That resembles single-merchant prepaid access, generally **outside**
  money-transmitter rules. Selling our own service ≠ transmitting money.
- **Lines that flip us into MSB territory — defer these:**
  - **Pod-owner marketplace** — paying third-party suppliers moves money between users.
  - **Transferable / cash-out token.**
- **Securities risk:** a capacity-claim token with expected profit triggers *Howey* → SEC.
  Avoid the Venice-style stake-for-capacity token. A pure consumption credit is far safer.
- **OFAC sanctions:** even anonymous, screen **deposit addresses** against sanctioned
  lists. This is the one identity-adjacent check we keep, at the deposit boundary.
- **FATF Travel Rule** applies if we are ever classified as a VASP.

## 4. AI-specific regulation

- **EU AI Act** — GPAI obligations live since Aug 2025, phasing through 2026–27. Generative
  AI **transparency**: label AI/synthetic content, deepfake disclosure. In scope if serving
  EU users.
- **US:** patchwork — state deepfake/context laws; no comprehensive federal AI statute as of
  this writing. Re-verify.
- **Provenance:** C2PA / watermarking is becoming an expectation.

## 5. Adult content (if "uncensored" includes it)

- **18 U.S.C. § 2257** record-keeping (age verification of real performers). Gray for
  purely AI-generated with no real person, but **obscenity law still applies**.
- **State age-verification laws** (2024–25 wave) for adult content.
- **Practical killer:** infra/payment providers' AUPs are stricter than law and will
  deplatform faster than any regulator (RunPod, fiat processors, etc.).

## 6. Data protection — where the principle becomes an advantage

- GDPR / CCPA exposure scales with personal data held. We hold almost none by design
  (no content retention, anonymous rails) → unusually **small** compliance surface. (The TEE
  tier would further reduce it, but it is in development — do not count it yet.)
- Document "we don't retain content" as a formal posture — it's a selling point to enterprise
  privacy buyers (medical/legal), not just a principle.
- **Healthcare:** serving PHI makes us a HIPAA **Business Associate** → sign **BAAs**. No-retention
  is today's technical safeguard (the sealed TEE tier is pending); the BAA is the legal
  instrument we cannot skip.
- **Legal vertical:** confidentiality / privilege expectations — the no-retention posture maps
  reasonably, but contracts must reflect it and must not promise the undelivered sealed tier.

---

## 7. Model licensing — who is liable?

**Liability tracks who the commercial *deployer* is, decided by substance, not by T&C.** We
cannot contract away an IP obligation we materially profit from.

- **Catalog / SaaS posture** (we offer a model as selectable + charge per gen): **we are the
  commercial user; we must clear the license.** A "user is responsible" clause is
  unenforceable when the user never chose or supplied the model.
- **BYO / bare-IaaS posture** (user uploads their own weights, we never curate/provide):
  **the user is the licensee**; T&C must make them represent they hold the rights. Willful
  blindness is not a shield (contributory infringement).

**Flow-down obligation:** several open licenses (OpenRAIL-M family, Llama community license)
carry **use-based restrictions we are contractually required to pass *down* to users.** Our
T&C must bind users to those restrictions — not optional boilerplate.

**Enterprise/medical vertical:** prefer **Apache/MIT** models outright. Zero ambiguity, and
avoids RAIL "behavioral use" clauses that could conflict with confidential workloads.

### Model license register

Maintain per model. Commercial-catalog use requires a ✅ in "Commercial OK" or a held
commercial license.

| Model | Variant | License | Commercial catalog OK? | Notes / restrictions |
|---|---|---|---|---|
| FLUX.1 | schnell | Apache 2.0 | ✅ | Fully clear |
| FLUX.1 | dev | BFL Non-Commercial | ❌ unless licensed | Needs BFL commercial/self-hosting license |
| FLUX.1 | pro / 1.1 pro | Closed | ❌ | API-only, not self-hostable |
| Stable Diffusion | 1.5 / SDXL | CreativeML OpenRAIL-M | ✅ (with use restrictions) | Flow-down behavioral restrictions to users |
| Stable Diffusion | 3 / 3.5 | Stability Community License | ⚠️ conditional | Revenue/entity thresholds; verify before use |
| FLUX.1 | Kontext [dev] | BFL Non-Commercial | ❌ unless licensed | Separate model (no base flow); NC like FLUX.1 [dev] |
| FLUX.2 | klein 4B | Apache 2.0 | ✅ | Fully clear |
| FLUX.2 | klein 9B / [dev] | FLUX Non-Commercial | ❌ unless licensed | ONLY klein 4B is Apache; 9B + dev are NC |
| Chroma | unlocked | Apache 2.0 | ✅ | Fully clear |
| Z-Image | Turbo | Apache 2.0 | ✅ | Fully clear |
| Krea | 2 | Krea 2 Community | ⚠️ conditional | Commercial only under <$1M-revenue threshold |
| Pony Diffusion | (SDXL) | Fair AI Public License 1.0-SD | ✅ | Flow-down restrictions |
| Llama | 3.x | Meta Community License | ✅ (with conditions) | 700M MAU cap, attribution/naming, flow-down AUP |
| Qwen | 3 / 3-VL / Image | Apache 2.0 | ✅ | Verify per checkpoint; Qwen3 generation is Apache |
| MiniMax | H3 (fl2va / ref2va) | MiniMax H3 | ✅ licence held | Restrictive in the US; Mony Group LLC requested and received a US operating licence (2026-09-01). Third-party H3 derivatives are NOT covered — `minimax-h3` stays `no` in `modelLicense.ts` so imports fail closed. Turbo LoRAs (larryvrh) verified under the same grant. |

> Action: extend this table for **every** model in the catalog before it can be billed.
> Tie it to the `Fundamentum` / `Essentia` registry so license metadata is single-sourced
> with the model spec (see ADR-0005, ADR-0007).
>
> **Encoded in code (2026-07-02):** this register is the ground truth for `src/crystal/modelLicense.ts`
> (`classifyBaseModel`/`classifyModelLicense`), which stamps a `commercialUse` verdict on every model
> at import/train and via the license backfill sweep. Canonical models carry an explicit verdict in
> `src/crystal/seeds/intellae.ts`. The public-catalog gate (`isCatalogEligible`) refuses `no`/`unknown`
> promotions fail-closed — see `docs/spec/model-import.md` §Licensing.

---

## Distilled: the legitimate structure

1. **Closed-loop prepaid credits, us as merchant** → sidesteps most money-transmitter
   licensing. Defer the pod-owner marketplace and any transferable token.
2. **No transferable/cash-out token** (or strictly pure-consumption credit) → avoids
   securities + MSB.
3. **Mandatory CSAM hash-matching + output classifiers + capability refusals** at the trust
   boundary → child-safety duty met without breaking privacy.
4. **NCMEC reporting + evidence-preservation pipeline** for actual-knowledge cases.
5. **OFAC screening on deposit addresses** → the one identity check we keep.
6. **EU AI Act content labeling** if serving EU.
7. **Per-model license clearance** via the register above; permissive-only for the
   enterprise vertical; **BAAs** for healthcare PHI.
8. **Spend early money on two specialists, not growth:** crypto/MSB attorney +
   trust-and-safety/child-safety advisor.

The marketplace and any token are the two features that most threaten "legitimate." Launch
as a closed-loop merchant with boundary-scanning and defer both.
