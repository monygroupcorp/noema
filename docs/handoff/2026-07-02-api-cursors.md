# Handoff — Declarative API cursor (JS-nuke blocker #12)

**For:** a fresh-context agent. **Goal:** give crystal a **first-class, declarative API cursor** so
hosted-API providers (OpenAI first; OpenRouter and friends next) are **data, not a bespoke class each**.
This underlies the **Concierge** (the conversational guide) more than anything else, so the chat/inference
path must be right — not just wired. Context: `docs/plans/2026-07-02-js-nuke-readiness.md` blocker #12.

## Ground rules
- **Crystal TypeScript only.** Read legacy JS for behavior, re-express — do not import it.
- End green: `npx tsc --noEmit`, `npm run test:crystal` + `test:hermetic`, docs-drift gate. No `Co-Authored-By`. Prefer `fix:`.

## Owner intent (READ THIS — it reframes the old ledger)
- **OpenAI is first-class and stays.** It gives us three capabilities we want: **chat inference**,
  **image generation**, and **image editing**. The current cursor only does chat + image-gen — **editing is missing**.
- **HuggingFace is DROPPED, not wired.** The old `HuggingFaceCursor` was a Gradio-Space **monkey-patch**
  that spent from the owner's *personal* HF account and was credit-capped. Do **not** wire it. Delete it (see Teardown).
- **We will add more OpenAI-*like* inference providers** — **OpenRouter** is the next one, then others.
  The whole point of #12: adding a provider should be **adding a descriptor + env key**, not writing a new `Cursor`.
- **This backs the Concierge.** Expect high-volume multi-turn chat through it. So: real token→cost metering,
  clean `messages[]` handling, model routing, and a conscious decision on streaming (below) all matter.

## How execution resolves today (the seam you're extending)
- A `Modus` names its runner by string: `Modus.ministerium` (`src/types/modus.ts:169`). Examples in
  `src/crystal/seeds/modi.ts`: `MODUS_CHATGPT` + `MODUS_DALLE_III` use `ministerium: 'openai'`;
  `MODUS_JOYCAPTION` uses `'huggingface'` (to be dropped).
- `Cursorum.resolve(modus)` looks up `registry.get(modus.ministerium)` (`src/crystal/SimpleCursorum.ts`).
  Registration is one line in `src/container.ts` (`cursorum.register('openai', new OpenAICursor(...))`, ~`:541`).
- A `Cursor` (`src/types/cursus.ts`) is two methods:
  - `reserve(modus, aditus): Promise<bigint>` — upper-bound impetus known before dispatch (today: `modus.impetusFixum ?? 0n`).
  - `run(actum, modo?): Promise<CursorResult>` — `{kind:'sync', exitus:{ exitus, impetus }}` or `{kind:'async', externusJobId}`.
    Invariant: `run().impetus ≤ reserve()`.
- **Current `OpenAICursor`** (`src/crystal/OpenAICursor.ts`): branches on aditus shape (`size`/`quality`
  present → image, else chat), calls an injected `{ chat, image }` client, and returns **`impetus: 0n`**
  (no real cost). The real client is built in `src/index.ts:338` from the `openai` SDK (`OPENAI_API_KEY`).
- Modi declare typed `aditus`/`exitus` Forma (`modi.ts`); the exitus is schema-keyed (DALL·E → `{ image }`,
  ChatGPT → `{ response }`). Keep that contract.

## Design — a declarative `ApiCursor`
Build **one** `ApiCursor implements Cursor`, driven by a **provider descriptor** (data). Register the same
cursor under each provider's `ministerium` key, bound to that provider's descriptor.

