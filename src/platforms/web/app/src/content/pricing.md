# Pricing — Page Content Draft
*For web/marketing use. Internal working draft.*
*Pricing numbers are placeholders — need business decision before publishing.*

---

## Hero

**Headline:** Simple pricing. Real privacy at every tier.

**Subhead:** Credits are your compute currency. Spend them on any modality. No subscription required to start.

---

## Credit system explainer

**100 credits = $1.00**

Credits work across every modality — text generation, image generation, video, audio, and private compute sessions. You buy once, spend anywhere. Credits don't expire.

There is no "free tier with degraded privacy." Privacy tiers are architectural, not paywalled. A private compute session costs GPU-hours regardless of your plan.

---

## Tiers (placeholder — needs pricing decision)

### Free
**$0 — no credit card required**

- [N] text generations per day (standard API, base models)
- [N] image generations per day
- Access to open-source model catalog
- Anonymous purse credits accepted
- API access

*Converts to paid when daily limits are hit.*

---

### Pro
**$[X]/month**

- Unlimited standard API text generation
- [N] image generations per day
- $[Y] credits included monthly ([$Y/100] worth of compute)
- All catalog models
- TEE private compute sessions available
- API access at standard limits
- Anonymous purse credits accepted

**[Get Pro]**

---

### Max *(Most popular for power users)*
**$[X]/month**

- Everything in Pro
- $[Y] credits included monthly
- [N]-month credit rollover
- TEE private compute at priority allocation
- Higher API rate limits
- Priority support

**[Get Max]**

---

### Enterprise / BAA
**Contact us**

For healthcare (PHI / HIPAA BAA), legal (privilege-sensitive), and high-volume workloads. Includes:
- Business Associate Agreement for HIPAA
- Dedicated TEE capacity
- SLA
- Custom credit volumes

**[Contact us]**

---

## Private compute pricing (GPU-hours)

TEE private sessions are billed by GPU-hour, not by generation. You pay for the pod while it's running.

| GPU class | Credits per hour | Typical use |
|---|---|---|
| 24 GB (RTX 4090 / A10G) | [N] credits/hr (~$[X]/hr) | 7B–27B parameter models |
| 48 GB (A6000) | [N] credits/hr (~$[X]/hr) | 34B–70B parameter models |
| 80 GB (A100) | [N] credits/hr (~$[X]/hr) | 70B+ or fp16 large models |

Sessions are billed from tunnel establishment to session end. Idle time inside the session counts — the pod is reserved for you.

---

## What credits cost (examples)

| Action | Approx. credits |
|---|---|
| 1 text generation (standard, ~500 tokens) | [N] credits |
| 1 image (FLUX Schnell, 1024×1024) | [N] credits |
| 1 short video (~5 seconds) | [N] credits |
| 1 hour of TEE private compute (24 GB GPU) | [N] credits |

---

## Anonymous billing

Don't want an account? Buy credits anonymously with crypto. Your spend is a zero-knowledge proof — we verify the math, dispatch your compute, and cannot link the transaction to you.

**[How purse works →]**

---

## FAQ

**Do credits expire?**
No. Credits purchased directly never expire.

**Can I get a refund?**
Yes, within limits. Unused credits are refundable within 14 days of purchase. Once credits have been spent, in whole or in part, the spent portion is non-refundable — they're a prepaid compute balance, not a subscription. If you have an issue, contact us and we'll work it out.

**What's the difference between a purse credit and a regular credit?**
Functionally identical — both buy the same compute. The difference is the billing layer: a regular credit is tied to your account; a purse credit is a ZK proof with no account association. Same GPU, same models, same privacy guarantee on the compute side.

**Do you offer a free trial?**
The free tier is your trial. No time limit, no credit card.

**Is the privacy the same on all paid plans?**
Yes. Privacy tiers are determined by which session type you use (standard API vs. TEE tunnel), not by your subscription plan. All plans can use TEE private compute — you pay GPU-hours from your credits.

**Can I use the API anonymously?**
Yes. Pass a `x-bursa-token` header instead of a session key. The API docs explain how to generate one.

**What is a BAA?**
A Business Associate Agreement is a HIPAA-required contract for handling protected health information (PHI). If you're building in healthcare, you need one before transmitting PHI. Contact us.
