# StationThis corpus — behavioral & marketing analysis

Source: 162,947 generations · 815 users · **2024-09-10 → 2026-06-24**, archived from
ComfyDeploy. Prompt-text embeddings → UMAP space + 24 semantic clusters. Numbers
are reproducible: `scripts/corpus-space/analyze.py` → `out/analytics.json`.

> Caveat: legacy-2024 (`userId`, Telegram) and noema-era (`maid`) identities are
> namespaced separately and not joined, so a user active in both eras counts
> twice. Acquisition/retention figures are per-era-identity, not per-human.

---

## 1. The whole platform is 22 people

| cohort | def (lifetime gens) | users | share of all gens |
|---|---|---:|---:|
| **whale**   | ≥ 1000 | **22**  | **81.4 %** |
| power       | 100–999 | 63     | 14.4 % |
| regular     | 10–99   | 169    | 3.3 % |
| casual      | 2–9     | 359    | 0.9 % |
| one-shot    | 1       | 202    | 0.1 % |

- **Gini = 0.951.** Top 1 % of users (8 people) = **55 %** of all output; top 10 % = **95.5 %**.
- Median user makes **4** generations, lifetime. The single biggest user made **18,803**.

**Read:** this is not a 815-user product, it's a ~22-user product with a long tail
of people who tried it once or twice. Every health metric should be weighted by
the whales, but every *growth* opportunity is in the 730 users who churned early.

## 2. Retention is the leak — not value

- **53 % of users are single-day** (active on exactly one calendar day, ever).
- Only **37 %** ever come back over a span ≥ 7 days. Median active-days/user = **1**.

The people who stay generate enormous value (see §1). The problem is getting a
2nd session. **Activation, not monetization, is the constraint.**

## 3. Craft correlates with retention (median prompt length by cohort)

| one-shot | casual | regular | power | whale |
|---:|---:|---:|---:|---:|
| 31 ch | 37 ch | 61 ch | 123 ch | **304 ch** |

Whales write **10× longer** prompts than one-shots. Engagement and prompt
sophistication move together. This is the strongest lever we have: **if we can
make a casual user's *first* prompt produce a whale-quality result, we change
their day-1 experience** — which is exactly what the Concierge prompt-augmentation
feature is for. The data says ship it to new users first.

## 4. Growth curve: launched hot, peaked Jan-2025, then bled out

| | 2024-09 | 2024-12 | **2025-01** | 2025-04 | 2026-04 |
|---|---:|---:|---:|---:|---:|
| gens/mo | 11.5k | 20.3k | **25.7k (peak)** | 8.4k | 0.3k |
| active users | 91 | 263 | 257 | 69 | 8 |
| **new users** | 91 | 165 | 145 | 16 | 2 |

New-user acquisition fell off a cliff after Jan-2025 (165 → 145 → 29 → … → single
digits). The platform's heyday was the legacy 2024 Telegram era; the noema-era
that follows is smaller and whale-sustained. **There is a relaunch opportunity:
the engine and corpus are far stronger now than at peak, but acquisition stopped.**

## 5. What people actually make: crypto/meme-culture personas

The 24 clusters are dominated by **named character/IP LoRAs and meme culture**, not
generic "landscapes/portraits":

- `j0yc4t · milady` (14.8k) — Milady / joycat PFP universe (the single biggest theme after the generic "image·background" bucket)
- `wearing · black · trump · man` (12.8k) — persona/celebrity portraits
- `text · ticker · instantly` (7.4k) — **memecoin ticker art** (text-on-image)
- `image · vitalik · medieval` (6.8k), `cheeseworld` (5.9k), `threadguy`, `rugcore` …
- plus generic buckets: `image·background`, `girl·perfect·hair·eyes` (anime portraits), `cute·animals`.

Top LoRAs confirm it: `petravoiceflux2`, `diffusioN64`, `13angel33flux`,
`xiaohongshuflux`, `rugcoreflux`, `cheesefoidflux`, `zeldan64flux`. Only **196**
unique LoRAs across the corpus, and they are the product's gravity (these are the
same models we're recovering to R2).

**Every cohort makes the same core themes** (Milady, persona portraits) — whales
don't make *different* things than one-shots, they make *more* and with *longer
prompts*. The one whale-specific signature is heavier **text/typography work**
(`image·text`) — building memecoin/ticker graphics at volume.

## 6. Tech migration is visible in the data

Checkpoints: legacy SDXL (`zavychromaxl_v60` #1) → **`flux-schnell`** (#2 and the
noema-era default). Services shifted `MAKE`/`FLUX` (Telegram verbs) → `comfyui`.
11 % of gens (18.3k) use a negative prompt — almost entirely the SDXL era.

---

## Hypotheses to act on

1. **Fix day-1 activation, ignore monetization for now.** 53 % never return. The
   highest-leverage product change is a first-session that produces a great result
   from a short prompt → **route every new user through the Concierge** (auto-expand
   their 31-char prompt toward the 304-char whale median). Measure: day-2 return rate.
2. **We are a crypto/meme-culture creative tool — own it.** The corpus is Milady,
   PFPs, memecoin tickers, crypto personas. Market there (CT, the exact communities
   behind petravoice/joycat/rugcore), not as a generic "AI image" tool. Ship
   first-class **ticker-art** and **PFP-style** spells/templates.
3. **Curate the canonical LoRAs as the on-ramp.** 196 LoRAs carry the whole corpus;
   the top ~20 are the draw. Feature them (the recovered-to-R2 set) as one-tap
   starting points — this is both the retention hook and the relaunch story.
4. **Relaunch to lapsed users.** Acquisition died Jan-2025 but the engine is far
   better now. There's a reactivation list (the 760 legacy users) and a stronger
   product than they left.
5. **Whales need power tools.** 22 users = 81 % of usage, heavy text/typography and
   long prompts. Spells, batch/cook flows, and saved-prompt machinery retain them.

See the live 3D space (`/space`) to explore any of these clusters visually.
