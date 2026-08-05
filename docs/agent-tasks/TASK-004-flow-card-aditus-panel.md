# TASK-004: The flow card — surface every `Porta`, execute when ready

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: the flow-card logic is unit-tested in `tests/unit/flow/ExecuteFlow.test.ts`,
  which this task adds to the hermetic gate. **Save-as is out of scope** — TASK-005, gated on persistence.)

Today a flow only ever collects `prompt` (Telegram renders the `Form` primitive as a single text
prompt for the first unfilled required field). But every `Modus.aditus` is a `Forma` of typed `Porta`e
(`{type,required,default,label,description}`), and `ExecuteFlow._buildConfigureStep` already computes
the full field list. This task surfaces all of it. See ADR-0003 (the param surface is `Modus.aditus`;
the simple verb is the degenerate case) and ADR-0004.

## Interaction model (the durable contract — honor this)

Two entry paths, **one underlying aditus-collection state** (`CONFIGURE`), differing only in presentation:

- **Hot entry** — `<verb> <prompt>` / `/run <flow> <prompt>` (aditus arrives non-empty). Fill what was
  given; if **required** Portae remain (a second prompt, an input image, …), collect them with
  **sequential follow-up reply messages**, one field at a time. When all required are satisfied →
  execute. (This is today's behavior, extended to walk *all* required fields, not just the first.)
- **Cold entry** — bare `<verb>` or `/run <flow>` with nothing (aditus arrives empty `{}`). Drop into
  the **flow card**: a detail view listing every Porta (label + description + current/default value,
  required ones marked). Tweak any field. The **Execute button appears only once every required Porta
  has a value.**

**Editing a field === answering a follow-up prompt** — the same input mechanism (reply with the value;
send a photo for an `image` Porta). The card's per-field button just sets *which* field the next reply
fills; the hot path fills the next unfilled required automatically. One input path, two presentations.

**Image inputs come from the Telegram envelope, not only follow-up prompts** (the deprecated-bot UX —
this MUST be preserved). A command that accepts an image sources it, in priority order:
1. **A photo attached to the command message** — when a photo carries the command, Telegram puts the
   command in `message.caption`, a **different field from `message.text`**. The command must be read
   from *both* (`text ?? caption`), and the attached photo becomes the image input.
2. **The replied-to photo** — firing the command as a **reply to an image** (`reply_to_message.photo`)
   uses that image.
3. **A follow-up photo reply** — the card / gap-fill path (already exists, ~TelegramAllocutio.ts:499).

A captured entry image pre-fills the flow's `image` Porta, so it is **neither re-requested (gap-fill)
nor shown as unfilled (card)**. (Attached photo takes precedence over a replied-to one.)

## Read first
- `AGENTS.md`, `docs/adr/0003-verbs-bindings-saved-versions.md`, `docs/adr/0004-command-surface-and-mesh-modality.md`.
- `src/flow/flows/ExecuteFlow.ts` — `enter()` (the hot/cold/fast-path branch, ~95–152),
  `_buildConfigureStep` (~450), `_handleConfigure` (~249–289), `validateAditus` use (~265).
- `src/flow/types.ts` — the primitive union (`Form`, `Detail`, `Select`, …); the `Form` shape.
- `src/allocutio/telegram/telegramRender.ts` — how `Form` renders today (single-field prompt, ~71–77)
  and how `Detail`/`Select` render inline keyboards (the card will reuse these).
- `tests/unit/flow/ExecuteFlow.test.ts` — the existing flow unit tests (mocked deps, DB-free) — mirror
  this style; this is where the new card cases go.

## Deliverables
1. **Carry current values on the `Form` primitive.** Extend `Form` (in `src/flow/types.ts`) with
   `values?: Record<string, unknown>` (the current `aditus`) so the renderer can show each field's
   current-or-default value and compute "all required filled". A *field on an existing primitive*, not
   a new primitive (ADR-0001). `_buildConfigureStep` populates it from `state.aditus`.
2. **Cold entry → the card.** In `ExecuteFlow.enter()`: when `modusId` is set and `aditus` is **empty**,
   show the `Form` card (not a bare prompt). Non-empty-but-incomplete aditus keeps the sequential
   gap-fill path; all-required-satisfied keeps the fast-path submit. (Three branches: empty→card,
   partial→gap-fill, complete→execute.)
3. **Render the card** (`telegramRender.ts`): a `Form` with a non-empty `values` (or cold entry)
   renders as a card — a text body listing each Porta as `label — <value or default> [required]` with
   its description, plus an inline keyboard: one **edit button per field** (`a:edit_<key>`) and an
   **Execute button** (`a:execute`) that is **only present when every required Porta has a value**.
   When a flow has only one required field and nothing else worth showing, the single-prompt render may
   remain (don't regress `/make`'s one-field hot path).
4. **Field editing = reply mechanism.** Tapping `a:edit_<key>` sets an "editing field `<key>`" marker on
   state and shows a force-reply ("Reply with <label>" / "Send a photo for <label>" when `type:'image'`).
   The next inbound `prompt`/photo event fills **that** field (reuse the existing photo→fileUrl handler).
   `_handleConfigure` already merges a `prompt` event into the first unfilled required field — generalize
   it to honor the editing marker when set, else fall back to next-unfilled-required (the hot path).
5. **Execute.** `a:execute` validates via the existing `validateAditus(modus.aditus, state.aditus)` and
   submits exactly as the fast path does. Gap-fill auto-submits when the last required field is filled
   (today's behavior); the card requires the explicit Execute tap.
6. **Caption-borne commands** (`TelegramAllocutio._handleMessage`, ~475): read the command from
   `message.text ?? message.caption ?? ''` so a command typed as a photo's caption is dispatched
   (today `message.caption` is dropped, so `/effect …` on an attached photo is silently ignored).
7. **Capture an entry image** when dispatching a command: extract a photo from `message.photo`
   (attached) else `message.reply_to_message?.photo` (reply-to), resolve via the existing
   `_resolveFileUrl`, and thread it into command dispatch. Attached precedence over replied-to. (Leave
   the existing mid-flow photo→prompt handler at ~499 intact — that's the card/gap-fill photo reply.)
8. **Thread the entry image to the flow.** `_handleCommand` → `CommandRouter.dispatch` gains an optional
   `entryImageUrl`; the `/make`, `/run`, `/chat` (and future verb) handlers fold it into the
   `enterExecute` state (e.g. `state.entryImageUrl`). A *parameter*, not new vocabulary.
9. **Map the entry image → the image Porta.** In `ExecuteFlow.enter`, after `_resolveModus`, if
   `state.entryImageUrl` is set and `modus.aditus` has a `type:'image'` Porta, assign it to the first
   such key (then the cold/hot/card logic treats that Porta as filled). No image Porta → ignore it.
10. **Add the flow tests to the hermetic gate.** In `package.json`, add the **DB-free** flow tests to
   `test:hermetic` (`tests/unit/flow/ExecuteFlow.test.ts`; also `FlowRouter.test.ts` /
   `FlowContextStore.test.ts` if DB-free). **Do NOT** add `MongoFlowContextStore.test.ts` (needs a DB).
   Verify the added files run green bare (no `.env`).

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, including the newly-gated flow tests, with NEW `ExecuteFlow.test.ts` cases:
  - **cold entry** (`{modusId, aditus:{}}`) → a `Form` step whose primitive lists *all* aditus fields and
    has **no** Execute action (a required field is unfilled).
  - **cold entry then fill the one required field** → the `Form` now exposes the Execute action.
  - **edit a specific optional field** (`a:edit_steps` then a `prompt` reply `8`) → `state.aditus.steps`
    becomes `8` (not the prompt field).
  - **hot entry, all required present** (`{modusId, aditus:{prompt:'a cat'}}` for a single-required flow)
    → fast-path submit, no card (regression guard for `/make a cat`).
  - **hot entry, a required field missing** (two-required fixture) → sequential prompt for the missing
    one, then submit (gap-fill still walks all required).
  - **execute gating** → `a:execute` with a required field still empty does NOT submit (validation rejects).
  - **caption command** (`TelegramAllocutio.test.ts`, hermetic) → a photo message whose **caption** is
    `/run <flow> …` dispatches the command (today it is ignored because only `text` is read).
  - **attached image fills the image Porta** → command + attached photo, on an image-Porta flow → that
    Porta is pre-filled (`state.entryImageUrl` mapped); a flow with only that image required → no gap-fill.
  - **reply-to image** → a `/effect …` text command replying to a photo → the image Porta is filled from
    `reply_to_message.photo`.
  - **image provided → not re-requested** → with the image Porta seeded, gap-fill/card asks only for the
    *other* missing required fields.

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Out of scope (do NOT do — follow-ons / separate specs)
- **Save-as → TASK-005** (the card's "save as canon verb" / "save as my flow" buttons). It needs the
  persistence layer from ADR-0003 (widen `Modus.auctor` to `{animaId}|{commitment}`; register a derived
  Modus; the `bindVerb` store). Design the card to *leave room* for these buttons, but do not build them.
- Numeric **steppers** (−/+ for `int`/`float`). First cut uses the uniform reply mechanism for every
  type; steppers are a later enhancement (mirror the warm-window stepper, commit `e72b6019`).
- `select`/enum Portae — `Porta` has no `options` field today; not in scope.
- Real generation / studio provisioning — unchanged, handled downstream.
