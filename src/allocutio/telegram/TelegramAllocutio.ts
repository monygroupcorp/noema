// =============================================================================
// TelegramAllocutio — Telegram platform adapter for FlowEngine
// =============================================================================
//
// Bridges raw Telegram webhook Update objects to FlowRouter.
// Handles command parsing, callback_query decoding, and primitive rendering.
// =============================================================================

import type { Primitive, Step, Resolution, FlowContext } from '../../flow/types.js'
import type { Allocutio, Nuntius, Responsum } from '../../types/allocutio.js'
import type { Inceptio } from '../../types/cursus.js'
import { makeLogger } from '../../lib/logger.js'
import { bus, type StageInfo } from '../../lib/bus.js'
import { withTrace, getTrace, makeTraceContext } from '../../lib/trace.js'
import type { WideEvent } from '../../lib/wide.js'
import type { MateriaStore } from '../../types/materia.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { Actum } from '../../types/actum.js'
import { classifyError } from '../../lib/classifyError.js'
import { BulletinManager, type BulletinSink } from '../lexicon/bulletin/BulletinManager.js'
import { DeliveryMenu, type DeliverySink } from '../lexicon/delivery/DeliveryMenu.js'
import { ReactionController } from './reactions/ReactionController.js'
import type { UiKeyboard } from '../lexicon/ui/Keyboard.js'
import { inlineKeyboard, btn, renderPrimitive, decodeCallbackData, type InlineKeyboard } from './telegramRender.js'
import { CommandRouter } from './commands/CommandRouter.js'
import { REACTION } from '../lexicon/symbols.js'
import { COPY } from '../lexicon/copy.js'
import type { TelegramUpdate, TelegramSender, IdentityResolver, RouterDeps } from './telegramTypes.js'
// Re-export the adapter contracts so existing importers (index, TelegramSenderAdapter) keep working.
export type { TelegramUpdate, TelegramSender, IdentityResolver, RouterDeps } from './telegramTypes.js'

