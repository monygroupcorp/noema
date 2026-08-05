# Phase 7a Agent Specification

**Working directory:** `/Users/lifehaver/make/noema-crystal`  
**Test runner:** `npm run test:unit` (tsx --test)  
**TDD discipline:** Write failing test → confirm failure → implement → green.

---

## Read these files before writing anything

- `src/flow/types.ts`
- `src/flow/flows/ExecuteFlow.ts` (all 379 lines)
- `src/allocutio/TelegramAllocutio.ts`
- `src/index.ts`
- `docs/phase-7a-telegram-design.md`

---

## Deliverable 1 — `src/allocutio/telegram/utils.ts`

Create this file. It is the single source of MarkdownV2 escaping for the
entire Telegram surface. No other file may escape inline.

```typescript
/**
 * Escape all Telegram MarkdownV2 special characters.
 * Must be applied to every user-supplied or DB-sourced string
 * before embedding in a MarkdownV2 message.
 * Content inside backtick code spans does NOT need this.
 */
export function escapeMarkdownV2(text: string): string {
  // Official special chars per Telegram Bot API docs:
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

/**
 * Format a wallet address for display: first 6 + last 4 chars.
 * "0xDEADBEEF...BEEF" — always 12 visible chars + ellipsis.
 */
export function abbreviateAddress(address: string): string {
  return address.slice(0, 6) + '...' + address.slice(-4)
}
```

**Tests:** `tests/unit/allocutio/telegram/utils.test.ts`

Test every special character is escaped:
- `_ * [ ] ( ) ~ \` > # + - = | { } . ! \\` — each must become `\char`
- Normal alphanumeric text passes through unchanged
- `abbreviateAddress('0x1234567890abcdef')` → `'0x1234...cdef'`

---

## Deliverable 2 — `src/allocutio/telegram/tokenMap.ts`

Telegram callback_data limit is 64 bytes. Complex session keys exceed this.
Use short opaque tokens mapped to full session keys.

```typescript
/**
 * TokenMap — maps short random tokens to arbitrary session keys.
 * Tokens are 8 hex chars (4 bytes). Collision probability negligible
 * for the number of concurrent live sessions.
 */
export class TokenMap {
  private readonly map = new Map<string, string>()

  /** Store a session key, return an 8-char token. */
  encode(sessionKey: string): string

  /** Retrieve the session key for a token. Returns null if unknown/expired. */
  decode(token: string): string | null

  /** Remove a token after it has been used or session expires. */
  revoke(token: string): void
}
```

Use `crypto.randomBytes(4).toString('hex')` for token generation.

**Tests:** `tests/unit/allocutio/telegram/tokenMap.test.ts`

- `encode` returns 8-char hex string
- `decode(encode(key))` returns original key
- `decode` of unknown token returns null
- `revoke` makes token unknown
- Two calls to `encode` with same key return different tokens (different random)

---

## Deliverable 3 — Add `Result` to `src/flow/types.ts`

Add to the `Primitive` union (after `Stream`):

```typescript
| {
    kind: 'Result'
    actumId: string
    /** Tool name for display */
    label: string
    /** Output media files, if any */
    media?: Array<{
      url: string
      type: 'image' | 'video' | 'audio' | 'document'
      /** User's original prompt — raw, unescaped. Adapter escapes at render time. */
      caption?: string
    }>
    /** Text output (chatgpt, caption, etc.) — raw, unescaped */
    textContent?: string
    /** Action buttons. Standard set: rate_beautiful, rate_funny, rate_negative,
     *  info, tweak, rerun. Adapter renders these as the delivery keyboard. */
    actions: Array<{ id: string; label: string }>
  }
```

Add to `PrimitiveEvent` union:

```typescript
| { kind: 'result_action'; actumId: string; actionId: string }
```

No test file needed for the type change itself — the ExecuteFlow and
TelegramAllocutio tests will cover it.

---

## Deliverable 4 — Update `ExecuteFlow._buildResultStep`

Replace the current `_buildResultStep` (line 341) that emits a `Detail`
primitive with one that emits a `Result` primitive.

The current signature is:
```typescript
private _buildResultStep(result: Record<string, unknown>): Step
```

Keep the signature. Change the body:

