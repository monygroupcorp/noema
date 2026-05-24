import type { StageInfo } from '../../../lib/bus.js'
import { PodSession } from './PodSession.js'
import { BulletinView } from './BulletinView.js'
import { TimerRegistry } from './TimerRegistry.js'
import {
  AUTO_SETTLE_MS, HUNT_SLOW_MS,
  type Audience, type BulletinKeyboard,
} from './types.js'

/** The only I/O the bulletin subsystem needs — the platform adapter implements it. */
export interface BulletinSink {
  /** Post a new bulletin message; return its id (or null on failure). */
  post(chatId: number, text: string, keyboard: BulletinKeyboard): Promise<number | null>
  edit(chatId: number, messageId: number, text: string, keyboard: BulletinKeyboard): Promise<void>
  remove(chatId: number, messageId: number): Promise<void>
}

export interface BulletinDeps {
  sink: BulletinSink
  terminatePod?: (podId: string) => Promise<void>
  cancelActum?: (actumId: string, reason: string) => Promise<boolean>
  setPodWarmUntil?: (podId: string, ttlMs: number) => Promise<void>
  /**
   * Set the studio's `drainOnly` flag — refuses new guest gens; in-flight finish;
   * idle reaper terminates when the queue drains. Wired to Materia.update in the
   * adapter; absent in tests where we only assert the bulletin's local state.
   */
  drainStudio?: (podId: string) => Promise<void>
  /**
   * Mint or fetch a share-token URL for the studio. Wired to the Phase B share-token
   * machinery in the adapter. Returns the full URL (including the `pod_<token>` deep
   * link). Optional — Share submenu falls back to a "share unavailable" message.
   */
  fetchShareUrl?: (podId: string) => Promise<string | null>
  /** Resolve the loadout summary text for `Mod • → View loadout`. */
  fetchLoadout?: (podId: string) => Promise<string | undefined>
  /** No-interaction window before the warm choice auto-confirms. Default 20s. */
  autoSettleMs?: number
  now?: () => number
}

const RENEW_MS = 8_000   // hop-to-bottom debounce

interface ChatBulletin {
  session: PodSession
  messageId: number | null
  lastShown?: string          // text + keyboard signature, for dedupe
  timers: TimerRegistry
}

/**
 * BulletinManager — owns the live bulletins, routes pod lifecycle into PodSessions,
 * orchestrates all timers (slow-hunt, auto-settle, hop-to-bottom), and drives renders
 * through a BulletinSink. Platform-agnostic: it knows nothing about Telegram.
 *
 * Today it holds one PodSession per chat; the structure (a ChatBulletin owning a
 * session, its own TimerRegistry, and a render) is shaped to grow to N sessions and
 * host/guest audiences without touching the adapter.
 */
export class BulletinManager {
  private readonly chats = new Map<number, ChatBulletin>()
  private readonly actumChat = new Map<string, number>()   // actumId → chatId

