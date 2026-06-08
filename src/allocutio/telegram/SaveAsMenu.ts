// =============================================================================
// SaveAsMenu — "Save as my flow": flow card / delivery-info → a derived Modus
// =============================================================================
//
// TASK-006 / ADR-0003 §2. From the flow card (`a:saveas`) or the delivery-info
// tab (`dm:save:<actumId>`) the user registers the current configuration as a
// derived `Modus` they own: it captures the flow's `intellae` (incl. pinned
// LoRAs), the config as `Porta.default`s, a prompt mode (open/pinned), a
// global-unique slug, and a `fonte` parent link. `/run <slug>` then runs it.
//
// Built on the force-reply / takeReply pattern (like Mod • → Add), NOT the flow
// router — the delivery-info entry has no active flow context. Self-contained
// subsystem: it owns its pending-name registry + per-user draft, knowing nothing
// Telegram-specific beyond the PromptSender slice.

import type { Modorum, Modus, AuctorKey } from '../../types/modus.js'
import { deriveSavedModus, type PromptMode } from '../../crystal/deriveSavedModus.js'
import { COPY } from '../lexicon/copy.js'

/** Slug rule — mirrors CommandRouter's FLOW_SLUG_RE (what `/run <slug>` accepts). */
const FLOW_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** The captured configuration to save — from the flow card's state or the Actum. */
export interface SaveAsSeed {
  /** The base (canonical) modus id to fork from. */
  baseModusId: string
  /** The captured config values (flow-card `state.aditus` / `actum.aditus`). */
  aditus: Record<string, unknown>
  /** The pinned loadout LoRAs (`state.pinnedModels` / `actum.pinnedModels`). */
  pinned?: Array<{ id: string }>
}

/** A draft awaiting confirmation — the named, slugged seed + chosen prompt mode. */
interface Draft {
  chatId: number
  userId: string
  base: Modus
  seed: SaveAsSeed
  slug: string
  name: string
  promptMode: PromptMode
}

interface PendingName {
  chatId: number
  userId: string
  seed: SaveAsSeed
  expiresAt: number
}

/** The slice of the sender this needs — post (force-reply) + edit the review in place. */
export interface SaveAsSink {
  sendMessage(chatId: number, text: string, extra?: { reply_markup?: unknown }): Promise<{ message_id: number }>
  editMessageText?(chatId: number, messageId: number, text: string, extra?: { reply_markup?: unknown }): Promise<void>
  deleteMessage?(chatId: number, messageId: number): Promise<void>
}

export interface SaveAsDeps {
  sink: SaveAsSink
  modorum: Modorum
  /** Resolve the presser → owner AuctorKey (the save-flow's auctor). */
  resolveOwner(userId: string): Promise<AuctorKey>
}

/** Turn a human name into a slug; returns null when nothing usable remains. */
export function slugify(name: string): string | null {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug && FLOW_SLUG_RE.test(slug) ? slug : null
}

export class SaveAsMenu {
  private static readonly TTL_MS = 5 * 60 * 1000
  /** Live force-reply name prompts: prompt message_id → the awaiting seed. */
  private readonly pendingNames = new Map<number, PendingName>()
  /** Drafts awaiting Save/Cancel: review message_id → the draft. */
  private readonly drafts = new Map<number, Draft>()

  constructor(private readonly deps: SaveAsDeps) {}

  /**
   * Open the menu (from either entry) by resolving the base modus and posting the
   * force-reply name prompt. Returns false when the base can't be resolved.
   */
  async open(chatId: number, userId: string, seed: SaveAsSeed): Promise<boolean> {
    const base = await this.deps.modorum.find(seed.baseModusId).catch(() => null)
    if (!base) return false
    const sent = await this.deps.sink
      .sendMessage(chatId, COPY.saveAs.namePrompt, { reply_markup: { force_reply: true } })
      .catch(() => null)
    if (!sent) return false
    this.pendingNames.set(sent.message_id, { chatId, userId, seed, expiresAt: Date.now() + SaveAsMenu.TTL_MS })
    return true
  }