```typescript
private _buildResultStep(result: Record<string, unknown>): Step {
  // Detect media URLs by key convention: keys ending in 'Url', 'url', or 'imageUrl'
  const mediaEntries = Object.entries(result).filter(([k]) =>
    k.toLowerCase().endsWith('url')
  )

  const media = mediaEntries.map(([k, v]) => ({
    url: String(v),
    type: k.toLowerCase().includes('video') ? 'video' as const
        : k.toLowerCase().includes('audio') ? 'audio' as const
        : 'image' as const,
  }))

  // Text content: anything that is not a URL
  const textEntries = Object.entries(result).filter(([k]) =>
    !k.toLowerCase().endsWith('url')
  )
  const textContent = textEntries.length > 0
    ? textEntries.map(([k, v]) => `${k}: ${String(v)}`).join('\n')
    : undefined

  return {
    primitives: [{
      kind: 'Result',
      actumId: '',            // caller should set this — see note below
      label: 'Result',
      media: media.length > 0 ? media : undefined,
      textContent,
      actions: [
        { id: 'rate_beautiful', label: '😻' },
        { id: 'rate_funny',     label: '😹' },
        { id: 'rate_negative',  label: '😿' },
        { id: 'info',           label: 'ℹ' },
        { id: 'tweak',          label: '✎ Tweak' },
        { id: 'rerun',          label: '↻ Rerun' },
      ],
    }],
  }
}
```

**Also fix the two callers** that call `_buildResultStep` to pass `actumId`
through into the Result primitive. The easiest way: add `actumId: string` as a
second param to `_buildResultStep`, set it on the primitive, update both callers
(lines ~269 and ~130) to pass `actum.id` or `state.actumId`.

**Tests:** Add to existing `tests/unit/flow/ExecuteFlow.test.ts`:
- Sync completion emits a `Result` primitive (not `Detail`)
- Result primitive has expected action ids
- Result primitive has `actumId` set to the actum's id
- Media URL detection: key `imageUrl` → `type: 'image'`, key `videoUrl` → `type: 'video'`
- Text content: non-URL result keys appear in `textContent`

---

## Deliverable 5 — `TelegramAllocutio` updates

All changes are to `src/allocutio/TelegramAllocutio.ts`.

### 5a — `botStartupTime` parameter

Add to constructor deps:
```typescript
/** Unix ms timestamp of bot startup. Messages older than this are dropped. */
botStartupTime?: number
```

In `_handleMessage`, add at the top before any processing:
```typescript
if (this.deps.botStartupTime !== undefined) {
  if ((message.date * 1000) < this.deps.botStartupTime) return
}
```

### 5b — `_react` method

```typescript
private async _react(chatId: number, messageId: number, emoji: string): Promise<void> {
  try {
    await (this.sender as unknown as {
      setMessageReaction?(chatId: number, messageId: number, reaction: unknown[]): Promise<void>
    }).setMessageReaction?.(chatId, messageId, [{ type: 'emoji', emoji }])
  } catch {
    // Reactions are decorative — swallow all errors silently
  }
}
```

Call `_react(chatId, messageId, '🤔')` at the top of `_handleCommand` (after
storing chatId, before routing). Call `_react(chatId, messageId, '👌')` when
`router.enter` or `router.handle` resolves without error. The error boundary in
`receive()` handles `😨` on any thrown exception — add the reaction there:

```typescript
} catch (err) {
  console.error('TelegramAllocutio error:', err)
  if (chatId) {
    void this._react(chatId, /* messageId */ ..., '😨')  // need to track messageId in scope
    await this.sender.sendMessage(chatId, 'Something went wrong. Please try again.').catch(() => {})
  }
}
```

To make `😨` work, `receive()` needs to track `messageId` in scope. Add:
```typescript
const messageId = update.message?.message_id ?? update.callback_query?.message?.message_id
```

### 5c — Photo message handling

In `_handleMessage`, after the `text.startsWith('/')` block:

```typescript
// Photo message while flow active → resolve file URL → prompt event
if (message.photo && message.photo.length > 0) {
  if (this.router.hasContext('telegram', userId)) {
    const largest = message.photo[message.photo.length - 1]  // highest res
    const fileUrl = await this._resolveFileUrl(largest.file_id)
    if (fileUrl) {
      await this.router.handle('telegram', userId, { kind: 'prompt', text: fileUrl })
    }
  }
  return
}
```

Add `_resolveFileUrl`:
```typescript
private async _resolveFileUrl(fileId: string): Promise<string | null> {
  try {
    return await (this.sender as unknown as { getFileLink(fileId: string): Promise<string> })
      .getFileLink(fileId)
  } catch {
    return null
  }
}
```

