# About — Page Content Draft
*For web/marketing use. Internal working draft.*

---

## Hero

**Headline:** A boutique studio for generative AI.

**Subhead:** Curated open- and closed-source models and a concierge that builds with you — funded anonymously, with privacy claims we keep honest.

---

## Mission section

### What we believe

The most powerful AI should feel like a studio, not a settings panel. You describe what you want; a concierge picks the models and tools and makes it — and you can open the controls whenever you care to.

We also believe you shouldn't have to hand over your identity to use it. You can fund and use Noema anonymously, with no email and no wallet linkage.

### How we built it

Noema runs a curated set of open- and closed-source models across every modality, wired to a concierge that turns intent into finished work. Generation runs on external GPUs (RunPod); concierge reasoning routes to an external LLM provider. We do not retain your prompts or outputs after a request, and we never train on them.

The credits you spend are zero-knowledge proofs. We verify the math; we cannot link the spend to you. This is real anonymity — about *who* you are, not a claim that the compute provider can't see your work.

A hardware-sealed private-compute tier — a WireGuard tunnel to a single-tenant GPU pod with browser-verified attestation, so that neither we nor the provider could inspect your session — is in development and not yet available. Until it ships, treat every session as visible to the compute provider.

---

## What we are

Noema is a boutique generative-AI studio. We provide:

- **A concierge + studio** — describe what you want; curated open- and closed-source models make it
- **AI generation** — text, image, video, audio, via best-in-class open-source and frontier models
- **A creative workspace** — a typed, composable canvas for building multi-step AI flows
- **Anonymous billing** — zero-knowledge credit proofs; no identity required
- **Private compute (in development)** — single-tenant GPU pods over WireGuard; a hardware-sealed, attested tier is in development

We are not a wrapper around OpenAI. We run our own infrastructure, curate our own model catalog, and operate our own anonymous payment rails.

---

## The team

[TEAM SECTION — placeholder for bios]

We are a small team of engineers and researchers. We care about craft, about giving people the best open- and closed-source models in one place, and about being precise regarding what we do and don't protect — we'd rather under-claim than oversell.

---

## Transparency

Our tunnel runner is open source. When the hardware-sealed tier ships, the reproducible enclave measurement used for attestation will be published so anyone can recompute and verify it. The zero-knowledge circuit for Bursa credits is open source and has undergone a trusted setup ceremony.

If you find a discrepancy between what we say we do and what the code does, we want to know: [SECURITY EMAIL]

---

## Contact

General: [CONTACT EMAIL]
Security: [SECURITY EMAIL]
Press: [PRESS EMAIL]
