# Pricing

---

## Hero

**Headline:** Simple pricing. Spend credits anywhere.

**Subhead:** Credits are your compute currency. Spend them on any modality. No subscription — buy a pack, spend it whenever.

---

## Credit system explainer

**Buy a credit pack. No subscription.**

Credits work across every modality — text generation, image generation, video, and audio. You buy once, spend anywhere. Credits don't expire. Bigger packs give you a better rate — roughly 208 to 270 credits per dollar depending on the pack you choose, cheapest pack to biggest.

Anonymity here is a property of how you fund. Pay by card and it's identified; fund from a fresh or shielded on-chain wallet and there's no identity behind the address. For spends nothing can tie back to you, mint a ZK purse from your balance (see below).

---

## Packs

### Starter
**$10 — 2,080 credits**

- Never expire
- No subscription, no recurring charge
- Mint a ZK purse to spend unlinkably
- Spend across every modality

**[Buy Starter]**

---

### Standard
**$25 — 5,720 credits**

- Never expire
- No subscription, no recurring charge
- Mint a ZK purse to spend unlinkably
- Spend across every modality

**[Buy Standard]**

---

### Plus
**$50 — 12,480 credits**

- Never expire
- No subscription, no recurring charge
- Mint a ZK purse to spend unlinkably
- Spend across every modality

**[Buy Plus]**

---

### Studio *(best rate per credit)*
**$100 — 27,040 credits**

- Never expire
- No subscription, no recurring charge
- Mint a ZK purse to spend unlinkably
- Spend across every modality

**[Buy Studio]**

---

## Private spending

Anonymity depends on how you fund. Fund from a fresh or shielded on-chain wallet and the address has no identity behind it — the strongest privacy available today. Then mint a ZK purse from your balance: its spends are cryptographically unlinkable to what you funded. Minting a purse needs a signed-in account, so it's an unlinkable spend layer on top of an identified balance — strongest when you fund from a shielded wallet. Direct-to-commitment deposits, where we never see the funding wallet, are on the roadmap.

**[How purse works →]**

---

## FAQ

**Do credits expire?**
No. Credits purchased directly never expire.

**Can I get a refund?**
Yes, within limits. Unused credits are refundable within 14 days of purchase. Once credits have been spent, in whole or in part, the spent portion is non-refundable — they're a prepaid compute balance, not a subscription. If you have an issue, contact us and we'll work it out.

**What's the difference between a purse credit and a regular credit?**
Functionally identical — both buy the same compute, same GPU, same models. The difference is the billing layer: a regular credit is tied to your account, while a purse credit spends from a ZK bearer token whose spends are cryptographically unlinkable to how it was funded. How anonymous the funding itself was still depends on your funding source — a shielded wallet reveals no identity; a card is identified.

**Do you offer a free trial?**
There's no free tier. The Starter pack ($10) is the low-cost way to try it, and the credits never expire, so there's no clock running against you.

**Can I use the API anonymously?**
Yes. Pass a `x-bursa-token` header instead of a session key. The API docs explain how to generate one.
