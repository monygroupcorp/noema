// =============================================================================
// TelegramAllocutio — Telegram platform adapter for FlowEngine
// =============================================================================
//
// Bridges raw Telegram webhook Update objects to FlowRouter.
// Handles command parsing, callback_query decoding, and primitive rendering.
// =============================================================================

import type { Primitive, Step, Resolution, FlowContext, Intent, Platform, AuctorKey, PrimitiveEvent } from '../flow/types.js'
import type { Allocutio, Nuntius, Responsum } from '../types/allocutio.js'
import type { Inceptio } from '../types/cursus.js'

// ---------------------------------------------------------------------------
// Telegram Update (minimal typing)
// ---------------------------------------------------------------------------

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; username?: string; first_name?: string }
    chat: { id: number; type: string }
    text?: string
    date: number
    photo?: Array<{ file_id: string; width: number; height: number }>
    reply_to_message?: { message_id: number }
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string; first_name?: string }
    message?: { message_id: number; chat: { id: number } }
    data?: string
  }
}

// ---------------------------------------------------------------------------
// TelegramSender — injected for testability
// ---------------------------------------------------------------------------

export interface TelegramSender {
  sendMessage(
    chatId: number,
    text: string,
    extra?: { reply_markup?: unknown }
  ): Promise<{ message_id: number }>
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    extra?: { reply_markup?: unknown }
  ): Promise<void>
  answerCallbackQuery(callbackQueryId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// IdentityResolver — maps Telegram user_id → AuctorKey
// ---------------------------------------------------------------------------

export interface IdentityResolver {
  resolve(telegramUserId: string): Promise<AuctorKey>
}

// ---------------------------------------------------------------------------
// RouterDeps — the subset of FlowRouter that TelegramAllocutio uses.
// This interface is used by tests so they can inject a mock without needing
// to instantiate a real FlowRouter (which requires a store + flows).
// ---------------------------------------------------------------------------

export interface RouterDeps {
  enter(
    intent: Intent,
    platform: Platform,
    userId: string,
    identity: AuctorKey,
    initialCtx?: Partial<{ modoId: string; messageId: string }> & { state?: unknown }
  ): Promise<void>
  handle(platform: Platform, userId: string, event: PrimitiveEvent): Promise<void>
  clear(platform: Platform, userId: string): void
  hasContext(platform: Platform, userId: string): boolean
  onStep(cb: (ctx: FlowContext, step: Step) => void): void
  onResolution(cb: (ctx: FlowContext, res: Resolution) => void): void
}

// ---------------------------------------------------------------------------
// Inline keyboard helpers
// ---------------------------------------------------------------------------

type InlineButton = { text: string; callback_data: string }
type InlineKeyboard = { inline_keyboard: InlineButton[][] }

function inlineKeyboard(rows: InlineButton[][]): InlineKeyboard {
  return { inline_keyboard: rows }
}

function btn(text: string, data: string): InlineButton {
  return { text, callback_data: data }
}

// ---------------------------------------------------------------------------
// renderPrimitive — Telegram rendering for each primitive kind
// ---------------------------------------------------------------------------

interface RenderResult {
  text: string
  extra?: { reply_markup?: InlineKeyboard }
}

function renderPrimitive(primitive: Primitive): RenderResult {
  switch (primitive.kind) {
    case 'Select': {
      const rows = primitive.options.map(opt => [btn(opt.label, `s:${opt.id}`)])
      return {
        text: primitive.label,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'MultiSelect': {
      const rows = primitive.options.map(opt => [btn(opt.label, `ms:${opt.id}`)])
      rows.push([btn('Done', 'ms:done')])
      return {
        text: primitive.label,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'Paginate': {
      const itemLines = primitive.items
        .map((item, i) => `${i + 1}. ${item.label}`)
        .join('\n')
      const text = `${primitive.label}\n\n${itemLines}\n\nPage ${primitive.page}/${primitive.totalPages}`
      const navRow: InlineButton[] = [btn('◀ Prev', 'pp'), btn('▶ Next', 'pn')]
      return {
        text,
        extra: { reply_markup: inlineKeyboard([navRow]) },
      }
    }

    case 'Confirm': {
      const text = `${primitive.label}\n\n${primitive.question}`
      const row: InlineButton[] = [btn('Yes', 'cy'), btn('No', 'cn')]
      return {
        text,
        extra: { reply_markup: inlineKeyboard([row]) },
      }
    }

    case 'Form': {
      const firstUnfilled = primitive.fields.find(f => f.required)
      const text = firstUnfilled
        ? `${primitive.label}\n\nPlease enter ${firstUnfilled.label}:`
        : primitive.label
      return { text }
    }

    case 'Detail': {
      const rows = primitive.actions.map(action => [btn(action.label, `a:${action.id}`)])
      return {
        text: `${primitive.label}\n\n${primitive.content}`,
        extra: { reply_markup: inlineKeyboard(rows) },
      }
    }

    case 'Stream': {
      let text: string
      switch (primitive.status) {
        case 'running':
          text = `⏳ Running...`
          break
        case 'complete':
          text = primitive.content
            ? `✅ Complete\n\n${primitive.content}`
            : `✅ Complete`
          break
        case 'failed':
          text = `❌ Failed`
          break
        default:
          text = primitive.label
      }
      return { text }
    }

    case 'Prompt': {
      const text = primitive.placeholder
        ? `${primitive.label}\n\n${primitive.placeholder}`
        : primitive.label
      return { text }
    }

    case 'Result': {
      // Delivery keyboard: two rows
      // Row 1: rate buttons
      // Row 2: non-rate action buttons
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
  }
}

// ---------------------------------------------------------------------------
// decodeCallbackData — turn a compact callback_data string into a PrimitiveEvent
// ---------------------------------------------------------------------------

function decodeCallbackData(data: string): PrimitiveEvent | null {
  if (data.startsWith('s:')) {
    return { kind: 'select', selectedId: data.slice(2) }
  }
  if (data === 'cy') {
    return { kind: 'confirm', confirmed: true }
  }
  if (data === 'cn') {
    return { kind: 'confirm', confirmed: false }
  }
  if (data === 'pn') {
    return { kind: 'paginate', action: 'next' }
  }
  if (data === 'pp') {
    return { kind: 'paginate', action: 'prev' }
  }
  if (data.startsWith('ps:')) {
    return { kind: 'paginate', action: 'select', selectedId: data.slice(3) }
  }
  // Result action: ra:actumId:ratingType
  if (data.startsWith('ra:')) {
    const [, actumId, ratingType] = data.split(':')
    return { kind: 'result_action', actumId, actionId: `rate_${ratingType}` }
  }

  if (data.startsWith('a:')) {
    const parts = data.split(':')
    const actionId = parts[1]
    const actumId = parts[2]
    if (actumId) return { kind: 'result_action', actumId, actionId }
    return { kind: 'action', actionId }
  }
  if (data.startsWith('ms:')) {
    const id = data.slice(3)
    if (id === 'done') return null  // Done button — treat as no-op for now
    return { kind: 'multiselect', selectedIds: [id] }
  }
  return null
}

// ---------------------------------------------------------------------------
// TelegramAllocutio
// ---------------------------------------------------------------------------

export class TelegramAllocutio implements Omit<Allocutio, 'parse' | 'resolve' | 'send'> {
  readonly platforma = 'telegram' as const

  private readonly router: RouterDeps
  private readonly sender: TelegramSender
  private readonly identity: IdentityResolver
  private readonly deps: {
    router: RouterDeps
    sender: TelegramSender
    identity: IdentityResolver
    /** Unix ms timestamp of bot startup. Messages older than this are dropped. */
    botStartupTime?: number
  }

  // chatId lookup: platform:userId → chatId (set when first message arrives)
  private readonly chatIds = new Map<string, number>()

  constructor(deps: {
    router: RouterDeps
    sender: TelegramSender
    identity: IdentityResolver
    /** Unix ms timestamp of bot startup. Messages older than this are dropped. */
    botStartupTime?: number
  }) {
    this.deps = deps
    this.router = deps.router
    this.sender = deps.sender
    this.identity = deps.identity

    // Wire router callbacks
    this.router.onStep((ctx, step) => { void this._handleStep(ctx, step) })
    this.router.onResolution((ctx, resolution) => { void this._handleResolution(ctx, resolution) })
  }

  // -------------------------------------------------------------------------
  // Main entry point
  // -------------------------------------------------------------------------

  async receive(update: TelegramUpdate): Promise<void> {
    const chatId =
      update.message?.chat.id ??
      update.callback_query?.message?.chat.id

    const messageId =
      update.message?.message_id ??
      update.callback_query?.message?.message_id

    try {
      if (update.message) {
        await this._handleMessage(update.message)
      } else if (update.callback_query) {
        await this._handleCallbackQuery(update.callback_query)
      }
    } catch (err) {
      console.error('TelegramAllocutio error:', err)
      if (chatId) {
        if (messageId) {
          void this._react(chatId, messageId, '😨')
        }
        await this.sender
          .sendMessage(chatId, 'Something went wrong. Please try again.')
          .catch(() => {})
      }
    }
  }

  // -------------------------------------------------------------------------
  // Message handler
  // -------------------------------------------------------------------------

  private async _handleMessage(message: NonNullable<TelegramUpdate['message']>): Promise<void> {
    // Drop stale messages (from before bot startup)
    if (this.deps.botStartupTime !== undefined) {
      if ((message.date * 1000) < this.deps.botStartupTime) return
    }

    const userId = String(message.from?.id ?? message.chat.id)
    const chatId = message.chat.id
    const text = message.text ?? ''

    // Store chatId for later use (rendering)
    this.chatIds.set(`telegram:${userId}`, chatId)

    if (text.startsWith('/')) {
      await this._handleCommand(userId, chatId, text, message.message_id)
    } else {
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

      // Plain text message — only route if there's an active flow
      if (this.router.hasContext('telegram', userId)) {
        await this.router.handle('telegram', userId, { kind: 'prompt', text })
      }
      // No active flow → no-op
    }
  }

  // -------------------------------------------------------------------------
  // Command handler
  // -------------------------------------------------------------------------

  private async _handleCommand(userId: string, chatId: number, text: string, messageId?: number): Promise<void> {
    // React with 🤔 to acknowledge receipt
    if (messageId !== undefined) {
      void this._react(chatId, messageId, '🤔')
    }

    // Extract command (strip leading / and any @bot_username suffix, plus args)
    const [rawCmd] = text.split(' ')
    const cmd = rawCmd.split('@')[0].toLowerCase()

    switch (cmd) {
      case '/run':
      case '/imagine':
      case '/tools':
      case '/start': {
        const identity = await this.identity.resolve(userId)
        await this.router.enter('execute', 'telegram', userId, identity)
        if (messageId !== undefined) {
          void this._react(chatId, messageId, '👌')
        }
        break
      }

      case '/cancel':
      case '/stop': {
        this.router.clear('telegram', userId)
        await this.sender.sendMessage(chatId, 'Cancelled.')
        break
      }

      case '/status': {
        await this.sender.sendMessage(chatId, 'Status coming soon.')
        break
      }

      default:
        await this.sender.sendMessage(chatId, 'Unknown command.')
        break
    }
  }

  // -------------------------------------------------------------------------
  // Callback query handler
  // -------------------------------------------------------------------------

  private async _handleCallbackQuery(
    query: NonNullable<TelegramUpdate['callback_query']>
  ): Promise<void> {
    const userId = String(query.from.id)
    const chatId = query.message?.chat.id

    if (chatId) {
      this.chatIds.set(`telegram:${userId}`, chatId)
    }

    // Always ack the callback query
    await this.sender.answerCallbackQuery(query.id)

    if (!query.data) return

    const event = decodeCallbackData(query.data)
    if (!event) return

    if (this.router.hasContext('telegram', userId)) {
      await this.router.handle('telegram', userId, event)
    }
  }

  // -------------------------------------------------------------------------
  // Step renderer — fires when router emits a step
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // _sendResult — special handling for Result primitive (media sending)
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // _react — set a message reaction (decorative, errors swallowed)
  // -------------------------------------------------------------------------

  private async _react(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      await (this.sender as unknown as {
        setMessageReaction?(chatId: number, messageId: number, reaction: unknown[]): Promise<void>
      }).setMessageReaction?.(chatId, messageId, [{ type: 'emoji', emoji }])
    } catch {
      // Reactions are decorative — swallow all errors silently
    }
  }

  // -------------------------------------------------------------------------
  // _resolveFileUrl — resolve a Telegram file_id to a download URL
  // -------------------------------------------------------------------------

  private async _resolveFileUrl(fileId: string): Promise<string | null> {
    try {
      return await (this.sender as unknown as { getFileLink(fileId: string): Promise<string> })
        .getFileLink(fileId)
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Resolution renderer — fires when router emits a terminal resolution
  // -------------------------------------------------------------------------

  private async _handleResolution(ctx: FlowContext, resolution: Resolution): Promise<void> {
    const chatId = this._getChatId(ctx)
    if (chatId === null) return

    switch (resolution.kind) {
      case 'complete':
        await this.sender.sendMessage(chatId, '✅ Done.')
        break
      case 'abandon':
        await this.sender.sendMessage(chatId, 'Cancelled.')
        break
      case 'handoff':
        // No message needed — router will fire onStep for the new flow
        break
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _getChatId(ctx: FlowContext): number | null {
    const key = `${ctx.platform}:${ctx.platformUserId}`
    return this.chatIds.get(key) ?? null
  }

  // -------------------------------------------------------------------------
  // Allocutio interface stubs (FlowEngine handles everything via receive())
  // These are here for registry compatibility only.
  // -------------------------------------------------------------------------

  async parse(raw: unknown): Promise<Nuntius> {
    const update = raw as TelegramUpdate
    const msg = update.message
    const cq = update.callback_query
    const from = msg?.from ?? cq?.from
    const chatId = msg?.chat.id ?? cq?.message?.chat.id ?? 0
    return {
      id: String(update.update_id),
      platforma: 'telegram',
      externusUserId: String(from?.id ?? 0),
      externusConversationId: String(chatId),
      externusMessageId: msg ? String(msg.message_id) : undefined,
      genus: 'eventus',
      corpus: msg?.text ?? cq?.data ?? '',
      natum: new Date(),
    }
  }

  async resolve(_nuntius: Nuntius): Promise<Inceptio | null> {
    // FlowEngine handles everything — return null
    return null
  }

  async send(_responsum: Responsum, _target: { conversationId: string }): Promise<void> {
    // Not used in FlowEngine mode
  }
}
