# Muse — moodboard → surprise → masterpiece (feature scope)

**Date:** 2026-06-30 · **Status:** scope spec. Weaver **prototyped + validated 2026-06-30**
(see "Prototype findings" below).
**Working name:** *Muse* (alt: Serendipity / Surprise). The moodboard-driven idea engine
and the convergence funnel that mines a lucky gen into a 1/1 open edition.

> **Prototype findings (2026-06-30) — the weaver is validated on text, zero GPU.**
> Built `scripts/muse-weaver.ts` (`fetch → garden → combine/versus/smart`) and ran the
> make-or-break "surprise" stage against four REAL caption sets from HF
> (`noema-art/{lainflux,13angel33flux,kaminosekkeiflux}` + local `.koh-manifest.json`).
> What it established:
> - **The make-or-break works.** caption → categorized fragments → one-per-category
>   recombination → coherent prompt produces genuinely new, single-image, semi-original
>   prompts. Proven entirely on the text side — no gen fired.
> - **The engine is the TAXONOMY, not the LLM.** Cohesion comes ~90% from a two-tier
>   category split, not from a clever weaver:
>   - **Exclusive** (pick exactly one — >1 breaks the image): `setting, style, palette,
>     lighting, mood`.
>   - **Attribute** (one each, they STACK into one figure — mixing is the magic):
>     `subject, hair, outfit, pose, expression, props`.
>   The original "no two of a kind" instinct, split into two tiers. This structural split
>   is what makes every recombination coherent-by-construction.
> - **The LLM weave is a conditional SMOOTHER, not the source of magic.** On a side-by-side
>   (`versus`), template-vs-LLM produced the SAME image for ~3 of 5 rolls; the LLM only
>   earned its fee when two kept fragments genuinely contradicted (two implied places, or
>   whole-scene bright-vs-dim). It is NOT a quality filter — it faithfully weaves bad
>   fragments too, so garden quality / user curation is the real leverage.
> - **A cheap conflict detector gates the cost** (`smart` stage): template by default
>   (free, instant), LLM weave ONLY when a pure-string check flags a cross-category clash.
>   On the *hardest* (max-diverse) moodboard this ran **~38% paid / 62% free**; a coherent
>   moodboard sits near zero. The front-half slot machine is effectively zero-marginal-cost.
> - **Model binding falls out for free.** Each dataset's trigger word (`lain`, `koh`, …) IS
>   its LoRA attach — no manual tag→LoRA mapping needed.
> - **Real risks live DOWNSTREAM of text:** (a) LoRA-stacking — a roll can attach 3–4 LoRAs;
>   stacking that many will likely muddy output → needs a GPU to settle (lean: attach only
>   the `style`-source LoRA, maybe + `setting`). (b) Source captions are heterogeneous —
>   fragments are individuals, not archetypes of their dataset ("lain's outfit" isn't
>   reliably cyberpunk) → favors user curation of which fragments enter the garden.

## The problem it solves
A tool that can make *anything* is **paralyzing**. The blank page, the paradox of choice,
and the brutal truth that a *truly good* gen takes heavy curation + luck. The hardest part
of getting into the space is **having ideas**. Muse removes the blank page and makes the
luck systematic.

## The one-line pitch
Keep a **moodboard** of stuff you love → hit **surprise** to slam fragments of it together
into a fresh, coherent, semi-original gen → when one clicks, **mine** it (variations +
parameter sweeps) until you land a **masterpiece 1/1**.

## The experience (the funnel)
1. **Moodboard.** You collect images that inspire you (drop / save from a gen / seed from
   the space). For each: a **caption**, your **tags**, your **notes**, and — derived — a set
   of **prompt fragments** (e.g. *"a girl falling into the ocean"*, *"shining armor"*,
   *"oxidized patina"*, *"glitch art"*) and optional **model bindings** (a tag → a LoRA).
