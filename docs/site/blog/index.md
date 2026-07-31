# Blog — Content Scaffold
*Internal planning doc. Post ideas and drafts go here before publishing.*

---

## Publishing priorities

The blog does two things: establishes technical credibility for the product (curated open- and closed-source models + concierge) and earns organic search traffic. Anonymity and, later, private compute are supporting angles — not the lead.

**Gate:** any post that describes TEE / confidential-compute / hardware-attestation capability as delivered must NOT publish until that tier actually ships. Today it is in development; posts below are marked accordingly.

---

## Post pipeline

### Ready to write (high value, low research needed)

**1. "Why we built the TEE runner from scratch instead of using a third-party TEE service"** *(gated — publish only when the TEE tier ships)*
Explains our first-party approach vs. Venice's Phala/NEAR delegation. The trust chain argument: 2 parties vs. 4. Links to the open-source runner. Technical credibility post.
Tags: privacy, architecture, TEE
Target: engineers evaluating privacy AI compute

**2. "What zero-knowledge credits actually mean for AI privacy"**
Explains Bursa: what a Groth16 proof is in plain terms, why on-chain wallet sign-up is not private, how ZK billing differs. Directly undercuts Venice's crypto privacy angle.
Tags: privacy, ZK, Bursa
Target: privacy-conscious users, crypto-native users

**3. "The trust chain problem with most 'private AI' platforms"**
A fair-minded explanation of what it takes to trust a privacy claim: contractual (just promises), architectural (prompts can't reach servers), cryptographic (verifiable by math). Where Venice's tiers land. Where we land. Not an attack piece — an honest framework.
Tags: privacy, comparison
Target: enterprise buyers, researchers, journalists

**4. "Hardware attestation: how to verify you're talking to a real enclave"** *(gated — publish only when the TEE tier ships)*
A technical walkthrough of TEE attestation: what an Intel TDX quote is, what gets hashed, how you verify it in a browser. When we ship Phase 3, this post ships with it as the documentation/tutorial.
Tags: TEE, attestation, technical
Target: security engineers, technically sophisticated users

---

### Needs more product progress first

**5. "The canvas: composing multi-step AI flows without writing a pipeline"**
FocusDemo walkthrough. How typed connections work, why mismatches are caught before runtime, how to chain image→video. Needs the canvas stable before writing.
Tags: product, canvas, workflow
Target: power users, content creators

**6. "Running your own model privately, with hardware attestation"** *(gated — publish only when the TEE tier ships)*
End-to-end guide: bring a HuggingFace model ID, push it through a TEE session, verify the attestation, generate. Needs Phase 2 browser WASM done.
Tags: TEE, tutorial, BYO model
Target: AI engineers, researchers

**7. "Anonymous AI: how to generate without leaving a trace"**
Full walkthrough: get Bursa credits and generate with no account and no wallet linkage. The complete anonymous path. (TEE-session steps to be added once the private tier ships.)
Tags: privacy, tutorial, Bursa
Target: privacy-conscious users, journalists, activists

---

### Strategic / thought leadership

**8. "A boutique take on generative AI: curated open- and closed-source models + a concierge"**
The product thesis as a long-form piece: why a curated catalog plus a concierge beats a blank box and a wall of settings. Anonymity and (later) private compute are supporting points, not the headline.

**9. "Why we don't use Google Analytics"**
Short post on what third-party analytics leaks, why we chose not to, what we do instead for product insight. Practical and specific.

**10. "The GDPR compliance advantage of not collecting data"**
For enterprise buyers: our small data footprint means a small compliance surface. PHI workloads, legal privilege, GDPR. Positions the BAA offering.

---

## SEO target keywords

| Keyword | Intent | Post |
|---|---|---|
| "private AI compute" | Commercial | Posts 1, 3 |
| "TEE trusted execution AI" | Informational | Posts 1, 4 |
| "AI privacy Venice alternative" | Commercial | Post 3 |
| "anonymous AI generation" | Informational | Post 7 |
| "zero knowledge AI billing" | Informational | Post 2 |
| "HIPAA compliant AI" | Commercial | Post 10 |
| "open source TEE runner" | Informational | Post 1 |
| "how does TEE attestation work" | Informational | Post 4 |
