# About — Page Content Draft
*For web/marketing use. Internal working draft.*

---

## Hero

**Headline:** Private compute. You hold the keys.

**Subhead:** We built the infrastructure so that privacy isn't a promise — it's an architectural fact: your session travels through a tunnel we're not part of.

---

## Mission section

### What we believe

The most powerful AI should be available to everyone without requiring them to hand over their thoughts, their work, or their identity to access it.

Every major AI platform today is built the same way: your prompt travels to their servers, gets processed, and a response comes back. They tell you they don't look. They might even be telling the truth. But the infrastructure doesn't enforce it. You are trusting the people, not the math.

We built something different.

### How we built it

A private session on Noema establishes a WireGuard tunnel directly between your browser and the GPU running your model. Once that tunnel is up, our servers are architecturally out of the picture. We don't receive your prompts. We can't. The platform sees a session opened, GPU-hours consumed, a session ended. Nothing else.

The credits you spend? They're zero-knowledge proofs. We verify the math; we cannot link the spend to you.

When we ship hardware attestation, you will be able to cryptographically verify — in your browser, against a hardware-signed certificate — that the software running inside the enclave is exactly what we say it is. No trust required. Just math.

---

## What we are

Noema is a private AI compute platform. We provide:

- **Private compute sessions** — single-tenant GPU pods, WireGuard-tunneled, platform-blind. A hardware-sealed tier (confidential compute with browser-verified attestation) is in development.
- **AI generation** — text, image, video, audio, via best-in-class open-source and frontier models
- **A creative workspace** — a typed, composable canvas for building multi-step AI flows
- **Anonymous billing** — zero-knowledge credit proofs; no identity required

We are not a wrapper around OpenAI. We run our own infrastructure, our own models, and our own privacy-preserving payment rails.

---

## The team

[TEAM SECTION — placeholder for bios]

We are a small team of engineers and researchers. We believe privacy is an engineering problem, not a policy problem, and that the only credible privacy guarantee is one that doesn't require you to trust us.

---

## Transparency

Our tunnel runner is open source. When the hardware-sealed tier ships, the reproducible enclave measurement used for attestation will be published so anyone can recompute and verify it. The zero-knowledge circuit for purse credits is open source and has undergone a trusted setup ceremony.

If you find a discrepancy between what we say we do and what the code does, we want to know: [SECURITY EMAIL]

---

## Contact

General: [CONTACT EMAIL]
Security: [SECURITY EMAIL]
Press: [PRESS EMAIL]