2. **Surprise (the front half — the money hook).** Pull fragments from across the board and
   **combine them into one coherent prompt** — not word-salad; woven so the pieces cohere —
   then auto-attach the **models** tagged on the contributing items, pick a verb (make/effect)
   and a base, and fire. Out comes a **spontaneous, semi-original gen built from your favorite
   stuff.** Roll again for another. This is the anti-paralysis engine.
3. **Converge (the back half — the value).** When a roll is *almost there*, **mine harder**:
   generate small **variations**, **ablate** each fragment (does it get better without the
   patina?), **sweep** a parameter (cfg/steps/seed) one axis at a time, lock what works. Climb
   from "good roll" → **1/1 masterpiece**.
4. **Mint.** The masterpiece exits as a **1/1 open-edition NFT** (or a download — sovereign
   path stays default).

## Crystal-core reduction (reuse, don't add nouns)
Most of this is **composition of existing primitives**. The new substance is small.

| Muse stage | Existing primitive it rides | New substance |
|---|---|---|
| Moodboard | **Dataset** (media + versions + captionsets) | enrich the dataset *item*: `tags[]`, `note`, derived `fragments[]`, `models[]`. A moodboard is a dataset, not a new noun. |
| Caption / fragments | **Captionset** (caption job) | a **decompose** step: caption → reusable prompt fragments (LLM, same captioner infra). |
| Concept space | **Editio trait model** (category·title·**value**·rarity·motif) | the moodboard **auto-derives a trait garden**: fragments → trait `value`s, tags → categories/motifs, model bindings → the LoRA attach. No hand-authoring. |
| Surprise | **Modus run** (make/effect) + the **sampler** behind editio canonic run | a **cohesion-aware sampler/weaver**: sample fragments across categories → weave into one coherent prompt (Concierge/LLM) → attach tagged models → fire. "Surprise" = a *single* sample; canonic run = the full grid. Same sampler, different scale. |
| Converge | **Editio combination tester** (lock/spin/sweep reels) + variation | a **mining** mode: per-fragment ablation + parameter sweep + reroll-axis, scored against the seed. Largely the editio tester applied to one seed. |
| Mint | **Editio export** (download / hosting / NOESIS) | none — already built. |

**Net new to build:** (1) dataset-item enrichment (tags/notes/fragments/model-bindings);
(2) the **caption→fragments** decompose; (3) the **cohesion-aware surprise sampler/weaver**
(the heart); (4) the **mining/convergence** surface (mostly editio-tester reuse). Everything
else is wiring existing surfaces into a funnel.

## Why it gets us paid (the money line)
- **Acquisition:** the *surprise / idea engine* is a reason to show up — "I can offer this"
  brings people in even before they commit. Removes the #1 barrier (ideas).
