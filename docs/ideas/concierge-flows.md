# Idea Log — The Concierge: flows that converse, coach, and co-create

- **Status:** captured idea (not specced, not decided). A vision that bridges several in-flight threads.
- **Date:** 2026-06-11
- **Relates to:** ADR-0005 (`Fundamentum.runtime` — multi-runtime), the runner.py/runtime-taxonomy exploration,
  `/spell` (composed/`gradus`-chained `Modus`), the prompt-affix / save-as machinery, studio/Census warm-session economics.

## The spark

Daydreaming about finally having a fully-functional AI app that hits every category (image/video/music/3d/text,
both ways), and someone getting *really good* at one modality and authoring their own flows. Then a personal want:
a complex "frankenstein spell" — input text + a pfp image → a brainrot TikTok video via TTS, text-to-video,
image-to-video, and ffmpeg — that I'd want to run **in stages**, where the flow pauses to ask *"do you like how it
interpreted the script?"* and lets me shape the result mid-process. All on a 4090; llama.cpp built into these
things is not unheard of.

Then the blast: **what if the default for our canon flows — especially on cold start — is to start a *conversation*
with the creator?** Tease out a better prompt, coach prompt-space exploration, offer variations and angles. Bake a
**concierge component into the Essentia by default.** Still offer the raw one-shot (ignore or turn the concierge
off), but lead with the guide.

## The core idea

A **Concierge** is a conversational guide attached to a flow that, by default:
- **Coaches the prompt** before (and during) generation — expands a thin prompt, suggests angles, surfaces the
  knobs the flow exposes in plain language.
- **Explores the space** — proposes variations, lets the creator pick directions, iterates *during the warm
  session* instead of one-and-done.
- **Stages the work** — for composed flows, pauses at checkpoints ("here's how I read your script — good?") and
  lets the human shape the result before the expensive steps run. Human-in-the-loop, opt-in-by-default.

It is a **default-on, toggle-off** component of an Essentia. The raw flow stays available for power users and
agents who submit complete intents.

## Why it's a moat + the economic case

- **Differentiation:** everyone ships raw text→image. A flow that *coaches you to a better result* is a different
  product. The concierge is the brand.
- **Cold-start dead time becomes value:** today a cold start is a liability — the user stares at a provisioning
  pod. The concierge fills that window with prompt coaching + exploration, so by the time the pod is warm the
  creator has a *better* prompt queued. The wait stops being wasted.
- **Lower cost-per-gen:** better prompts up front + guided iteration during the *warm* window = fewer wasted gens,
  more value per warm session. This directly compounds the studio/Census warm-session economics — a warm studio
  amortizes the cold start across many fast, *well-aimed* gens.
- **Onboarding:** a first-timer gets coached instead of bouncing off a blank prompt box.

## Why this shapes the course of development (the directional bets)

This is the part to take seriously. The Concierge isn't a feature to slot into the backlog — it's a set of
*default-setting* decisions that ripple into everything we build next. Captured because the author's instinct is
that it reorients the roadmap:

1. **It changes the unit of a flow from SHOT to SESSION.** Today a flow is a one-shot transform (`aditus → exitus`).
   The Concierge makes a flow a *guided session* that converges on a result over a dialogue (often many gens). This
   is not a UI tweak — it changes what we optimize. And the crystal **already committed to this**: the `Modo` type's
   own doc says *"the session is the unit of value, not the individual job."* The Concierge is the UX/product
   realization of an economic primitive we already baked into the data model. It completes a thesis the crystal
   already holds, rather than bolting one on.

