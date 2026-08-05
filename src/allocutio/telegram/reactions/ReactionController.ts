import { REACTION } from '../../lexicon/symbols.js'

/** Fire-and-forget reaction on a message (the adapter wires the platform call). */
export interface ReactionSink { react(chatId: number, messageId: number, emoji: string): void }

export interface ReactionConfig {
  /** Delay before the speculative cold-start 👌 fires (so a warm signal can preempt it). */
  okDelayMs?: number
  /** Delay before the warm 🔥 fires (lands after the command's instant 🤔, dodges rate-limit). */
  fireDelayMs?: number
}

const OK_DELAY_MS = 800
const FIRE_DELAY_MS = 500

/**
 * ReactionController — owns the command-message reaction choreography:
 *   cold start → 🤔 (by the adapter on receipt) then a deferred 👌
 *   warm reuse → 🤔 then 🔥, never 👌
 *
 * The warm signal (`noteWarm`) can arrive before OR after the actum registers. Either
 * way it cancels the pending 👌 *synchronously* before scheduling 🔥, so a warm run
 * cannot flash 👌 (the prior design left this to millisecond timer luck). Isolated and
 * testable, with no platform coupling beyond a ReactionSink.
 */
export class ReactionController {
  private readonly pending = new Map<string, { chatId: number; commandMessageId?: number; okTimer?: ReturnType<typeof setTimeout> }>()
  private readonly warmStash = new Set<string>()   // warm signals seen before registration

  constructor(private readonly sink: ReactionSink, private readonly config: ReactionConfig = {}) {}

  /** A Stream(running) registered for this actum on `commandMessageId`'s chat. */
  register(actumId: string, chatId: number, commandMessageId?: number): void {
    const entry: { chatId: number; commandMessageId?: number; okTimer?: ReturnType<typeof setTimeout> } = { chatId, commandMessageId }
    this.pending.set(actumId, entry)
    if (this.warmStash.delete(actumId)) {
      // Warm reuse already known → 🔥, never 👌.
      this._fire(chatId, commandMessageId, REACTION.fire)
    } else if (commandMessageId !== undefined) {
      // Defer the 👌 so a warm signal arriving just after registration can cancel it.
      const t = setTimeout(() => this.sink.react(chatId, commandMessageId, REACTION.ok), this.config.okDelayMs ?? OK_DELAY_MS)
      t.unref?.()
      entry.okTimer = t
    }
  }

  /** A warm pod was found for this actum (may arrive before or after register). */
  noteWarm(actumId: string): void {
    const p = this.pending.get(actumId)
    if (!p) { this.warmStash.add(actumId); return }
    if (p.okTimer) { clearTimeout(p.okTimer); p.okTimer = undefined }   // never flash 👌
    this._fire(p.chatId, p.commandMessageId, REACTION.fire)
  }

  /** Job reached a terminal state — cancel any pending 👌 and forget the actum. */
  clear(actumId: string): void {
    const p = this.pending.get(actumId)
    if (p?.okTimer) clearTimeout(p.okTimer)
    this.pending.delete(actumId)
    this.warmStash.delete(actumId)
  }

  private _fire(chatId: number, commandMessageId: number | undefined, emoji: string): void {
    if (commandMessageId === undefined) return
    const t = setTimeout(() => this.sink.react(chatId, commandMessageId, emoji), this.config.fireDelayMs ?? FIRE_DELAY_MS)
    t.unref?.()
  }
}