- **Engagement → revenue:** the converge loop is **many gens** (variations, sweeps) — metered
  credits, with rising perceived value per step (you're climbing toward *your* masterpiece).
- **Capture:** the funnel ends at a **1/1 open edition** — a natural mint/publish moment
  (editio/NOESIS), and a shareable artifact that markets the platform.
- **Moat:** it's the **Concierge made productive** — warm-session, cost-per-gen down, the
  multi-runtime/`/spell` machinery put to creative use. Hard to copy because it's the whole
  pipeline (moodboard → space → sample → mine → mint), not a button.

## Phasing (rough) — RE-ORDERED to lead with the validated weaver
The prototype inverted the original P0: the weaver (the make-or-break) is testable in
isolation against captions + the one real primitive (`createRun`), with NONE of the
dataset-item / editio mock-plumbing in the way. Lead with it.
- **P0 — Weaver, end-to-end (mostly DONE on text):** caption→garden (tight tagging:
  `lighting`≠place, `mood`=adjectival) → one-per-category sampler (exclusive/attribute split)
  → conflict-detector → template-or-LLM weave. ✅ proven in `scripts/muse-weaver.ts`.
  Remaining P0: wire one woven prompt → `createRun` with LoRA attach to close the loop on GPU
  (settles the LoRA-stacking question — lean style-source-dominant, not all contributors).
- **P1 — Moodboard surface + curation:** enrich dataset items (tags/notes); render the garden
  as category-colored **chips**; let the user curate which fragments enter the garden (the
  fix for caption heterogeneity). The chip board is the load-bearing UI primitive.
- **P2 — Surprise UI + lock/reroll:** the slot machine (template rolls = free/instant), the
  "wild" dial (1 source→safe … 4 sources→wild), lock-a-chip-reroll-the-rest. NB: lock/reroll
  IS the editio combination tester (lock/spin reels) the codebase audit found MISSING — Muse
  builds it.
- **P3 — Converge (mining):** lock more, reroll less; per-fragment ablation + parameter sweep;
  "this is the one" → mint via editio export. Same chip board, turned toward convergence — the
  funnel's front/back seam disappears.
- **P4 — Sharing/feed:** masterpieces + the moodboards that made them (discovery, remix).

## Open questions (for the fork)
RESOLVED by the prototype:
- ~~**Cohesion:** LLM weave vs category-slot constraints vs both?~~ → **BOTH, tiered.**
  Category-slot constraints (exclusive/attribute split) do ~90% structurally; LLM weave is a
  conditional smoother gated by a cheap conflict detector. The split is the make-or-break, not
  the weave.
- ~~**Model binding:** tag → which LoRA?~~ → **The dataset trigger word IS the LoRA.** No manual
  map. (Open sub-question moved downstream: how MANY of a roll's contributing LoRAs to attach —
  lean style-source-dominant, settle on GPU.)
- ~~**Cost shape (front half):**~~ → template rolls are free/instant; the meter only ticks on a
  detected conflict or during converge. Generous front, monetized back. (Converge-loop pricing —
  subscription allotment vs PAYG — still open.)
- **Fragment extraction:** prototype used fully-auto LLM decompose and it was high-quality, BUT
  caption heterogeneity (fragments are individuals, not dataset archetypes) argues for adding
  **user curation** — keep auto-extract, let the user prune/keep fragments. Lean: both.

STILL OPEN:
- **Moodboard = enriched Dataset, or a `kind`?** (lean: enrich the item; reuse the dataset
  surfaces — library/detail/caption — don't add a noun.)
- **Surprise vs. canonic run sampler:** the prototype's surprise sampler is deliberately
  cross-category random (serendipity), which is NOT the same as the editio canonic grid sampler
  (structured rarity draw). Revisit the spec's "same sampler at N=1" claim — they may be
  genuinely different mechanisms.
- **IA placement:** a rail entry ("Surprise"/"Muse"), a mode of **Make** seeded by a board, or
  the moodboard's primary action? (lean: an action on the moodboard + a quick Concierge entry.)
  → being design-crit'd against the real home surface, this fork.
- **LoRA-stacking (downstream):** how many contributing LoRAs to attach per roll without muddying
  output. Needs GPU.

## Out of scope (for now)
- The separate **NOESIS** publishing app (we only hand off to it at mint).
- Backend wiring of the underlying mock surfaces (datasets/models/editio) — Muse rides whatever
  the `/v1` wiring lands; build the experience against the same mock seam, flagged `TODO(backend)`.

## Anchors in the codebase
**Weaver prototype:** `scripts/muse-weaver.ts` — staged `fetch → garden → combine/versus/smart`,
uses `OPENAI_API` (gpt-4o) + `HF_TOKEN`. The validated reference for the surprise stage.
Datasets (`screens/Datasets*`, `lib/datasets.ts`), caption job (`screens/CaptionJob.tsx`),
editio trait model (`lib/editioTraits.ts`, `screens/TraitsGarden/TraitRules/CanonicRun`),
export (`screens/EditioExport.tsx`), Concierge (`shell/Concierge.tsx`), the run path
(`lib/api.ts createRun`, `lib/training.ts` as the launch pattern).