2. **The conversation substrate ALREADY EXISTS, dormant.** The ring carries `Colloquium` ("the persistent thread
   that holds a sequence of turns") + `Dictum` ("the said things, the turns") — full stores (`MongoColloquium`/
   `MongoDictum`), wired in, **used nowhere yet.** So the Concierge dialogue = `Colloquium` + `Dictum` + an LLM
   `Cursor` + `Essentia`-config. **No new noun.** The crystal was built anticipating exactly this; the Concierge
   activates the dormant primitive. (Strong crystal-first signal — verify the Colloquium/Dictum shapes when we build,
   but the bet is: compose, don't invent.)

3. **The LLM becomes connective infrastructure, not modality #8.** The 7 new essentiae are *modalities* (music, video,
   3d…). The Concierge LLM is a different kind of thing — the layer that *wraps* all of them. So in the runtime
   taxonomy, "LLM via API cursor" isn't another modality to add later; it's a cross-cutting, always-available layer
   that every flow leans on. Prioritization signal: **build the LLM cursor early** — it's foundational, not a leaf.

4. **It inverts the default to the full case.** Per north-star ("build for the full case; the simple case is a
   config"), the Concierge declares the *full case of a flow is a coached session*; the raw one-shot is the degenerate
   config. So we should author flows **concierge-first, raw-as-opt-out** — including the 7. A default-setting decision
   that touches every Essentia we write.

5. **It reframes cold-start from cost-ELIMINATION to cost-MASKING + value-creation.** We've been spending hard effort
   to *eliminate* cold start (warm pods, runner.py). The Concierge says: you can't always eliminate it, so *fill* it
   with value. The async studio handle (provision in background) + the Concierge (coach during the wait) may get us
   ~80% of the cold-start UX win — which *lowers the urgency and scope* of the hardest runner.py squeeze. The two are
   complementary, and the Concierge changes the cost/benefit of how far we push the runner rework.

## Mechanics (sketch — not a spec)

- The concierge is an **LLM agent**. Default transport is an **API connection** (cheap, instant, no cold-start
  model download, no bandwidth-throttle hit) — with **local llama.cpp** as an option for the privacy/offline case.
  Crucially: the concierge does **not** require downloading a big model onto the gen pod, so it doesn't tax the
  cold start it's meant to mask.
- It reads the flow's `aditus` (the typed input schema) to know what it can coach, and writes back the shaped
  `aditus` the gen consumes — so it sits *in front of* the existing run path, not replacing it.
- For composed flows it's the **stage gate**: between `gradus` it can checkpoint with the human.
- Per-flow config: `concierge: on | off`, plus a flow-authored persona/brief (what this flow's guide knows and
  asks about). Authoring a concierge is part of authoring an Essentia.

## The bridges (why this matters now)

This isn't a side feature — it ties our open threads together:

1. **Cold-start ↔ UX.** The runner.py / warm-pod work is about *killing* cold-start cost. The concierge *uses*
   the cold-start window. Together: provision in the background (we just shipped the async studio handle) while the
   concierge coaches — the user never feels the wait.
2. **Multi-runtime exploration (the open question).** The concierge is itself a non-ComfyUI runtime shape — an LLM,
   delivered as an **API cursor** (no pod) or **llama.cpp** (on-pod). So it's a concrete data point for the runtime
   taxonomy we were about to map for the 7 new essentiae. It argues the *default* concierge is a cursor flow, not a
   pod runtime — which is exactly the kind of partition that exploration is meant to produce.
3. **`/spell` / composed flows.** The staged, human-in-the-loop frankenstein spell (text + pfp → TTS → t2v → i2v →
   ffmpeg → TikTok) IS the concierge over a `gradus`-chained `Modus`. The concierge is the conversational layer the
   `/spell` work needs anyway.
4. **Prompt machinery.** The concierge is the *dynamic, conversational sibling* of the static prompt-affix / save-as
   wrapper. Affixes are flow-baked text; the concierge is flow-baked *coaching*. Same seam (shape the `aditus`
   before compile), different altitude.
5. **Warm-session economics.** Drives cost-per-gen down by aiming gens better and amortizing the warm window —
   compounding the billing/cap work (Census, `maxImpetus`, per-window cost) we just finished.

## Open questions

- **Crystal name.** Plain-English "Concierge" for now; the primitive wants a declined-Latin name (candidate:
  **`Comes`** — companion/escort, the root of "concierge"; or `Paedagogus` — the guide-tutor). Decide if/when it
  graduates from idea to primitive.
- **Is the concierge a new noun, or a projection?** Per crystal-first (minimize surface), can it be expressed as a
  config + persona on the existing `Essentia` + an LLM `Cursor`, rather than a new domain type? Lean yes.
- **Where does the conversation live?** It's stateful (a dialogue) — does it ride the `Modo` session, a new
  lightweight thread record, or the adapter's existing flow-context? (Telegram already has force-reply wizards; the
  API would need a turn-based endpoint or it folds into the run-handle.)