const log = makeLogger('telegram:allocutio')

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
    /** Pod registry — used to set a pod's warmUntil from the warm-window buttons. */
    materiae?: MateriaStore
    /** Terminate a pod by its external id — backs the "destroy now" button. */
    terminatePod?: (podId: string) => Promise<void>
    /** Look up an actum (for the delivery menu's Info stats). */
    acta?: { findById(id: string): Promise<Actum | null> }
    /** Cancel an in-flight actum — fails it (releases reserved signa). Returns true if it
     *  actually refunded (false if the actum was already terminal). Backs destroy/retry. */
    cancelActum?: (actumId: string, reason: string) => Promise<boolean>
    /** Host-guest bond store — when present, group provisionings get their admin set
     *  resolved + stamped into Hospitium.adminAnimaIds on pod.parked. */
    hospitia?: HospitiumStore
    /** No-interaction window before the bulletin auto-confirms the warm choice. Default 20s. */
    autoSettleMs?: number
  }

  // chatId lookup: platform:userId → chatId (set when first message arrives)
  private readonly chatIds = new Map<string, number>()

  // pending edit: platform:userId → messageId of the message to edit in place
  private readonly pendingEditMessageIds = new Map<string, number>()

  // last command message: platform:userId → messageId of the most recent command message
  private readonly lastCommandMessageIds = new Map<string, number>()

  // The session bulletin (HUD), the delivery menu, and the command-message reaction
  // choreography each live in their own subsystem now; this adapter just feeds them.
  private readonly bulletins: BulletinManager
  private readonly delivery: DeliveryMenu
  private readonly reactions: ReactionController
  private readonly commands: CommandRouter

  constructor(deps: {
    router: RouterDeps
    sender: TelegramSender
    identity: IdentityResolver
    /** Unix ms timestamp of bot startup. Messages older than this are dropped. */
    botStartupTime?: number
    materiae?: MateriaStore
    terminatePod?: (podId: string) => Promise<void>
    acta?: { findById(id: string): Promise<Actum | null> }
    cancelActum?: (actumId: string, reason: string) => Promise<boolean>
    /** Host-guest bond store — when present, group provisionings get their admin set
     *  resolved + stamped into Hospitium.adminAnimaIds on pod.parked. */
    hospitia?: HospitiumStore
    /** No-interaction window before the bulletin auto-confirms the warm choice. Default 20s. */
    autoSettleMs?: number
  }) {
    this.deps = deps
    this.router = deps.router
    this.sender = deps.sender
    this.identity = deps.identity

    // The bulletin subsystem: it owns the journal/ledger/timers/render; we give it a
    // sink (how to put messages on Telegram) and the pod-control deps it needs.
    this.bulletins = new BulletinManager({
      sink: this._bulletinSink(),
      terminatePod: deps.terminatePod,
      cancelActum: deps.cancelActum,
      setPodWarmUntil: (podId, ttlMs) => this._setPodWarmUntil(podId, ttlMs),
      autoSettleMs: deps.autoSettleMs,
    })

    // The delivery menu: owns the morphing result row + Info/rating state; we give
    // it a sink and a rerun hook into the flow router.
    this.delivery = new DeliveryMenu({
      sink: this._deliverySink(),
      acta: deps.acta,
      rerun: (actumId, presserUserId, chatId) => this._rerun(actumId, presserUserId, chatId),
    })

    // The 👌/🔥 reaction choreography on the command message.
    this.reactions = new ReactionController({ react: (c, m, e) => this._react(c, m, e) })

    // The slash-command surface → flow router.
    this.commands = new CommandRouter({
      enterExecute: (userId, state) => this._enterExecute(userId, state),
      cancel: (userId) => this.router.clear('telegram', userId),
      sendMessage: (chatId, text, extra) => this.sender.sendMessage(chatId, text, extra),
      sendStart: (chatId) => this._sendStart(chatId),
      ack: (chatId, messageId) => { void this._react(chatId, messageId, REACTION.ok) },
    })

    // Wire router callbacks
    this.router.onStep((ctx, step) => { void this._handleStep(ctx, step) })
    this.router.onResolution((ctx, resolution) => { void this._handleResolution(ctx, resolution) })

    // Pod lifecycle → bulletin manager (+ the local reaction bookkeeping).
    bus.on('actum.stage', (data) => { void this._handleActumStage(data) })
    bus.on('actum.complete', (wide) => { void this._handleActumComplete(wide) })
    bus.on('actum.fail', (wide) => { void this._handleActumFail(wide) })
    bus.on('pod.reaped', ({ externusId }) => { this.bulletins.onReaped(externusId) })
    // Late-binding hosting metadata: resolve group admins and stamp Hospitium.
    bus.on('pod.parked', (data) => { void this._handlePodParked(data) })
  }

  /** Map a neutral UI keyboard to Telegram's inline-keyboard shape. */
  private _toInline(kb: UiKeyboard): InlineKeyboard {
    return inlineKeyboard(kb.map(row => row.map(b => btn(b.label, b.data))))
  }

  /** How the bulletin manager puts messages on Telegram (BulletinSink). */
  private _bulletinSink(): BulletinSink {
    return {
      post: async (chatId, text, kb) => {
        try {
          const msg = await this.sender.sendMessage(chatId, text, { reply_markup: this._toInline(kb) })
          return msg.message_id
        } catch { return null }
      },
      edit: async (chatId, messageId, text, kb) => {
        await this.sender.editMessageText(chatId, messageId, text, { reply_markup: this._toInline(kb) }).catch(() => {})
      },
      remove: async (chatId, messageId) => { void this.sender.deleteMessage?.(chatId, messageId).catch(() => {}) },
    }
  }

  /** How the delivery menu edits a delivered result (DeliverySink). */
  private _deliverySink(): DeliverySink {
    return {
      editMarkup: async (chatId, messageId, kb) => {
        await this.sender.editMessageReplyMarkup?.(chatId, messageId, this._toInline(kb)).catch(() => {})
      },
      editCaption: async (chatId, messageId, text, kb) => {
        await this.sender.editMessageCaption?.(chatId, messageId, text, { reply_markup: this._toInline(kb) }).catch(() => {})
      },
      editText: async (chatId, messageId, text, kb) => {
        await this.sender.editMessageText(chatId, messageId, text, { reply_markup: this._toInline(kb) }).catch(() => {})
      },
    }
  }

  /** Enter the execute flow for a user, optionally prefilled — the single path used by
   *  slash commands and start-screen shortcuts alike. */
  private async _enterExecute(userId: string, state?: Record<string, unknown>): Promise<void> {
    const identity = await this.identity.resolve(userId)
    await this.router.enter('execute', 'telegram', userId, identity, state ? { state } : undefined)
  }

  /** Re-run an actum under the presser (presser pays), prefilled with its modus + params. */
  private async _rerun(actumId: string, presserUserId: string, chatId: number): Promise<void> {
    this.chatIds.set(`telegram:${presserUserId}`, chatId)
    const actum = await this.deps.acta?.findById(actumId).catch(() => null)
    if (!actum) return
    const identity = await this.identity.resolve(presserUserId)
    // Lands in CONFIGURE prefilled with the original params; the presser submits → they pay.
    await this.router.enter('execute', 'telegram', presserUserId, identity, {
      state: { modusId: actum.modusId, aditus: actum.aditus, browsePageIndex: 0 },
    })
  }

  /** Resolve a pod's Materia and stamp its warm deadline (backs the warm-window buttons). */
  private async _setPodWarmUntil(podId: string, ttlMs: number): Promise<void> {
    if (!this.deps.materiae) return
    const pods = await this.deps.materiae.findActive().catch(() => [])
    const m = pods.find(p => p.externusId === podId)
    if (m) await this.deps.materiae.update(m.id, { warmUntil: new Date(Date.now() + ttlMs) }).catch(() => {})
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

    // When the dispatch comes from a group/supergroup, enrich the trace context
    // with groupChatId so warm-park stamps Materia.groupChatId without putting
    // chat info on the Actum schema. DMs leave it absent.
    const chatType = update.message?.chat.type
    const groupChatId = (chatType === 'group' || chatType === 'supergroup') && chatId
      ? String(chatId)
      : undefined

    const dispatch = async () => {
      try {
        if (update.message) {
          await this._handleMessage(update.message)
        } else if (update.callback_query) {
          await this._handleCallbackQuery(update.callback_query)
        }
      } catch (err) {
        log.error('TelegramAllocutio error', { error: String(err) })
        if (chatId) {
          if (messageId) void this._react(chatId, messageId, REACTION.error)
          await this.sender
            .sendMessage(chatId, classifyError(err))
            .catch(() => {})
        }
      }
    }

    if (groupChatId) {
      await withTrace(makeTraceContext({ ...getTrace(), groupChatId }), dispatch)
    } else {
      await dispatch()
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
    // Reaction-prep: 🤔 on receipt + remember the command message so the Stream
    // registration can later land the 👌/🔥 on it. The command surface itself lives
    // in CommandRouter.
    if (messageId !== undefined) {
      void this._react(chatId, messageId, REACTION.thinking)
      this.lastCommandMessageIds.set(`telegram:${userId}`, messageId)
    }
    await this.commands.dispatch(userId, chatId, text, messageId)
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

    // Session bulletin — warm stepper / confirm / refresh / time / kill
    if (query.data.startsWith('bul:') && chatId) {
      const action = query.data.split(':')[1] ?? ''
      await this.bulletins.handleControl(chatId, String(query.from.id), action)
      return
    }

    // Delivery menu — morphing row + Info stats. Data: dm:<action>:<actumId>[:<type>]
    if (query.data.startsWith('dm:') && chatId) {
      const [, action, actumId, ratedType] = query.data.split(':')
      // Pass the callback's own chat so the menu can refuse cross-chat actumIds.
      await this.delivery.handle(actumId, action, { ratedType, presserUserId: String(query.from.id), chatId })
      return
    }

    // Pod invite button — send a forwardable invite message
    if (query.data.startsWith('pod_invite:') && chatId) {
      void this.sender.sendMessage(chatId, COPY.status.podInvite).catch(() => {})
      return
    }

    const event = decodeCallbackData(query.data)
    if (!event) return

    // Store the message ID for in-place editing on the next step
    if (query.message?.message_id !== undefined) {
      this.pendingEditMessageIds.set(`telegram:${userId}`, query.message.message_id)
    }

    // Start-screen shortcut buttons — launch flows directly (same path as commands).
    if (event.kind === 'select') {
      if (event.selectedId === 'make' || event.selectedId === 'flows') {
        await this._enterExecute(userId)
        return
      }
      if (event.selectedId === 'chat') {
        await this._enterExecute(userId, { modusId: 'modus.chatgpt', aditus: {}, browsePageIndex: 0 })
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

      // Stream(running) → register the actum with the reaction + bulletin subsystems.
      if (primitive.kind === 'Stream' && primitive.status === 'running') {
        const commandMessageId = this.lastCommandMessageIds.get(userKey)
        if (commandMessageId === undefined) await this.sender.sendMessage(chatId, COPY.status.working)
        if (primitive.actumId) {
          this.reactions.register(primitive.actumId, chatId, commandMessageId)
          this.bulletins.register(chatId, primitive.actumId, ctx.platformUserId)
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
    const { text: bodyText } = renderPrimitive(primitive)
    // The delivery menu owns the morphing row; we just attach its initial keyboard.
    const extra = { reply_markup: this._toInline(this.delivery.initialKeyboard(primitive.actumId)) }
    const track = (messageId: number, caption: string, isMedia: boolean) =>
      this.delivery.track(primitive.actumId, { chatId, messageId, caption, isMedia })

    if (!primitive.media || primitive.media.length === 0) {
      // Text-only result (chatgpt, caption, etc.)
      const sent = await this.sender.sendMessage(chatId, bodyText, extra)
      track(sent.message_id, bodyText, false)
      return
    }

    if (primitive.media.length === 1) {
      const m = primitive.media[0]
      try {
        let sent: { message_id: number }
        if (m.type === 'image') {
          sent = await this.sender.sendPhoto(chatId, m.url, { caption: m.caption, ...extra })
        } else if (m.type === 'video') {
          sent = await this.sender.sendVideo(chatId, m.url, { caption: m.caption, ...extra })
        } else {
          sent = await this.sender.sendDocument(chatId, m.url, { caption: m.caption, ...extra })
        }
        track(sent.message_id, m.caption ?? '', true)
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
  // Pod lifecycle → reaction choreography + bulletin journal
  // -------------------------------------------------------------------------

  private async _handleActumStage(data: { actumId: string; stage: string; elapsedMs: number; info?: StageInfo }): Promise<void> {
    // Warm signal (may arrive before OR after the Stream registers) → 🔥, never 👌.
    if (data.stage === 'warm-pod-found') { this.reactions.noteWarm(data.actumId); return }

    // KSampler progress (progress:N/M) is suppressed — it never keeps up with fast
    // jobs and burns edit quota. Every other stage drives the bulletin journal.
    if (data.stage.startsWith('progress:')) return
    this.bulletins.onStage(data.actumId, data.stage, data.info)
  }

  private async _handleActumComplete(wide: WideEvent): Promise<void> {
    this.reactions.clear(wide.actumId)
    this.bulletins.onComplete(wide.actumId, { costUsd: wide.costUsd, execMs: wide.executionMs, podId: wide.podId })
  }

  private async _handleActumFail(wide: WideEvent): Promise<void> {
    this.reactions.clear(wide.actumId)
    this.bulletins.onFail(wide.actumId)
  }

  /**
   * pod.parked: a cold pod just warm-parked. When the provisioning happened in a
   * group, resolve the chat's admin set into the Hospitium's adminAnimaIds — that
   * grants admins at-cost access on subsequent /makes (Phase B will read it).
   * Group-only and hospitia-required; quietly no-ops otherwise.
   */
  private async _handlePodParked(data: { materiaId: string; groupChatId?: string; platform?: 'telegram' | 'discord' | 'api' }): Promise<void> {
    const { materiaId, groupChatId, platform } = data
    // Multi-platform safety: only handle pods this adapter's platform provisioned.
    // Absent platform on the event is permitted (legacy / unattributed emit), so
    // we accept it; an explicit non-telegram platform is filtered out.
    if (platform && platform !== 'telegram') return
    if (!groupChatId || !this.deps.hospitia || !this.sender.getChatAdministrators) return
    const chatId = Number(groupChatId)
    if (!Number.isFinite(chatId)) return

    try {
      const admins = await this.sender.getChatAdministrators(chatId)
      const animaIds: string[] = []
      for (const a of admins) {
        const key = await this.identity.resolve(String(a.user.id)).catch(() => null)
        if (key && 'animaId' in key) animaIds.push(key.animaId)
      }
      const unique = Array.from(new Set(animaIds))
      if (unique.length > 0) {
        await this.deps.hospitia.update(materiaId, { adminAnimaIds: unique }).catch(() => {})
      }
    } catch (err) {
      log.warn('pod.parked admin resolution failed', { materiaId, error: String(err) })
    }
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
        await this.sender.sendMessage(chatId, COPY.status.done)
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
