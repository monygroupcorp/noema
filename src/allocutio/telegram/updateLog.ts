/**
 * Telegram activity log fields.
 *
 * One info line per inbound update, keyed by chat, so that "the bot did something odd in my group
 * on Tuesday" can be answered from the logs: filter on `chatId`, read the sequence. These are pure
 * projections of the update — no I/O — so the shape is pinned by hermetic tests.
 *
 * Deliberately absent: message text, captions and callback payload beyond the command word. The
 * log is for tracing activity, not for keeping what people wrote.
 */

/** The update kinds the bot subscribes to. Shared by polling and webhook mode. */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const

interface ChatRef { id: number; type?: string; title?: string }
interface UserRef { id: number; username?: string; is_bot?: boolean }

/** Structural view of the update — wider than `TelegramUpdate`, which only types what the router consumes. */
export interface LoggableUpdate {
  update_id: number
  message?: {
    message_id: number
    date?: number
    from?: UserRef
    chat: ChatRef
    text?: string
    caption?: string
    message_thread_id?: number
    migrate_to_chat_id?: number
    migrate_from_chat_id?: number
    new_chat_members?: UserRef[]
    left_chat_member?: UserRef
  }
  callback_query?: {
    from: UserRef
    message?: { message_id: number; chat: ChatRef }
    data?: string
  }
  my_chat_member?: ChatMemberUpdated
}

export interface ChatMemberUpdated {
  chat: ChatRef
  from: UserRef
  date: number
  old_chat_member: { status: string; user: UserRef }
  new_chat_member: { status: string; user: UserRef; can_promote_members?: boolean }
}

/** Leading `/word` of a text or caption, without a `@botname` suffix. Undefined for plain text. */
function commandOf(text: string | undefined): string | undefined {
  const m = text?.match(/^\/([A-Za-z0-9_]+)/)
  return m ? `/${m[1]}` : undefined
}

/** Fields for the per-update info line. */
export function describeUpdate(update: LoggableUpdate): Record<string, unknown> {
  const fields: Record<string, unknown> = { updateId: update.update_id }
  const msg = update.message
  const cb = update.callback_query

  if (msg) {
    fields.kind = 'message'
    fields.chatId = msg.chat.id
    fields.chatType = msg.chat.type
    fields.messageId = msg.message_id
    if (msg.from) fields.userId = msg.from.id
    if (msg.message_thread_id !== undefined) fields.threadId = msg.message_thread_id
    const command = commandOf(msg.text ?? msg.caption)
    if (command) fields.command = command
  } else if (cb) {
    fields.kind = 'callback_query'
    fields.userId = cb.from.id
    if (cb.message) {
      fields.chatId = cb.message.chat.id
      if (cb.message.chat.type) fields.chatType = cb.message.chat.type
      fields.messageId = cb.message.message_id
    }
    // The action word of a callback payload (`pick:abc123` → `pick`), not its arguments.
    const action = cb.data?.split(/[:|]/)[0]
    if (action) fields.action = action
  } else if (update.my_chat_member) {
    fields.kind = 'my_chat_member'
    fields.chatId = update.my_chat_member.chat.id
    fields.chatType = update.my_chat_member.chat.type
  } else {
    fields.kind = 'other'
  }
  return fields
}

export type ChatMembershipEvent =
  | 'added' | 'removed' | 'promoted' | 'demoted' | 'restricted' | 'unrestricted' | 'changed'
  | 'migrated_to' | 'migrated_from'

const PRESENT = new Set(['member', 'administrator', 'creator', 'restricted'])
const ADMIN = new Set(['administrator', 'creator'])

function classify(oldStatus: string, newStatus: string): ChatMembershipEvent {
  const wasIn = PRESENT.has(oldStatus)
  const isIn = PRESENT.has(newStatus)
  if (!wasIn && isIn) return 'added'
  if (wasIn && !isIn) return 'removed'
  if (!ADMIN.has(oldStatus) && ADMIN.has(newStatus)) return 'promoted'
  if (ADMIN.has(oldStatus) && !ADMIN.has(newStatus)) return 'demoted'
  if (newStatus === 'restricted') return 'restricted'
  if (oldStatus === 'restricted') return 'unrestricted'
  return 'changed'
}

/**
 * Fields for a change in the BOT's own membership of a chat (Telegram's `my_chat_member`): added,
 * removed or kicked, promoted to or demoted from admin, restricted. `at` is Telegram's timestamp
 * for the change, not the time we received it.
 */
export function describeMyChatMember(u: ChatMemberUpdated): Record<string, unknown> {
  return {
    event: classify(u.old_chat_member.status, u.new_chat_member.status),
    chatId: u.chat.id,
    chatType: u.chat.type,
    ...(u.chat.title ? { chatTitle: u.chat.title } : {}),
    byUserId: u.from.id,
    oldStatus: u.old_chat_member.status,
    newStatus: u.new_chat_member.status,
    at: new Date(u.date * 1000).toISOString(),
  }
}

/**
 * A group upgraded to a supergroup gets a NEW chat id; Telegram announces it with a service
 * message in each chat — `migrate_to_chat_id` in the old group, `migrate_from_chat_id` in the new
 * supergroup. Logging both is what lets an id from before the migration be followed after it.
 * Undefined for any other message.
 */
export function describeChatMigration(msg: NonNullable<LoggableUpdate['message']>): Record<string, unknown> | undefined {
  const at = msg.date !== undefined ? { at: new Date(msg.date * 1000).toISOString() } : {}
  if (msg.migrate_to_chat_id !== undefined) {
    return { event: 'migrated_to', chatId: msg.chat.id, chatType: msg.chat.type, toChatId: msg.migrate_to_chat_id, ...at }
  }
  if (msg.migrate_from_chat_id !== undefined) {
    return { event: 'migrated_from', chatId: msg.chat.id, chatType: msg.chat.type, fromChatId: msg.migrate_from_chat_id, ...at }
  }
  return undefined
}