### 5d — `Result` primitive rendering

Add a case to `renderPrimitive` for `kind: 'Result'`:

```typescript
case 'Result': {
  // Delivery keyboard: two rows
  // Row 1: rate buttons
  // Row 2: –  ℹ  ✎ Tweak  ↻ Rerun
  // Token-encode actumId for callback_data (may exceed 64 bytes raw)
  // Actual media sending happens in _handleStep, not renderPrimitive
  // renderPrimitive just returns the keyboard and a status text
  const rateRow = primitive.actions
    .filter(a => a.id.startsWith('rate_'))
    .map(a => btn(a.label, `ra:${primitive.actumId}:${a.id.replace('rate_', '')}`))

  const actionRow = primitive.actions
    .filter(a => !a.id.startsWith('rate_'))
    .map(a => btn(a.label, `a:${a.id}:${primitive.actumId}`))

  const text = primitive.textContent
    ? primitive.textContent
    : primitive.media?.length
      ? primitive.label
      : 'Done.'

  return {
    text,
    extra: { reply_markup: inlineKeyboard([rateRow, actionRow]) },
  }
}
```

**Override `_handleStep` for Result primitives** — media must be sent via
`sendPhoto`/`sendVideo`, not `sendMessage`. Add special handling before the
`renderPrimitive` loop:

```typescript
private async _handleStep(ctx: FlowContext, step: Step): Promise<void> {
  const chatId = this._getChatId(ctx)
  if (chatId === null) return

  for (const primitive of step.primitives) {
    if (primitive.kind === 'Result') {
      await this._sendResult(chatId, primitive)
      continue
    }
    const { text, extra } = renderPrimitive(primitive)
    await this.sender.sendMessage(chatId, text, extra)
  }
}
```

Add `_sendResult`:

```typescript
private async _sendResult(
  chatId: number,
  primitive: Extract<Primitive, { kind: 'Result' }>
): Promise<void> {
  const { text: keyboardText, extra } = renderPrimitive(primitive)

  if (!primitive.media || primitive.media.length === 0) {
    // Text-only result (chatgpt, caption, etc.)
    await this.sender.sendMessage(chatId, keyboardText, extra)
    return
  }

  if (primitive.media.length === 1) {
    const m = primitive.media[0]
    try {
      if (m.type === 'image') {
        await (this.sender as unknown as {
          sendPhoto(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
        }).sendPhoto(chatId, m.url, { caption: m.caption, ...extra })
      } else if (m.type === 'video') {
        await (this.sender as unknown as {
          sendVideo(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
        }).sendVideo(chatId, m.url, { caption: m.caption, ...extra })
      } else {
        await (this.sender as unknown as {
          sendDocument(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
        }).sendDocument(chatId, m.url, { caption: m.caption, ...extra })
      }
    } catch {
      // Fallback: send URL as text (no send-file permission, too large, etc.)
      await this.sender.sendMessage(chatId, m.url, extra)
    }
    return
  }

  // Multiple media: sendMediaGroup (no inline keyboard support), then keyboard as text
  try {
    const media = primitive.media.map((m, i) => ({
      type: m.type === 'video' ? 'video' : 'photo',
      media: m.url,
      caption: i === 0 ? m.caption : undefined,
    }))
    await (this.sender as unknown as {
      sendMediaGroup(chatId: number, media: unknown[]): Promise<void>
    }).sendMediaGroup(chatId, media)
  } catch {
    // Fallback: send each URL as text
    for (const m of primitive.media) {
      await this.sender.sendMessage(chatId, m.url).catch(() => {})
    }
  }
  // Send keyboard as follow-up text message (Telegram limitation)
  await this.sender.sendMessage(chatId, '—', extra)
}
```

### 5e — New callback_data prefixes

Add to `decodeCallbackData`:

```typescript
// Result action: ra:actumId:ratingType
if (data.startsWith('ra:')) {
  const [, actumId, ratingType] = data.split(':')
  return { kind: 'result_action', actumId, actionId: `rate_${ratingType}` }
}

// Generic result action: a:actionId:actumId (already handled by existing 'a:' prefix)
// Extend existing 'a:' decode to handle result actions
// If actionId is 'info', 'tweak', or 'rerun', include actumId
if (data.startsWith('a:')) {
  const parts = data.split(':')
  const actionId = parts[1]
  const actumId = parts[2]
  if (actumId) return { kind: 'result_action', actumId, actionId }
  return { kind: 'action', actionId }
}
```

