# Using Zodomo's shared LLM server

A friend of rth's, Zodomo, has opened a Tailscale connection to his LLM server and given rth
an API key and a model name to use it. He's building toward serving a stable model network for
his own family, and heavy, steady use from us is a direct favor back to him — it's traffic that
helps him validate the box he's building, not just a free resource for us to dip into. This note
lays out what's actually reachable, where it fits the crystal, and which options to take.

## What's there

- **Reachable now:** `modelhaus-gateway.tail87cc24.ts.net`, resolvable over our shared Tailscale
  group (confirmed: it shows in `tailscale status` as a peer, user `Zodomo@`). Port 443 answers
  through nginx with `401 Authorization Required` on API paths and a plain `404` on `/` — an
  OpenAI-compatible reverse proxy gated by the key Zodomo handed rth, exactly the shape every
  other hosted chat provider in this codebase already speaks.
- **The model — best identification, not a confirmed read:** the voice note's "Qn 3.8 next
  flash" lines up with **Qwen3-Next-80B-A3B**, almost certainly the **FP8** build ("next flash" ≈
  "Next FP8", a real, commonly-served variant) and an **abliterated** (uncensored) fork, the kind
  `huihui-ai` publishes for this exact model. That family is: an 80B-parameter MoE model with only
  ~3B active per token, 256K native context (extensible further), strong general benchmarks, and
  working tool/function-calling. It is **text-only** — no indication Zodomo is also serving a
  vision model, so it can't cover image captioning on its own.
  - I could not query the gateway's `/v1/models` myself — it's correctly behind the key, and I
    don't have it. **This needs rth to confirm the literal model id** (one `curl .../v1/models`
    with the real key settles it in seconds) before anything ships against it by name.
- **"Four instances":** most likely four replica workers behind the one gateway, for throughput —
  not four different models. Treat it as one endpoint with roughly 4x the concurrency of a single
  worker, not four separate things to route between.
- **Cost to us:** zero — it's Zodomo's hardware. That's also the whole point of using it heavily.

## Where it fits the crystal

This is someone else's already-running server reached over the network — the same shape as
OpenAI, OpenRouter, or Venice, **not** a compute substrate we provision (that machinery —
`Fundamentum.runtime` covering `vLLM`/`llama.cpp`, the seeded `llama.cpp` model, the catalog's
`llama.cpp server` container image — is for pods *we* run; it doesn't apply to a box someone else
is operating and sharing with us over Tailscale).

The right seam is `src/crystal/apiProviders.ts`, which turns "add an OpenAI-compatible provider"
into a 3-step, no-new-code change (its own header says as much, and OpenRouter/Venice already
prove it generalizes):

1. a new `ApiProvider` descriptor — `id: 'zodomo'`, `baseUrl` pointed at the Tailscale gateway's
   `/v1`, `authEnv` naming the env var that holds the key, `chat` capability with the confirmed
   model as the default.
2. the key in whatever env store already holds `OPENAI_API_KEY`/`VENICE_API_KEY`.
3. a new `modus` (same shape as the existing Venice "uncensored" chat modus) with
   `ministerium: 'zodomo'`.

No new `Cursor` class. It reaches the live `chat` verb (t2t, canon, already shipping as
`modus.chatgpt`) immediately, through Telegram and `/run` alike.

One thing **not** to reuse: `src/crystal/spicyRouting.ts` looks like the "uncensored model"
slot, but it's shipped empty by a standing operator ruling (2026-07-28) and is explicitly typed to
hold only **OpenRouter** model ids — it repoints `aditus.model` within the same provider, it
doesn't switch providers. Zodomo's model isn't an OpenRouter id, so it needs its own modus (as in
step 3 above), not an entry in that map.

## Options, ranked

**A — Add it as a plain chat provider (ship first).** The 3-step add above: new provider
descriptor, the key, a new modus. Low risk, fully reversible (delete the descriptor/modus),
immediately usable from Telegram's `chat` verb. This alone is "using it" — and the fastest way to
start putting real, steady traffic on Zodomo's box.

**B — Default the prompt-helper to it.** The concierge agent already embellishes every t2i/t2v
prompt before dispatch (`ConciergeAgent`); pointing that step at Zodomo's model by default
(falling back to a metered provider if the Tailscale link or his box is down) touches every
single generation request — by far the heaviest, steadiest load we could put on it, and free to
us besides. Needs a small reachability/timeout guard; no new architecture.

**C — Wire it into the tool-calling agent path.** The concierge's tool-use loop
(`OpenRouterToolClient`) is currently hardwired to OpenRouter; generalizing it to take any
`ApiProvider` would let Zodomo's model carry that traffic too (it does support function calling).
More invasive — touches the one hardwired client — and worth doing once A/B are proven stable.

**D — Route open/uncensored requests to it on purpose.** Because it's abliterated, it's the
natural home for anything a hosted provider would refuse or sanitize (explicit creative-writing
asks, edgier prompt rewriting). Ship as its own opt-in modus (same shape as Venice's
"uncensored" option) — don't touch `spicyRouting.ts`'s OpenRouter-only contract to do this.

**E — NOESIS.** The launchpad has no LLM integration today. Plausible uses: drafting
collection/launch copy and metadata, assisting the onchain message board, and the same
prompt-helper pattern for NOESIS's own art-generation service. This is a different codebase and a
real scope of its own — **flagging it, not filing it**, per this seat's instructions.

## Recommendation

1. Ship **A** now — smallest, safest, and is literally the ask.
2. Once A is stable for a few days, flip the prompt-helper default to it (**B**) — that's the
   option that actually produces heavy, steady use, which is the whole point of being handed
   this.
3. Treat **D** as nearly free after A exists (just surface it as a second, opt-in modus) and
   **C** as a short follow-on refactor once B is proven.
4. **E** (NOESIS) is worth doing but is its own goal, not a line item here.

## What's needed from rth before any of this ships

- The literal model id (the gateway is correctly gated; I have no key to read it back myself —
  the identification above is a confident reconstruction from the voice note and public model
  listings, not a confirmed read of his server).
- The API key itself, and which env var it should land in alongside the existing provider keys.
