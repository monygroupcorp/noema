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
import { makeLogger } from '../lib/logger.js'
import { bus } from '../lib/bus.js'
import type { WideEvent } from '../lib/wide.js'

const log = makeLogger('telegram:allocutio')

// ---------------------------------------------------------------------------
// Static text
// ---------------------------------------------------------------------------

const HELP_TEXT = `\
noema

  Creative
  /make    — generate images and art
  /chat    — chat with an AI model
  /flows   — browse all available tools

  Account
  /status  — view balance and account
  /wallet  — manage connected wallets
  /cancel  — cancel current action
  /help    — show this message\
`

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
  sendMessage(chatId: number, text: string, extra?: { reply_markup?: unknown; caption?: string }): Promise<{ message_id: number }>
  editMessageText(chatId: number, messageId: number, text: string, extra?: { reply_markup?: unknown }): Promise<void>
  answerCallbackQuery(callbackQueryId: string): Promise<void>
  sendPhoto(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
  sendVideo(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
  sendDocument(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
  sendMediaGroup(chatId: number, media: unknown[]): Promise<void>
  setMessageReaction?(chatId: number, messageId: number, reaction: unknown[]): Promise<void>
  getFileLink(fileId: string): Promise<string>
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
      const text = `${primitive.label}  (page ${primitive.page + 1}/${primitive.totalPages})`
      const itemRows: InlineButton[][] = primitive.items.map(item => [btn(item.label, `ps:${item.id}`)])
      const navRow: InlineButton[] = []
      if (primitive.page > 0) navRow.push(btn('◀ Prev', 'pp'))
      if (primitive.page < primitive.totalPages - 1) navRow.push(btn('▶ Next', 'pn'))
      const rows = navRow.length > 0 ? [...itemRows, navRow] : itemRows
      return {
        text,
        extra: { reply_markup: inlineKeyboard(rows) },
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

  // pending edit: platform:userId → messageId of the message to edit in place
  private readonly pendingEditMessageIds = new Map<string, number>()

  // last command message: platform:userId → messageId of the most recent command message
  private readonly lastCommandMessageIds = new Map<string, number>()

  // actum progress tracking for cold-start UX
  private readonly actumProgress = new Map<string, {
    chatId: number
    progressMessageId: number | null
    commandMessageId: number | undefined
    lastEditMs: number
    isCold: boolean
  }>()

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

    // Wire bus events for pod lifecycle → Telegram progress messages
    bus.on('actum.stage', (data) => { void this._handleActumStage(data) })
    bus.on('actum.complete', (wide) => { void this._handleActumComplete(wide) })
    bus.on('actum.fail', (wide) => { this.actumProgress.delete(wide.actumId) })
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
      log.error('TelegramAllocutio error', { error: String(err) })
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
      // Store command message ID for async reaction (Feature 3)
      this.lastCommandMessageIds.set(`telegram:${userId}`, messageId)
    }

    // Extract command (strip leading / and any @bot_username suffix, plus args)
    const [rawCmd] = text.split(' ')
    const cmd = rawCmd.split('@')[0].toLowerCase()

    switch (cmd) {
      case '/start': {
        await this._sendStart(chatId)
        if (messageId !== undefined) void this._react(chatId, messageId, '👌')
        break
      }

      case '/run':
      case '/make': {
        const identity = await this.identity.resolve(userId)
        // Parse prompt from command: /make <prompt text>
        const promptText = text.replace(/^\/(?:make|run)(?:@\S+)?\s*/i, '').trim()
        const defaultModusId = 'runmake.flux-schnell'
        const initialState = promptText
          ? { modusId: defaultModusId, aditus: { prompt: promptText }, browsePageIndex: 0 }
          : { modusId: defaultModusId, aditus: {}, browsePageIndex: 0 }
        await this.router.enter('execute', 'telegram', userId, identity, { state: initialState })
        if (messageId !== undefined) void this._react(chatId, messageId, '👌')
        break
      }

      case '/chat': {
        const identity = await this.identity.resolve(userId)
        // Pre-set chatgpt modus so the user lands directly on the prompt field
        await this.router.enter('execute', 'telegram', userId, identity, {
          state: { modusId: 'modus.chatgpt', aditus: {}, browsePageIndex: 0 },
        })
        if (messageId !== undefined) void this._react(chatId, messageId, '👌')
        break
      }

      case '/flows': {
        const identity = await this.identity.resolve(userId)
        await this.router.enter('execute', 'telegram', userId, identity)
        if (messageId !== undefined) void this._react(chatId, messageId, '👌')
        break
      }

      case '/cancel':
      case '/stop': {
        this.router.clear('telegram', userId)
        await this.sender.sendMessage(chatId, 'Cancelled.')
        break
      }

      case '/status': {
        await this.sender.sendMessage(chatId,
          'Balance and account info coming soon.',
          { reply_markup: inlineKeyboard([[
            btn('connect wallet', 'a:connect_wallet'),
            btn('top up',        'a:topup'),
          ]]) },
        )
        break
      }

      case '/wallet': {
        await this.sender.sendMessage(chatId,
          'Wallet management coming soon.',
          { reply_markup: inlineKeyboard([[
            btn('connect wallet', 'a:connect_wallet'),
            btn('balance',        'a:balance'),
          ]]) },
        )
        break
      }

      case '/help': {
        await this.sender.sendMessage(chatId, HELP_TEXT)
        break
      }

      default:
        await this.sender.sendMessage(chatId,
          `Unknown command. Type /help to see what's available.`
        )
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

    // Pod invite button — send a forwardable invite message
    if (query.data.startsWith('pod_invite:') && chatId) {
      const inviteText = [
        'A StationThis pod is warming up.',
        'Send /make [your prompt] to queue your generation on this pod.',
        '',
        'Powered by noema.',
      ].join('\n')
      void this.sender.sendMessage(chatId, inviteText).catch(() => {})
      return
    }

    const event = decodeCallbackData(query.data)
    if (!event) return

    // Store the message ID for in-place editing on the next step
    if (query.message?.message_id !== undefined) {
      this.pendingEditMessageIds.set(`telegram:${userId}`, query.message.message_id)
    }

    // Start-screen shortcut buttons — launch flows directly
    if (event.kind === 'select') {
      if (event.selectedId === 'make' || event.selectedId === 'flows') {
        const identity = await this.identity.resolve(userId)
        await this.router.enter('execute', 'telegram', userId, identity)
        return
      }
      if (event.selectedId === 'chat') {
        const identity = await this.identity.resolve(userId)
        await this.router.enter('execute', 'telegram', userId, identity, {
          state: { modusId: 'modus.chatgpt', aditus: {}, browsePageIndex: 0 },
        })
        return
      }
    }

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

    const userKey = `${ctx.platform}:${ctx.platformUserId}`
    // Consume the pending edit message ID (if any) — used for the first keyboard primitive
    let editMessageId = this.pendingEditMessageIds.get(userKey)
    if (editMessageId !== undefined) this.pendingEditMessageIds.delete(userKey)

    for (const primitive of step.primitives) {
      // Result primitives are never edited — always sent as new messages
      if (primitive.kind === 'Result') {
        editMessageId = undefined  // stop editing for subsequent primitives
        await this._sendResult(chatId, primitive)
        continue
      }

      // Stream(running) → react 👌 and register actum for progress tracking
      if (primitive.kind === 'Stream' && primitive.status === 'running') {
        const commandMessageId = this.lastCommandMessageIds.get(userKey)
        if (commandMessageId !== undefined) {
          void this._react(chatId, commandMessageId, '👌')
        } else {
          await this.sender.sendMessage(chatId, '⏳ Working on it…')
        }
        // Register actum so stage events can send progress messages to this chat
        if (primitive.actumId) {
          this.actumProgress.set(primitive.actumId, {
            chatId,
            progressMessageId: null,
            commandMessageId,
            lastEditMs: 0,
            isCold: false,
          })
        }
        editMessageId = undefined
        continue
      }

      const { text, extra } = renderPrimitive(primitive)

      // Feature 2: edit in place if we have a pending edit message ID and this primitive has a keyboard
      if (editMessageId !== undefined && extra?.reply_markup) {
        try {
          await this.sender.editMessageText(chatId, editMessageId, text, extra)
        } catch {
          // Fallback: send as new message (message too old, content unchanged, etc.)
          await this.sender.sendMessage(chatId, text, extra)
        }
        editMessageId = undefined  // only edit the first keyboard primitive
      } else {
        await this.sender.sendMessage(chatId, text, extra)
      }
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
          await this.sender.sendPhoto(chatId, m.url, { caption: m.caption, ...extra })
        } else if (m.type === 'video') {
          await this.sender.sendVideo(chatId, m.url, { caption: m.caption, ...extra })
        } else {
          await this.sender.sendDocument(chatId, m.url, { caption: m.caption, ...extra })
        }
      } catch {
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
      await this.sender.sendMediaGroup(chatId, media)
    } catch {
      for (const m of primitive.media) {
        await this.sender.sendMessage(chatId, m.url).catch(() => {})
      }
    }
    // Send keyboard as follow-up text message (Telegram limitation)
    await this.sender.sendMessage(chatId, '—', extra)
  }

  // -------------------------------------------------------------------------
  // _sendStart — welcome message with quick-start buttons
  // -------------------------------------------------------------------------

  private async _sendStart(chatId: number): Promise<void> {
    const text = `\
noema

Generate AI art, chat with models, explore creative tools.`

    await this.sender.sendMessage(chatId, text, {
      reply_markup: inlineKeyboard([
        [btn('make', 's:make'), btn('chat', 's:chat'), btn('flows', 's:flows')],
        [btn('connect wallet', 'a:connect_wallet'), btn('balance', 'a:balance')],
      ]),
    })
  }

  // -------------------------------------------------------------------------
  // _react — set a message reaction (decorative, errors swallowed)
  // -------------------------------------------------------------------------

  private async _react(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      await this.sender.setMessageReaction?.(chatId, messageId, [{ type: 'emoji', emoji }])
    } catch {
      // Reactions are decorative — swallow all errors silently
    }
  }

  // -------------------------------------------------------------------------
  // _handleActumStage — bus event → send or edit cold-start progress message
  // -------------------------------------------------------------------------

  private async _handleActumStage(data: { actumId: string; stage: string; elapsedMs: number }): Promise<void> {
    const progress = this.actumProgress.get(data.actumId)
    if (!progress) return

    const { chatId, commandMessageId } = progress
    const now = Date.now()

    if (data.stage === 'warm-pod-found') {
      // Swap to 🔥 reaction and skip progress message
      if (commandMessageId !== undefined) {
        void this._react(chatId, commandMessageId, '🔥')
      }
      return
    }

    if (data.stage === 'provisioning') {
      progress.isCold = true
      const text = this._progressText('provisioning', data.elapsedMs)
      try {
        const msg = await this.sender.sendMessage(chatId, text, {
          reply_markup: inlineKeyboard([[btn('Invite to this pod', `pod_invite:${data.actumId}`)]]),
        })
        progress.progressMessageId = msg.message_id
        progress.lastEditMs = now
      } catch { /* non-critical */ }
      return
    }

    // Rate-limit edits to 1 per 4s — telegram will 429 on faster edits
    if (now - progress.lastEditMs < 4000) return
    if (progress.progressMessageId === null) return

    const text = this._progressText(data.stage, data.elapsedMs)
    void this.sender.editMessageText(chatId, progress.progressMessageId, text, {
      reply_markup: inlineKeyboard([[btn('Invite to this pod', `pod_invite:${data.actumId}`)]]),
    }).catch(() => {})
    progress.lastEditMs = now
  }

  private _progressText(stage: string, elapsedMs: number): string {
    const elapsed = Math.round(elapsedMs / 1000)
    const elapsedStr = elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`

    let header: string
    let progressBar: string | null = null

    if (stage.startsWith('progress:')) {
      const [n, m] = stage.slice(9).split('/').map(Number)
      const pct = m > 0 ? n / m : 0
      const filled = Math.round(pct * 10)
      progressBar = `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${n}/${m}`
      header = 'Generating...'
    } else {
      const stageLines: Record<string, string> = {
        'provisioning':     'Provisioning cold pod...',
        'ssh-ready':        'Pod online. Setting up runtime...',
        'bootstrapping':    'Bootstrapping runtime...',
        'downloading':      'Downloading models...',
        'installing-nodes': 'Loading plugins...',
        'restarting':       'Reloading runtime...',
        'comfy-ready':      'Models loaded. Generating...',
        'inferring':        'Generating image...',
        'uploading':        'Saving result...',
      }
      header = stageLines[stage] ?? `Stage: ${stage}`
    }

    const lines = [header]
    if (progressBar) lines.push(progressBar)
    lines.push(`Elapsed: ${elapsedStr}`)

    if (stage === 'provisioning') {
      lines.push('Est. time: ~5 min on cold start')
      lines.push('')
      lines.push('To switch model, reply: xl  dev  schnell')
    }

    return lines.join('\n')
  }

  // -------------------------------------------------------------------------
  // _handleActumComplete — bus event → concierge message after delivery
  // -------------------------------------------------------------------------

  private async _handleActumComplete(wide: WideEvent): Promise<void> {
    const progress = this.actumProgress.get(wide.actumId)
    if (!progress) return

    // Wait for image delivery to arrive in Telegram first
    await new Promise<void>(r => setTimeout(r, 3000))

    const { chatId } = progress
    const durationSec = Math.round(wide.durationMs / 1000)
    const durationStr = durationSec >= 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`

    const isSlow = wide.coldStart && wide.durationMs > 8 * 60 * 1000

    const lines = isSlow
      ? [
          `Cold start took ${durationStr} — longer than expected.`,
          `Your next gen will reuse this warm pod for instant results.`,
        ]
      : [
          `Pod stays warm for ~15 min.`,
          `Run /make again for instant results on this pod.`,
        ]

    lines.push('')
    lines.push('To stop accruing compute cost, destroy the pod now.')

    void this.sender.sendMessage(chatId, lines.join('\n')).catch(() => {})

    // Clean up
    this.actumProgress.delete(wide.actumId)
  }

  // -------------------------------------------------------------------------
  // _resolveFileUrl — resolve a Telegram file_id to a download URL
  // -------------------------------------------------------------------------

  private async _resolveFileUrl(fileId: string): Promise<string | null> {
    try {
      return await this.sender.getFileLink(fileId)
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
        // Silent — abandon fires on implicit context replacement (e.g. /make while already in a flow).
        // Explicit /cancel sends its own message directly from the command handler.
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
