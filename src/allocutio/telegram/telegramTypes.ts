// =============================================================================
// telegramTypes — the adapter's contracts (injected for testability)
// =============================================================================
// Minimal Telegram Update typing + the interfaces TelegramAllocutio depends on:
// the sender it writes through, the identity resolver, and the slice of FlowRouter
// it uses. Kept separate so the adapter file is implementation, not declarations.

import type { Intent, Platform, AuctorKey, PrimitiveEvent, FlowContext, Step, Resolution } from '../../flow/types.js'

/**
 * The media fields a message can carry. Telegram uses a different field per wrapper
 * for what is often the same file — an image is `photo` when compressed and
 * `document` when sent as a file, a GIF is an `animation`, a recorded note a
 * `voice`. `envelopeMedia` maps them onto the Porta types the flow engine knows.
 */
export interface TelegramMedia {
  /** One entry per size, ascending — the last is the highest resolution. */
  photo?: Array<{ file_id: string; width: number; height: number }>
  video?: { file_id: string; mime_type?: string }
  animation?: { file_id: string; mime_type?: string }
  audio?: { file_id: string; mime_type?: string }
  voice?: { file_id: string; mime_type?: string }
  /** A round video message. Carries no MIME type or filename — it is always an mp4. */
  video_note?: { file_id: string }
  /** The catch-all wrapper: media sent uncompressed, but also a PDF or a zip. */
  document?: { file_id: string; mime_type?: string; file_name?: string }
}

/** Minimal typing of the Telegram webhook Update objects we consume. */
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMedia & {
    message_id: number
    from?: { id: number; username?: string; first_name?: string }
    chat: { id: number; type: string }
    text?: string
    /** A command can ride attached media's caption — a different field from `text`. */
    caption?: string
    date: number
    reply_to_message?: TelegramMedia & {
      message_id: number
      /** Who sent the message being replied to — used to detect a reply to the bot itself. */
      from?: { id: number; username?: string }
    }
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string; first_name?: string }
    message?: { message_id: number; chat: { id: number } }
    data?: string
  }
}

/** TelegramSender — the outbound surface, injected so tests can mock it. */
export interface TelegramSender {
  sendMessage(chatId: number, text: string, extra?: { reply_markup?: unknown; caption?: string }): Promise<{ message_id: number }>
  editMessageText(chatId: number, messageId: number, text: string, extra?: { reply_markup?: unknown }): Promise<void>
  /** Edit a media message's caption (text-message edit won't work on photos). */
  editMessageCaption?(chatId: number, messageId: number, caption: string, extra?: { reply_markup?: unknown }): Promise<void>
  /** Edit only a message's inline keyboard — used to morph the delivery menu in place. */
  editMessageReplyMarkup?(chatId: number, messageId: number, reply_markup: unknown): Promise<void>
  /** Delete a message — used to re-post the session bulletin at the bottom of the chat. */
  deleteMessage?(chatId: number, messageId: number): Promise<void>
  answerCallbackQuery(callbackQueryId: string): Promise<void>
  sendPhoto(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
  sendVideo(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
  sendDocument(chatId: number, url: string, extra?: unknown): Promise<{ message_id: number }>
  sendMediaGroup(chatId: number, media: unknown[]): Promise<void>
  setMessageReaction?(chatId: number, messageId: number, reaction: unknown[]): Promise<void>
  getFileLink(fileId: string): Promise<string>
  /**
   * Resolve a group/supergroup's admin list — used after warm-park to stamp the
   * Hospitium.adminAnimaIds set. Optional: surfaces only on platforms where
   * "chat admins" is a first-class concept.
   */
  getChatAdministrators?(chatId: number): Promise<Array<{ user: { id: number } }>>
}

/** IdentityResolver — maps a Telegram user id → AuctorKey. */
export interface IdentityResolver {
  resolve(telegramUserId: string): Promise<AuctorKey>
}

/**
 * RouterDeps — the subset of FlowRouter the adapter uses. Lets tests inject a mock
 * without standing up a real FlowRouter (which needs a store + flows).
 */
export interface RouterDeps {
  enter(
    intent: Intent,
    platform: Platform,
    userId: string,
    chatId: string,
    identity: AuctorKey,
    initialCtx?: Partial<{ modoId: string; messageId: string }> & { state?: unknown }
  ): Promise<void>
  handle(platform: Platform, userId: string, chatId: string, event: PrimitiveEvent): Promise<void>
  clear(platform: Platform, userId: string, chatId: string): void
  hasContext(platform: Platform, userId: string, chatId: string): boolean
  /** Read the active flow's context without mutating it (e.g. to seed Save-as from the card state). */
  peek(platform: Platform, userId: string, chatId: string): FlowContext | null
  onStep(cb: (ctx: FlowContext, step: Step) => void): void
  onResolution(cb: (ctx: FlowContext, res: Resolution) => void): void
}