- **Default-on vs discoverability.** On-by-default is the moat, but agents (API/MCP) submitting complete intents
  must trivially bypass it (`concierge: off`), and it must never block the raw one-shot.
- **Cost of the concierge itself.** It spends LLM tokens — meter it (it's impetus too), and make sure the
  cost-per-gen savings dominate the coaching cost.

## The 7 essentiae — how they arrive (and what it implies)

The 7 new flows (music/video/image → text, text → music, image → 3d, etc.) are **not yet created** — they exist as
a series of **HuggingFace modelcard links**, and crucially *many modelcards ship self-contained runnable inference
code* (no ComfyUI graph). That's a major architectural signal:

- **The non-ComfyUI runtime is probably LEAN.** Instead of a bespoke server per model, the executor may be a generic
  *"run this modelcard's inference snippet in a python env"* — far lighter than ComfyUI. That gives the runner
  shell/executor split a natural third executor (`raw-python-modelcard`) alongside the ComfyUI one, and likely shrinks
  the runner.py rework: many of the 7 are probably **cursor flows or lean python-pod flows, not heavy ComfyUI**.
- So the runner taxonomy buckets sharpen to: (a) **API/cursor** (incl. the Concierge LLM), (b) **ComfyUI-pod**,
  (c) **lean python-pod (modelcard code)**, (d) maybe **llama.cpp/vLLM**. The modelcard-code path may collapse much of
  what we'd have feared was bespoke.

## Next step — the dedicated triage pass (its own fresh context)

> **Update 2026-06-11 — triage pass DONE** (scoped independently of the concierge) → `docs/spec/essentiae-triage.md`.
> 5 models, all self-hosted on rented RunPod pods: **generation** — text→music (HeartMuLa-3B), image/text→3d
> (Hunyuan3D-2.1); **understanding** — image+text→text (Qwen3-VL-8B), audio→text (MOSS-Music-8B), video/image→text
> (ShotVL-7B). The 3 understanding models share one transformers/vLLM substrate (weights swapped); runner rework is
> ~2 new executors beyond ComfyUI. The `3d` leaf forces type-system work (no `3d` categoria, no `mesh` port type,
> image-only output delivery). See the triage doc for the runtime/cost table, executor buckets, and crystal-gaps.

Building the 7 is **its own dedicated pass** (fresh context — the modelcard links need triage, then each becomes an
`Essentia` + `Fundamentum`). When that pass runs, do it as ONE sweep that yields three artifacts at once:
1. **The runtime/cost table** — per flow: `{runtime, base image, model-load mechanism, aditus→exitus shape, GPU/VRAM,
   does-the-modelcard-include-runnable-code}` → the runner.py shell/executor boundary + the `exitus` extension
   question (a `.glb` mesh / `.wav` isn't an R2 image).
2. **The bucket partition** — API-cursor vs ComfyUI-pod vs lean-python-pod vs llama.cpp — how big the runner rework
   actually is.
3. **The first Concierge personas** — for each flow, *"what would its guide coach?"* — seeding this idea from the
   same modelcards.

That one pass de-risks runner.py, scopes it, AND seeds the Concierge. Capture is here so the fresh context starts
loaded.