1. **Provider descriptor** (`src/crystal/apiProviders.ts` or a types file). Something like:
   ```ts
   interface ApiProvider {
     id: string                       // 'openai' | 'openrouter' | …  (== ministerium)
     baseUrl: string                  // 'https://api.openai.com/v1'
     authEnv: string                  // env var holding the key ('OPENAI_API_KEY')
     capabilities: {                  // which of these the provider serves
       chat?: { path: string; defaultModel: string }        // OpenAI-compatible /chat/completions
       image?: { path: string; defaultModel: string }
       imageEdit?: { path: string; defaultModel: string }
     }
     pricing: { /* token/image → impetus rate; see cost metering */ }
   }
   ```
   **Key insight:** OpenAI, OpenRouter, and most inference vendors speak the **same
   OpenAI-compatible `/chat/completions` wire format**. So "OpenAI-compatible chat" is the primary shape;
   image-gen/edit are OpenAI-specific capabilities a descriptor opts into. Prefer a small `fetch` against
   `baseUrl`+`authEnv` for the generic path so OpenRouter is a pure descriptor add. (You *may* keep the
   `openai` SDK for the OpenAI descriptor if cleaner — but don't let SDK-shape leak into the generic cursor.)

2. **Capability dispatch, not aditus-sniffing.** Today the cursor guesses image-vs-chat from aditus keys.
   Prefer an explicit capability on the modus (e.g. an `aditus.__capability` or a small `Modus` field
   `apiCapability?: 'chat'|'image'|'imageEdit'`) so DALL·E vs ChatGPT vs edit is declared, not inferred.
   Decide and note it; if you keep sniffing, at least make `imageEdit` (has an input `image` + prompt) unambiguous.

3. **Add image editing.** OpenAI `images.edit` (a.k.a. gpt-image edit): input image (+ optional mask) + prompt
   → edited image URL. New modus `MODUS_GPT_IMAGE_EDIT` (`ministerium: 'openai'`, capability `imageEdit`,
   `aditus: { image: image, prompt: text, mask?: image }`, `exitus: { image }`). **This also closes the
   `imageEdit`/gpt-image-compose VERIFY seam** the ledger flagged.

4. **Real cost metering (matters for the Concierge).** Stop returning `impetus: 0n`. `reserve()` = the
   modus's `impetusFixum` upper bound. `run()` = actual from provider `usage` (chat: `total_tokens × rate`;
   image: per-image rate) — clamped to `≤ reserve()`. Put the rate in the descriptor's `pricing`. The
   Concierge will fan out many chat calls, so under-charging here leaks money.

5. **Streaming — a conscious decision (Concierge-critical).** The run rail is sync/async; SSE run-progress
   is already handled by `RunEventHub`. The Concierge wants **token streaming**. Two clean options —
   **pick one and document it in the handoff's "decisions" note:**
   - (a) **Cursor stays sync** (returns the full completion + real usage); the Concierge owns its own
     streaming chat session directly against the provider for the interactive path, and only *settles*
     through a run when it commits work. Simplest; keeps the ledger clean.
   - (b) **Cursor emits `progressus` deltas** (token chunks) through the bus so `/v1/runs/:id/stream`
     carries them. More plumbing; unifies the surface. Recommend (a) unless the Concierge spec needs (b).

## Wiring
- `src/container.ts`: replace the `OpenAICursor` registration. Build the descriptor set from env
  (OpenAI if `OPENAI_API_KEY`; OpenRouter if `OPENROUTER_API_KEY`), and for each present provider
  `cursorum.register(provider.id, new ApiCursor(provider, httpDeps))`. Keep `ministerium: 'openai'` working
  so the existing seeded modi don't move.
- `src/index.ts:338`: the `openaiClient` block becomes provider config (baseUrl/key) instead of an SDK-shaped
  `{chat, image}` closure — or keep the SDK for OpenAI and pass descriptors for the rest. Your call; note it.
- Re-seed `src/crystal/seeds/modi.ts`: keep `MODUS_CHATGPT`/`MODUS_DALLE_III` (same `ministerium: 'openai'`),
  add `MODUS_GPT_IMAGE_EDIT`, and add an OpenRouter chat modus (e.g. `MODUS_OPENROUTER_CHAT`,
  `ministerium: 'openrouter'`) to prove the descriptor generalizes with zero cursor code.

## Teardown (part of this blocker — the DROP half of #5)
- Delete `src/crystal/HuggingFaceCursor.ts` + its container registration (`container.ts:545`, the
  `if (config.huggingfaceClient)` block) + the `huggingfaceClient` field on `ContainerConfig`.
- `MODUS_JOYCAPTION` (`ministerium: 'huggingface'`) — **drop it** (ledger #6: dataset captioning is done by
  the training modus). If you'd rather retain captioning, re-home it onto a real API provider descriptor later;
  do **not** keep the HF Gradio path alive. Remove it from the seed export list either way.
- Grep for other `ministerium: 'huggingface'` seeds before deleting the cursor so nothing dangles.

## Acceptance
- OpenAI chat, image-gen, and **image-edit** all run through the single `ApiCursor` via descriptors; the
  existing `MODUS_CHATGPT`/`MODUS_DALLE_III` still resolve (unchanged `ministerium`).