**Tests:** `tests/unit/allocutio/TelegramAllocutio.test.ts` — add:

- `botStartupTime` filters stale messages (message.date × 1000 < startupTime → no-op)
- Photo message while flow active → router.handle called with `{ kind: 'prompt', text: '<url>' }`
- Photo message with no active flow → no-op
- `Result` primitive with textContent → `sendMessage` called
- `Result` primitive with single image → `sendPhoto` called; falls back to `sendMessage` on error
- `Result` primitive with multiple images → `sendMediaGroup` called + follow-up `sendMessage` for keyboard
- Reaction `_react` called with 🤔 on command receipt
- Stale message (date < botStartupTime) is silently dropped

---

## Deliverable 6 — `src/index.ts` updates

### 6a — botStartupTime

```typescript
const botStartupTime = Date.now()
```

Set before MongoDB connect. Pass to `TelegramAllocutio`:

```typescript
const allocutio = new TelegramAllocutio({
  router: routerDeps,
  sender: tgBot.telegram,
  identity: identityResolver,
  botStartupTime,
})
```

### 6b — OpenAI client

```typescript
import OpenAI from 'openai'

// After ring creation:
if (process.env.OPENAI_API_KEY) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  ring = createContainer(mongo, {
    ...existingConfig,
    openaiClient: {
      chat: async (params) => {
        const res = await openai.chat.completions.create({
          model: params.model,
          messages: params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature: params.temperature,
        })
        return {
          content: res.choices[0]?.message?.content ?? '',
          usage: { total_tokens: res.usage?.total_tokens },
        }
      },
      image: async (params) => {
        const res = await openai.images.generate({
          model: params.model,
          prompt: params.prompt,
          size: params.size as OpenAI.ImageGenerateParams['size'],
          quality: params.quality as OpenAI.ImageGenerateParams['quality'],
          n: params.n,
        })
        return { url: res.data[0]?.url ?? '' }
      },
    },
  })
}
```

Note: `createContainer` is called once. Move OpenAI wiring before the
`createContainer` call so the client is passed in config. If `OPENAI_API_KEY`
is absent, the `openai` cursor simply isn't registered (existing behaviour).

### 6c — Blue-green polling handoff

Replace the simple `tgBot.launch()` call with:

```typescript
if (TELEGRAM_WEBHOOK_URL) {
  await tgBot.telegram.setWebhook(`${TELEGRAM_WEBHOOK_URL}/telegram`)
  app.use(tgBot.webhookCallback('/telegram'))
} else {
  let pollingRestartInProgress = false
  let consecutivePollingErrors = 0

  tgBot.telegram.callApi = tgBot.telegram.callApi  // no-op, just noting the API exists

  // Launch polling
  await tgBot.launch({
    allowedUpdates: ['message', 'callback_query'],
  })

  tgBot.catch((err: unknown) => {
    const status = (err as { response?: { error_code?: number } })?.response?.error_code

    if (status === 409) {
      console.warn('[Bot] 409 conflict — concurrent instance. Backing off 50s.')
      if (!pollingRestartInProgress) {
        pollingRestartInProgress = true
        consecutivePollingErrors = 0
        setTimeout(async () => {
          pollingRestartInProgress = false
          await tgBot.launch({ allowedUpdates: ['message', 'callback_query'] })
            .catch(e => console.error('[Bot] Failed restart after 409:', e))
        }, 50_000)
      }
      return
    }

    consecutivePollingErrors++
    console.error(`[Bot] Polling error (${consecutivePollingErrors}):`, err)

    if (consecutivePollingErrors >= 5 && !pollingRestartInProgress) {
      pollingRestartInProgress = true
      consecutivePollingErrors = 0
      setTimeout(async () => {
        pollingRestartInProgress = false
        await tgBot.launch({ allowedUpdates: ['message', 'callback_query'] })
          .catch(e => console.error('[Bot] Failed restart after errors:', e))
      }, 5_000)
    }
  })
}
```

Note: verify the correct Telegraf v4 error hook API — it may be `bot.catch(handler)` not `tgBot.catch`. Read the Telegraf source if unsure.

---

## Run at the end

```
npm run test:unit
```

All existing tests must still pass. New tests must pass. Report final count.
