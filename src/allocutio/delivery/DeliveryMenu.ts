import type { Actum } from '../../types/actum.js'
import type { UiKeyboard } from '../ui/Keyboard.js'
import { RATE_EMOJI, menuKeyboard, formatStats, type MenuState } from './DeliveryView.js'

/** The only I/O the delivery menu needs — the platform adapter implements it. */
export interface DeliverySink {
  editMarkup(chatId: number, messageId: number, keyboard: UiKeyboard): Promise<void>
  editCaption(chatId: number, messageId: number, text: string, keyboard: UiKeyboard): Promise<void>
  editText(chatId: number, messageId: number, text: string, keyboard: UiKeyboard): Promise<void>
}

export interface DeliveryDeps {
  sink: DeliverySink
  acta?: { findById(id: string): Promise<Actum | null> }
  /** Re-run the actum under the presser (presser pays). Adapter wires the flow router. */
  rerun: (actumId: string, presserUserId: string) => Promise<void>
}

interface ResultMeta {
  chatId: number
  messageId: number
  caption: string
  isMedia: boolean
  showingStats: boolean
  rateGlyph: string
}

/**
 * DeliveryMenu — owns the morphing result row (Info / Rate / Wrench) and the
 * per-result state behind it (the Info caption toggle, the chosen rating glyph).
 * Platform-agnostic: it edits results through a DeliverySink and reads stats from
 * the durable actum, knowing nothing Telegram-specific.
 */
export class DeliveryMenu {
  private readonly meta = new Map<string, ResultMeta>()

  constructor(private readonly deps: DeliveryDeps) {}

  /** The keyboard a freshly-delivered result starts with (the default row). */
  initialKeyboard(actumId: string): UiKeyboard {
    return menuKeyboard(actumId, 'default')
  }

  /** Remember a delivered result so its menu can morph/toggle in place. */
  track(actumId: string, m: { chatId: number; messageId: number; caption: string; isMedia: boolean }): void {
    this.meta.set(actumId, { ...m, showingStats: false, rateGlyph: '♥' })
  }

  /** Handle a `dm:` callback. `action` is the verb; `ratedType`/`presserUserId` as needed. */
  async handle(actumId: string, action: string, opts: { ratedType?: string; presserUserId?: string } = {}): Promise<void> {
    const meta = this.meta.get(actumId)
    const morph = (state: MenuState, glyph?: string) => {
      if (meta) void this.deps.sink.editMarkup(meta.chatId, meta.messageId, menuKeyboard(actumId, state, glyph)).catch(() => {})
    }

    switch (action) {
      case 'rate':   morph('rate'); return
      case 'wrench': morph('wrench'); return
      case 'back':   morph('default', meta?.rateGlyph); return
      case 'info':   await this._toggleInfo(actumId); return
      case 'rated': {
        const glyph = RATE_EMOJI[opts.ratedType ?? ''] ?? '♥'
        if (meta) meta.rateGlyph = glyph
        // Rating is feedback on a result — it must NOT route through the user's flow
        // (which can re-deliver during AWAITING_COMPLETION). Just reflect the choice;
        // durable rating persistence is a separate (ratings-store) follow-up.
        morph('default', glyph)
        return
      }
      case 'tweak':
      case 'rerun':
        if (opts.presserUserId) await this.deps.rerun(actumId, opts.presserUserId)
        return
    }
  }

  /** Toggle the result's caption between the original caption and the stats block. */
  private async _toggleInfo(actumId: string): Promise<void> {
    const meta = this.meta.get(actumId)
    if (!meta) return
    const keyboard = menuKeyboard(actumId, 'default', meta.rateGlyph)
    const text = meta.showingStats
      ? meta.caption
      : formatStats(await this.deps.acta?.findById(actumId).catch(() => null) ?? null)
    meta.showingStats = !meta.showingStats
    const fn = meta.isMedia ? this.deps.sink.editCaption : this.deps.sink.editText
    await fn.call(this.deps.sink, meta.chatId, meta.messageId, text, keyboard).catch(() => {})
  }
}