- Adding **OpenRouter chat** is a descriptor + env key + one seed — **no new cursor class**. Prove it with the seed.
- `run()` returns **real impetus** from provider usage (not `0n`), `≤ reserve()`.
- HuggingFace cursor + JoyCaption HF modus are gone; `tsc`/tests green with no dangling `'huggingface'` ministerium.
- Streaming decision documented; image-edit modus closes the `imageEdit` VERIFY seam.
- Hermetic tests (fake HTTP/provider, no network): capability dispatch (chat/image/edit), response→exitus
  mapping per schema, usage→impetus metering + `≤ reserve()` clamp, unknown-provider/absent-key behavior,
  and the OpenRouter-via-descriptor path.

## Decisions (as built — 2026-07-02)
- **Streaming: option (a) — the cursor stays SYNC.** `ApiCursor.run()` returns the full completion
  plus real usage-metered impetus. The Concierge owns its own token-streaming chat session directly
  against the provider for the interactive path, and only *settles* through a run when it commits
  work. Kept the ledger clean and the run rail simple; no `progressus` delta plumbing. (See the
  streaming note at the top of `src/crystal/ApiCursor.ts`.)
- **Capability dispatch is declared, not sniffed:** each modus stamps a hidden `aditus.__capability`
  (`'chat' | 'image' | 'imageEdit'`), mirroring the old `__spaceUrl` routing-key convention. Chosen
  over a `Modus` field because `Cursor.run(actum, modo?)` does not receive the `Modus` — the capability
  has to travel on the Actum. Absent → defaults to `'chat'`.
- **Metering:** chat = `ceil(total_tokens × chatImpetusPer1kTokens / 1000)`; image = `perImage × n`.
  Both clamped to the reservation (`actum.impetus`, which `ActumInceptor` sets = `reserve()`), so the
  `run().impetus ≤ reserve()` invariant holds. Rates live in each descriptor's `pricing`.
- **Reserve value at run-time:** taken from `actum.impetus` (the locked reservation) — `run()` has no
  `Modus`, so this is how the clamp knows the cap.

## What shipped
- `src/crystal/apiProviders.ts` — `ApiProvider` descriptor + `OPENAI_PROVIDER` (chat/image/imageEdit)
  and `OPENROUTER_PROVIDER` (chat only). `API_PROVIDERS` is the registry the container walks.
- `src/crystal/ApiCursor.ts` — the ONE cursor + the injected `ApiHttp` transport (`httpApiTransport`
  = thin `fetch`, no SDK). Image-edit builds a multipart form from an injected `MediaFetcher`.
- Seeds: `MODUS_CHATGPT`/`MODUS_DALLE_III` keep `ministerium: 'openai'` (+ `__capability`), new
  `MODUS_GPT_IMAGE_EDIT` (closes the imageEdit VERIFY seam) and `MODUS_OPENROUTER_CHAT` (proves the
  descriptor generalizes with zero cursor code). `MODUS_JOYCAPTION` dropped.
- Teardown: `OpenAICursor.ts` + `HuggingFaceCursor.ts` (+ their tests) deleted; `openaiClient` /
  `huggingfaceClient` `ContainerConfig` fields replaced by `apiProviders`; unused top-level `openai`
  SDK import removed from `index.ts`. No `ministerium: 'huggingface'` seed remains. (The `openai` npm
  dependency is now unused but left in `package.json` to avoid a lockfile churn outside this blocker.)
- Green: `tsc --noEmit`, `test:hermetic` (859), `test:crystal` (the one failure —
  `MongoIntella.test.ts › shim: triggerMap() finds v2 PRIVATE record`— is pre-existing branch state,
  unrelated to this diff).

## Pointers
- `src/crystal/OpenAICursor.ts` (the thing you generalize), `src/types/cursus.ts` (`Cursor`/`CursorResult`/`Exitus`).
- `src/crystal/SimpleCursorum.ts` + `src/execution/Cursorum.ts` (`ministerium` resolution).
- `src/container.ts` (~`:541` register block, `:545` HF block to delete), `src/index.ts:338` (client config).
- `src/crystal/seeds/modi.ts` (modi shapes; `MODUS_CHATGPT`/`MODUS_DALLE_III`/`MODUS_JOYCAPTION`), `src/types/modus.ts:169` (`ministerium`).
- Concierge context: memory `project_concierge_flows`. Ledger: `docs/plans/2026-07-02-js-nuke-readiness.md` (#12).