  /**
   * Consume a reply to a live name prompt. Validates the slug, builds the draft, and
   * renders the review (models + config + prompt-mode toggle + Save/Cancel). Returns
   * true when the reply was ours (so the adapter clears the exchange), else false.
   */
  async takeReply(repliedTo: number, chatId: number, userId: string, text: string): Promise<boolean> {
    const entry = this.pendingNames.get(repliedTo)
    if (!entry) return false
    if (entry.expiresAt < Date.now()) { this.pendingNames.delete(repliedTo); return false }
    if (entry.chatId !== chatId || entry.userId !== userId) return false

    const name = text.trim()
    if (name === '') return false  // empty reply → leave the prompt alive for a retry
    this.pendingNames.delete(repliedTo)

    const slug = slugify(name)
    if (!slug) {
      await this.deps.sink.sendMessage(chatId, COPY.saveAs.badName).catch(() => {})
      return true
    }

    const base = await this.deps.modorum.find(entry.seed.baseModusId).catch(() => null)
    if (!base) return true

    const draft: Draft = { chatId, userId, base, seed: entry.seed, slug, name, promptMode: 'open' }
    const sent = await this.deps.sink
      .sendMessage(chatId, this._reviewText(draft), { reply_markup: this._reviewKeyboard() })
      .catch(() => null)
    if (sent) this.drafts.set(sent.message_id, draft)
    return true
  }

  /**
   * Handle a `sa:` review callback (`toggle` / `save` / `cancel`). `messageId` is the
   * review message the button rode on. Returns true when it was a draft we own.
   */
  async handle(messageId: number, action: string, chatId: number, userId: string): Promise<boolean> {
    const draft = this.drafts.get(messageId)
    if (!draft) return false
    if (draft.chatId !== chatId || draft.userId !== userId) return false

    switch (action) {
      case 'toggle':
        draft.promptMode = draft.promptMode === 'open' ? 'pinned' : 'open'
        await this.deps.sink.editMessageText?.(chatId, messageId, this._reviewText(draft), { reply_markup: this._reviewKeyboard() }).catch(() => {})
        return true
      case 'cancel':
        this.drafts.delete(messageId)
        await this.deps.sink.deleteMessage?.(chatId, messageId).catch(() => {})
        return true
      case 'save':
        this.drafts.delete(messageId)
        await this._save(draft, messageId)
        return true
    }
    return false
  }

  /** Collision check (global-unique) → derive + register → confirm. */
  private async _save(draft: Draft, messageId: number): Promise<void> {
    // Global uniqueness — no two flows share a slug. `find(slug)` must be null.
    const clash = await this.deps.modorum.find(draft.slug).catch(() => null)
    if (clash) {
      await this.deps.sink.editMessageText?.(draft.chatId, messageId, COPY.saveAs.nameTaken(draft.slug)).catch(() => {})
      return
    }

    const owner = await this.deps.resolveOwner(draft.userId)
    const modus = deriveSavedModus(draft.base, {
      slug: draft.slug,
      name: draft.name,
      owner,
      aditus: draft.seed.aditus,
      promptMode: draft.promptMode,
      pinned: draft.seed.pinned,
    })
    await this.deps.modorum.register(modus)
    await this.deps.sink.editMessageText?.(draft.chatId, messageId, COPY.saveAs.saved(draft.slug)).catch(() => {})
  }

  // ── render ──────────────────────────────────────────────────────────────────

  private _reviewText(draft: Draft): string {
    const intellae = [
      ...(draft.base.intellae ?? []),
      ...((draft.seed.pinned ?? []).map(p => ({ id: p.id, role: 'lora' }))),
    ]
    const models = intellae.map(i => `• ${i.id} (${i.role})`).join('\n') || '—'

    const config = Object.entries(draft.seed.aditus)
      .filter(([k]) => !(k === 'prompt' && draft.promptMode === 'open'))
      .map(([k, v]) => `• ${k}: ${String(v)}`)
      .join('\n') || '—'

    return [
      COPY.saveAs.reviewHeader(draft.slug),
      '',
      COPY.saveAs.modelsLabel,
      models,
      '',
      COPY.saveAs.configLabel,
      config,
      '',
      COPY.saveAs.affixPlaceholder,
    ].join('\n')
  }

  private _reviewKeyboard(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
    return {
      inline_keyboard: [
        [{ text: COPY.saveAs.promptOpen, callback_data: 'sa:toggle' }],
        [
          { text: COPY.saveAs.confirmButton, callback_data: 'sa:save' },
          { text: COPY.saveAs.cancelButton, callback_data: 'sa:cancel' },
        ],
      ],
    }
  }
}
