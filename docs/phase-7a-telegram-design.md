# Phase 7a — Telegram Platform Design Notes

**Date:** 2026-05-12  
**Status:** Pre-build reference. Update as decisions are made.

---

## MarkdownV2 — The Hard Part

MarkdownV2 is the single most failure-prone surface in the Telegram platform.
The Telegram API rejects any message where a special character is unescaped,
and the failure is silent from the user's perspective — they just see nothing,
or an error they can't act on.

**Special characters that must be escaped:**
`_ * [ ] ( ) ~ ` > # + - = | { } . !`

**Known broken screens (as of 2026-05-12):**
- Mod menu model detail pages — display incorrectly due to unescaped chars in model names/descriptions
- Some delivery captions — user prompt text is passed through without escaping

**Known correct screens (use as reference implementation):**
- Account menu — markdown is correct, use this as the gold standard
- Wallet linking instructions — correctly escaped

**Rules:**
1. Every string that comes from user input, a database field, a model name,
   or any external source MUST be passed through `escapeMarkdownV2()` before
   being embedded in a MarkdownV2 message.
2. Code spans (backtick blocks) do NOT need escaping inside them.
3. Bold (`*text*`) and italic (`_text_`) delimiters must be balanced and their
   contents escaped.
4. Build one canonical `escapeMarkdownV2(text: string): string` utility in
   `src/allocutio/telegram/utils.ts`. No inline escaping anywhere else.
5. Every rendered message in TelegramAllocutio goes through a single
   `renderMarkdown(parts)` builder that enforces escaping at composition time,
   not at call sites.

**Future:** Build a Telegram Mini App (WebApp button) so complex UIs can live
in HTML/CSS rather than fighting MarkdownV2. Not in scope for Phase 7a.

---

## Settings — `/set <tool> <key>=<value>`

**Old pattern (retire):** `/settings` → pick tool from list → pick param → reply with value.
Three round trips for a single preference change.

**New pattern:**
```
/set make height=1024
/set make seed=42 steps=20
/set dalle size=1024x1024
```

- `/set` with no args → show all tools with saved preferences (one-screen summary)
- `/set <tool>` → show that tool's current preferences with inline edit buttons
- `/set <tool> <key>=<value> ...` → apply immediately, confirm with 👌 reaction

`<tool>` matches by prefix or fuzzy (same Levenshtein logic as batch command).
Invalid key → reply with valid keys for that tool.
Invalid value → reply with expected type/range.

This replaces `settingsMenuManager.js` entirely. No menu tree needed.

---

## Tweak Sessions

Tweak sessions are important and must survive bot restarts.

**Old problem:** Tweak state was in-memory (tokenToSessionKey Map). Bot restart
lost all in-progress tweaks. The spell/tool distinction also caused confusion —
tweaks on a composed spell had different behavior than tweaks on an atomic tool,
and the UI didn't communicate which you were in.

**New design:**
- Tweak state lives in `FlowContext.state` (persisted in `MemoryFlowContextStore`,
  future: `MongoFlowContextStore`).
- A `TweakFlow` (or a TWEAK step inside ExecuteFlow) manages the session.
- No distinction between tool and spell at the UX level — user sees params,
  edits them, reruns. The crystal handles whether it's atomicus or compositus.
- Token map for callback_data is still needed (64 byte limit). Keep the
  `uuidv4().split('-')[0]` short-token pattern, but store the session in
  FlowContext rather than a plain Map.

---

## Delivery Primitive — `Result`

The `Stream` primitive (status indicator) and the `Result` primitive (completed
generation delivery) are two different things. Phase 7a adds `Result`.

**`Result` primitive shape:**
```typescript
{
  kind: 'Result'
  actumId: string
  label: string          // tool name
  media?: {
    url: string
    type: 'image' | 'video' | 'audio' | 'document'
    caption?: string     // user's original prompt, escaped
  }[]
  textContent?: string   // for text-only results (chatgpt, caption)
  actions: Array<{ id: string; label: string }>  // rerun, rate, tweak, info
}
```

**Standard delivery actions:**
```
Row 1:  [😻 Beautiful]  [😹 Funny]  [😿 Nope]
Row 2:  [–]  [ℹ Info]  [✎ Tweak]  [↻ Rerun]
```

**Media group edge cases (must handle):**
1. Single image → `sendPhoto` with inline keyboard attached directly.
2. Multiple images → `sendMediaGroup` (Telegram does NOT support inline keyboards
   on media groups). Send the keyboard as a separate follow-up text message
   immediately after the group.