  constructor(private readonly deps: BulletinDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)() }

  /** A new actum is starting in a chat. Reuse the live session (warm reuse) or open a fresh one. */
  register(chatId: number, actumId: string, hostUserId: string, audience: Audience = 'host'): void {
    this.actumChat.set(actumId, chatId)
    let cb = this.chats.get(chatId)
    if (!cb || cb.session.ended) {
      // A receipted bulletin is final history — start fresh (new message at the bottom).
      cb?.timers.cancelAll()
      cb = { session: new PodSession(hostUserId, audience), messageId: null, timers: new TimerRegistry() }
      this.chats.set(chatId, cb)
      this._armAutoSettle(chatId)
    }
    void this._render(chatId)
  }

  onStage(actumId: string, stage: string, info?: StageInfo): void {
    const chatId = this.actumChat.get(actumId)
    if (chatId === undefined) return
    const cb = this.chats.get(chatId)
    if (!cb) return
    cb.session.onStage(stage, info, this.now())
    // Slow-hunt timer follows the phase: armed while hunting, cleared otherwise.
    if (cb.session.phase === 'hunting') {
      cb.timers.arm('slowHunt', HUNT_SLOW_MS, () => { cb.session.markHuntSlow(); void this._render(chatId) })
    } else {
      cb.timers.cancel('slowHunt')
    }
    void this._render(chatId)
  }

  onComplete(actumId: string, result: { costUsd?: number; execMs?: number; podId?: string }): void {
    const chatId = this.actumChat.get(actumId)
    if (chatId === undefined) return
    const cb = this.chats.get(chatId)
    if (!cb) return
    cb.timers.cancel('slowHunt')
    cb.session.recordGen({ costUsd: result.costUsd, execMs: result.execMs })
    // Apply the chosen warm window to the pod (overrides the reaper's default TTL).
    const podId = cb.session.podId ?? result.podId
    if (podId) void this.deps.setPodWarmUntil?.(podId, cb.session.warmTtlMs)
    void this._render(chatId)
    this._scheduleRenew(chatId)
    // Drop the actum→chat mapping a little after the warm window lapses.
    setTimeout(() => this.actumChat.delete(actumId), cb.session.warmTtlMs + 5_000).unref?.()
  }

  onFail(actumId: string): void {
    const chatId = this.actumChat.get(actumId)
    this.actumChat.delete(actumId)
    if (chatId === undefined) return
    const cb = this.chats.get(chatId)
    if (!cb) return
    cb.timers.cancel('slowHunt')
    cb.session.clearLive()
    void this._render(chatId)
  }

  /** A warm pod was reaped — freeze its bulletin to a receipt. */
  onReaped(externusId: string): void {
    for (const [chatId, cb] of this.chats) {
      if (cb.session.podId === externusId && !cb.session.ended) {
        cb.timers.cancelAll()
        cb.session.end()
        void this._render(chatId)
      }
    }
  }

  /** Bulletin button callbacks. refresh is public; the rest are host-only. */
  async handleControl(chatId: number, fromUserId: string, action: string): Promise<void> {
    const cb = this.chats.get(chatId)
    if (!cb || action === 'noop') return
    const s = cb.session
    const isHost = fromUserId === s.hostUserId

    switch (action) {
      case 'refresh': await this._render(chatId, { renew: true }); return
      case 'dec': case 'inc':
        if (!isHost) return
        s.stepWarm(action)
        if (s.podId) void this.deps.setPodWarmUntil?.(s.podId, s.warmTtlMs)
        this._armAutoSettle(chatId)   // interacting resets the no-interaction clock
        await this._render(chatId)
        return
      case 'confirm':
        if (!isHost) return
        cb.timers.cancel('settle')
        s.setConfirmed(true)
        await this._render(chatId)
        return
      case 'time':
        if (!isHost) return
        s.setConfirmed(false)
        this._armAutoSettle(chatId)
        await this._render(chatId)
        return

      // ── Top-3 submenu openers (Phase D bulletin sprint) ───────────────────
      case 'mod':
      case 'share':
      case 'destroy':
        if (!isHost) return
        s.openSubmenu(action)
        // Lazy-fetch loadout summary on mod-open so it's ready when View loadout fires.
        if (action === 'mod' && s.podId && this.deps.fetchLoadout) {
          void this.deps.fetchLoadout(s.podId).then(text => { s.setLoadoutSummary(text); void this._render(chatId) })
        }
        await this._render(chatId)
        return

      case 'submenu.back':
        if (!isHost) return
        s.openSubmenu(null)
        s.setLoadoutSummary(undefined)
        await this._render(chatId)
        return

      // ── Destroy submenu ───────────────────────────────────────────────────
      case 'destroy.now':
      case 'kill':            // backwards-compat alias from before the submenu existed
        if (!isHost) return
        if (s.podId) void this.deps.terminatePod?.(s.podId)
        // Cancel-on-destroy: refund any gen still in flight on this chat's pod.
        if (this.deps.cancelActum) {
          for (const [actumId, c] of this.actumChat) {
            if (c === chatId) void this.deps.cancelActum(actumId, 'cancelled by user — pod shut down').catch(() => {})
          }
        }
        cb.timers.cancelAll()
        s.openSubmenu(null)
        s.end()
        await this._render(chatId)
        return

      case 'destroy.drain':
        if (!isHost) return
        // Flag the studio drain-only — admission refuses new gens; idle reaper
        // terminates when the queue drains. Bulletin stays alive; the host can
        // still see in-flight gens complete.
        if (s.podId) void this.deps.drainStudio?.(s.podId)
        s.openSubmenu(null)
        await this._render(chatId)
        return

      // ── Share submenu (uses Phase B shareToken machinery) ─────────────────
      case 'share.copy':
      case 'share.forward':
        if (!isHost) return
        // Both variants share the same source URL; the platform adapter decides
        // how to surface it (Copy → reply with link; Forward → telegram-share intent).
        // BulletinManager's job is just to close the submenu after the action;
        // the adapter does the actual sending via its own sender contract.
        if (s.podId && this.deps.fetchShareUrl) {
          void this.deps.fetchShareUrl(s.podId).catch(() => null)
        }
        s.openSubmenu(null)
        await this._render(chatId)
        return

      // ── Mod submenu stub (View loadout shows current image in body) ───────
      case 'mod.view':
        if (!isHost) return
        // The fetch was kicked off when the submenu opened; just re-render so
        // it appears even if it raced past the open render.
        await this._render(chatId)
        return
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _armAutoSettle(chatId: number): void {
    const cb = this.chats.get(chatId)
    if (!cb || cb.session.confirmed || cb.session.ended) return
    cb.timers.arm('settle', this.deps.autoSettleMs ?? AUTO_SETTLE_MS, () => {
      const c = this.chats.get(chatId)
      if (!c || c.session.confirmed || c.session.ended) return
      c.session.setConfirmed(true)
      void this._render(chatId)
    })
  }

  private _scheduleRenew(chatId: number): void {
    const cb = this.chats.get(chatId)
    if (!cb || cb.session.ended) return
    cb.timers.arm('renew', RENEW_MS, () => { void this._render(chatId, { renew: true }) })
  }

  private async _render(chatId: number, opts: { renew?: boolean } = {}): Promise<void> {
    const cb = this.chats.get(chatId)
    if (!cb) return
    const { text, keyboard } = BulletinView.render(cb.session.snapshot())
    const sig = text + ' ' + JSON.stringify(keyboard)

    if (cb.messageId !== null && !opts.renew) {
      if (sig === cb.lastShown) return    // dedupe no-op edits (heartbeats etc.)
      cb.lastShown = sig
      await this.deps.sink.edit(chatId, cb.messageId, text, keyboard)
      return
    }
    const old = cb.messageId
    const id = await this.deps.sink.post(chatId, text, keyboard)
    if (id !== null) {
      cb.messageId = id
      cb.lastShown = sig
      if (old !== null) void this.deps.sink.remove(chatId, old)
    }
    if (!opts.renew) this._scheduleRenew(chatId)
  }
}