3. Video → `sendVideo`. Same keyboard rule as single image.
4. Groups without send-file permission → bot may lack permission to send files
   in a group chat. Fallback: send URL as text with inline keyboard. Log the
   permission error, do not crash.
5. File too large for Telegram (>50MB photos, >2GB video) → send URL as text link.
6. Caption length limit (1024 chars for sendPhoto, 4096 for sendMessage) →
   truncate user prompt in caption, send full prompt in follow-up text if needed.

**MarkdownV2 in delivery:**
- User's original prompt must be escaped before embedding in caption.
- Tool name, model name, any DB-sourced string must be escaped.
- Captions use MarkdownV2 only if content is known-safe. Plain text (`parse_mode`
  omitted) is the safe default for captions that contain user input.

---

## Reaction Sequence

Standard lifecycle reactions on the originating message:

```
🤔  on receive — "I got this, working on it"
👌  on execution approved / job submitted to RunPod/OpenAI
😨  on error — always paired with a user-readable error message
```

These are reactions on `message.message_id`, not new messages. They use
`bot.setMessageReaction()` (Telegram Bot API 7.0+). If the API call fails
(bot lacks permission in group, or message too old), swallow silently — reactions
are decorative.

Permitted reaction emoji (Telegram API whitelist — do not use others):
```
👍 👎 ❤ 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮 💩 🙏 👌 🕊 🤡
🥱 🥴 😍 🐳 ❤‍🔥 🌚 🌭 💯 🤣 ⚡ 🍌 🏆 💔 🤨 😐 🍓 🍾 💋 🖕 😈
😴 😭 🤓 👻 👨‍💻 👀 🎃 🙈 😇 😨 🤝 ✍ 🤗 🫡 🎅 🎄 ☃ 💅 🤪 🗿
🆒 💘 🙉 🦄 😘 💊 🙊 😎 👾 🤷‍♂ 🤷 🤷‍♀ 😡
```

---

## Startup Message Filter

Drop any message where `message.date * 1000 < botStartupTime`.
`botStartupTime = Date.now()` set at the top of `main()` in `index.ts`.
Without this, a bot restart processes the entire Telegram update backlog
from while it was down.

---

## Blue-Green Polling Handoff

When deploying, both old and new containers poll the same token simultaneously.
Telegram returns 409 Conflict to the new container. Handle it:

```
409 received → log warn → stop polling → wait 50s → restart polling
```

50s is derived from: old container stop timeout (≤35s) + health check buffer.

On non-409 polling errors: count consecutive failures. At 5 consecutive → restart
polling after 5s. Reset count on any success.

`stopPolling()` has a 12s hard timeout (node-telegram-bot-api can hang).

---

## Input Collection — Prompt Primitive

The old `InputCollector` class (one-off in-memory state machine, 60s TTL per
input, cleanup on timeout) is replaced by the FlowEngine's `Prompt` primitive.

The Flow emits a `Prompt` primitive when it needs a value. TelegramAllocutio
renders it as a plain text message asking for input. The user's text reply
arrives as a `{ kind: 'prompt', text }` PrimitiveEvent routed to the active flow.

No separate TTL management needed — the FlowContext stores the pending state.
If the user never replies, the flow just sits until they do or `/cancel`.

For image inputs specifically: a photo message while a flow is active should
be treated as a `{ kind: 'prompt', text: '<telegram-file-url>' }` event with
the resolved file URL. TelegramAllocutio resolves the file URL via
`bot.getFileLink(fileId)` before dispatching to the router.

---

## Account Menu — Keep Structure, Improve Clarity

The account menu structure is correct. Its markdown is the reference
implementation. Simplify the information hierarchy:

```
*@username*

💳 Balance: 1,234 pts
🔗 Wallet: `0xDEAD...BEEF`

[Run History]  [Wallet]
[Settings]     [Referral]
```

Level/EXP bar stays:
```
Level 5  🟩🟩🟩⬜️⬜️⬜️⬜️
```
Formula: `level = Math.floor(Math.cbrt(totalExp))`, 7-block bar (1 fixed green + 6 variable).

---

## What We Are Not Building in Phase 7a

- Mods menu (LoRA/checkpoint browsing) — deferred to Phase 7b
- Batch command — deferred
- Spellbook flows — deferred
- Training flows — Phase 10
- Telegram Mini App — future
- Admin commands — deferred
