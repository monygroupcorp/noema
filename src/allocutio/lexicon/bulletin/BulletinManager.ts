import type { StageInfo } from '../../../lib/bus.js'
import { PodSession } from './PodSession.js'
import { BulletinView } from './BulletinView.js'
import { TimerRegistry } from './TimerRegistry.js'
import { COPY } from '../copy.js'
import {
  AUTO_SETTLE_MS, HUNT_SLOW_MS,
  type Audience, type BulletinKeyboard, type PendingModel, type Loadout, type ModelDetail, type ArmPreset,
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
  /** Resolve the studio's loadout (model base) — shown as the body when `Mod •` opens. */
  fetchLoadout?: (podId: string) => Promise<Loadout | undefined>
  /**
   * Catalog hooks for the `Mod • → Add` picker. The list/search hooks return the FULL
   * candidate list; the manager paginates in-memory (and caches per chat so page turns
   * don't refetch). Backed by `Intellarum`/`Materia` in the adapter — Intella ids, the
   * id-space the compile/install rail resolves. Absent → the picker degrades gracefully
   * (no categories / empty list).
   *
   * - `listCategories` — the mount-location types present in the catalog, popular-first.
   * - `listMount` — models in a mount; for the LoRA folder, scoped to the studio's base(s)
   *   unless `allBases`. Returns a `baseLabel` ⟺ the mount supports base filtering.
   * - `searchModels` — free-text matches, flat across mounts.
   */
  listCategories?: () => Promise<string[]>
  listMount?: (mount: string, opts: { baseFilter?: string }) => Promise<{ items: PendingModel[]; baseFamilies?: Array<{ id: string; label: string }>; baseFilter?: string }>
  searchModels?: (query: string) => Promise<PendingModel[]>
  /** Resolve trigger word(s) → LoRAs (the way the gen does), scoped to the studio's base family.
   *  `matched` are added to the standby loadout; `unmatched` tokens are surfaced for feedback. */
  resolveTriggers?: (text: string, opts: { family?: string }) => Promise<{ matched: PendingModel[]; unmatched: string[] }>
  /** Resolve a model's detail card (Mod • → tap a model name). */
  fetchDetail?: (intellaId: string) => Promise<ModelDetail | undefined>
  /** `/arm` Start: provision a warm studio (no gen) with the chosen loadout. Returns the pod
   *  it parked (+ telemetry for the journal), or null if provisioning failed/unavailable. */
  startStudio?: (chatId: number, opts: { models: PendingModel[]; runtime?: string }, onStage?: (stage: string, info?: StageInfo) => void) => Promise<{ podId: string; gpuType?: string; costPerHr?: number; provisionMs?: number } | null>
  /** Live model-apply: download model(s) onto a warm pod (no gen) and merge into installedModels.
   *  Returns the new installed set, or null on failure/unavailable. */
  installModels?: (podId: string, intellaIds: string[]) => Promise<{ installedModels: string[] } | null>
  /** `/arm` wizard: curated quick-start presets (flows), available container images, and the
   *  runtimes/configs for a chosen image (Custom path). */
  listPresets?: () => Promise<ArmPreset[]>
  listImages?: () => Promise<string[]>
  listConfigs?: (image: string) => Promise<string[]>
  /** Surface a search prompt the host replies to (force-reply in Telegram); the adapter
   *  forwards the reply text back via `applyPickerSearch`. `hostUserId` lets the adapter
   *  accept the reply only from the host (a group's other members can see the prompt).
   *  Absent → Search is a no-op. */
  promptSearch?: (chatId: number, hostUserId: string) => Promise<void>
  /** Surface a trigger-word prompt the host replies to; the adapter forwards the reply back via
   *  `applyPickerTriggers`. Absent → By-trigger is a no-op. */
  promptTrigger?: (chatId: number, hostUserId: string) => Promise<void>
  /** Picker page size — buttons per page. Default 8 (fits a Telegram inline keyboard). */
  pickerPageSize?: number
  /** No-interaction window before the warm choice auto-confirms. Default 20s. */
  autoSettleMs?: number
  now?: () => number
}

const PICKER_PAGE_SIZE = 8

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
  /** Full candidate list (+ resolved base families/filter for a LoRA mount) backing the open
   *  picker list, per chat — so page turns don't refetch. */
  private readonly pickerCache = new Map<number, { all: PendingModel[]; base?: { families: Array<{ id: string; label: string }>; filter: string } }>()
  /** Monotonic fetch generation per chat — guards against out-of-order catalog results when
   *  two loads race (e.g. a search reply interleaving a filter tap). Only the latest applies. */
  private readonly pickerFetchGen = new Map<number, number>()

  constructor(private readonly deps: BulletinDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)() }

  /** A new actum is starting in a chat. Reuse the live session (warm reuse) or open a fresh one. */
  register(chatId: number, actumId: string, hostUserId: string, audience: Audience = 'host'): void {
    this.actumChat.set(actumId, chatId)
    let cb = this.chats.get(chatId)
    if (!cb || cb.session.ended) {
      // A receipted bulletin is final history — start fresh (new message at the bottom).
      cb?.timers.cancelAll()
      this.pickerCache.delete(chatId)
      this.pickerFetchGen.delete(chatId)
      cb = { session: new PodSession(hostUserId, audience), messageId: null, timers: new TimerRegistry() }
      this.chats.set(chatId, cb)
      this._armAutoSettle(chatId)
    }
    void this._render(chatId)
  }

  /**
   * `/arm` — open a standalone Mod • menu: a pod-less, timer-less session that lands straight
   * in the Mod • submenu (loadout + Add), so a host can build a loadout pre-gen without the
   * bulletin's warm clock. The session stays live, so the queued loadout carries to the next
   * `/make` (which reuses the chat's live session).
   */
  async arm(chatId: number, hostUserId: string): Promise<void> {
    this.chats.get(chatId)?.timers.cancelAll()
    this.pickerCache.delete(chatId)
    this.pickerFetchGen.delete(chatId)
    const session = new PodSession(hostUserId)
    this.chats.set(chatId, { session, messageId: null, timers: new TimerRegistry() })
    // Begin at the preset step (curated flows; Custom → image → config → then the model menu).
    // No auto-settle / reap armed → persists until the host walks through or dismisses it.
    await this._beginArm(session)
    await this._render(chatId)
  }

  /** A committed flow resolves to the same spec a Custom build-out arrives at: container image +
   *  runtime + the base models it bundles, grouped under the flow as one architectura. */
  private _loadoutFromPreset(p: ArmPreset): Loadout {
    return {
      ...(p.image ? { image: p.image } : {}),
      ...(p.config ? { runtime: p.config } : {}),
      ...(typeof p.vramGb === 'number' ? { vramGb: p.vramGb } : {}),
      categories: p.models?.length
        ? [{ architectura: p.label, bases: p.models.map(nomen => ({ nomen, loras: [] })) }]
        : [],
    }
  }

  /** Add a flow to the armed loadout, or — if its runtime conflicts with what's already armed
   *  (one pod = one runtime) — leave the loadout untouched and surface a notice on the chooser. */
  private _addFlowOrNote(s: PodSession, preset: ArmPreset): void {
    const have = s.loadout?.runtime
    const added = s.addFlow(preset.id, this._loadoutFromPreset(preset))
    if (!added && have && preset.config) s.setArmNote(COPY.bulletin.arm.runtimeConflict(have, preset.config))
  }

  /** Enter (or re-enter) the /arm flow chooser at the preset step. Re-fetches the curated
   *  presets + images each time; the session's queued loadout is preserved across the hop. */
  private async _beginArm(session: PodSession): Promise<void> {
    const [presets, images] = await Promise.all([
      this.deps.listPresets ? this.deps.listPresets().catch(() => []) : Promise.resolve([]),
      this.deps.listImages ? this.deps.listImages().catch(() => []) : Promise.resolve([]),
    ])
    session.beginArm(presets, images)
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
        this.pickerCache.delete(chatId)
        this.pickerFetchGen.delete(chatId)
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

    // /arm wizard: preset chosen → Custom drops into the manual path; any other preset records
    // its base family and lands in the Mod • menu (loras there scope to that base).
    if (action.startsWith('arm.preset:')) {
      if (!isHost || s.arm?.step !== 'preset') return
      const i = Number(action.slice('arm.preset:'.length))
      const preset = Number.isInteger(i) ? s.arm.presets[i] : undefined
      if (preset) {
        if (preset.id === 'custom') {
          // A studio runs ONE container image. If a flow already fixed it, skip the image
          // chooser and drop straight onto its config step; otherwise pick the image first.
          const fixedImage = s.loadout?.image
          if (fixedImage) {
            const configs = this.deps.listConfigs ? await this.deps.listConfigs(fixedImage).catch(() => []) : []
            s.setArmImage(fixedImage, configs)
          } else {
            s.armToCustom()
          }
        }
        else this._addFlowOrNote(s, preset)   // add + stay on the chooser (reject runtime conflicts)
      }
      await this._render(chatId)
      return
    }
    // /arm wizard: a flow's name tapped → open its detail card (what it bundles before committing).
    if (action.startsWith('arm.flow:')) {
      if (!isHost || s.arm?.step !== 'preset') return
      const i = Number(action.slice('arm.flow:'.length))
      const preset = Number.isInteger(i) ? s.arm.presets[i] : undefined
      if (preset && preset.id !== 'custom') s.openFlowDetail(preset)
      await this._render(chatId)
      return
    }
    // /arm wizard: add the flow shown on its detail card → back to the chooser (layer more).
    if (action === 'arm.flowadd') {
      if (!isHost || s.arm?.step !== 'flowdetail') return
      const flow = s.arm.flow
      if (flow) this._addFlowOrNote(s, flow)
      await this._render(chatId)
      return
    }
    // /arm wizard: done picking flows → hand off to the Mod • loadout/Add menu.
    if (action === 'arm.proceed') {
      if (!isHost || s.arm?.step !== 'preset' || !s.loadout) return
      s.proceedArm()
      await this._render(chatId)
      return
    }
    // /arm wizard: cancel from the first layer → dismiss cleanly (no pod was ever provisioned).
    if (action === 'arm.cancel') {
      if (!isHost || !s.arm) return
      cb.timers.cancelAll()
      s.cancel()
      await this._render(chatId)
      return
    }
    // /arm wizard: image chosen → advance to the config step with that image's runtimes.
    if (action.startsWith('arm.image:')) {
      if (!isHost || s.arm?.step !== 'image') return
      const i = Number(action.slice('arm.image:'.length))
      const image = Number.isInteger(i) ? s.arm.images[i] : undefined
      if (image) {
        const configs = this.deps.listConfigs ? await this.deps.listConfigs(image).catch(() => []) : []
        s.setArmImage(image, configs)
      }
      await this._render(chatId)
      return
    }
    // /arm wizard: config chosen → finish, hand off to the Mod • loadout/Add menu.
    if (action.startsWith('arm.config:')) {
      if (!isHost || s.arm?.step !== 'config') return
      const i = Number(action.slice('arm.config:'.length))
      const config = Number.isInteger(i) ? s.arm.configs[i] : undefined
      // Custom resolves to the same spec view as a preset: image + runtime, models added after.
      if (config) s.finishArm({ ...(s.arm.image ? { image: s.arm.image } : {}), runtime: config, categories: [] })
      await this._render(chatId)
      return
    }

    // Mod • → Add: descend into a mount/category → its paginated list. If the studio was armed
    // with a preset flow, default the LoRA filter to that base family (listMount falls back to
    // all if it isn't a family in this mount).
    if (action.startsWith('mod.cat:')) {
      if (!isHost || !s.picker) return
      s.enterMount(action.slice('mod.cat:'.length))
      if (s.armBase) s.setBaseFilter(s.armBase)
      await this._loadPicker(chatId)
      return
    }

    // Mod • → Add: open a model's detail card by `<token>:<index>` (same staleness guard
    // as picks). Fetches the card, then enters the detail sub-stage.
    if (action.startsWith('mod.detail:')) {
      if (!isHost || !s.picker) return
      const [tokenStr, idxStr] = action.slice('mod.detail:'.length).split(':')
      const token = Number(tokenStr), i = Number(idxStr)
      const item = (Number.isInteger(token) && token === s.picker.token && Number.isInteger(i)) ? s.picker.items[i] : undefined
      if (item && this.deps.fetchDetail) {
        const detail = await this.deps.fetchDetail(item.intellaId).catch(() => undefined)
        if (detail) s.openDetail(detail)
      }
      await this._render(chatId)
      return
    }

    // Mod • → Add: pick a catalog item by `<token>:<index>`. The token must match the
    // currently-displayed generation (else it's a stale button from a superseded view —
    // reject it); the index is then bounds-checked against the live page.
    if (action.startsWith('mod.pick:')) {
      if (!isHost || !s.picker) return
      const [tokenStr, idxStr] = action.slice('mod.pick:'.length).split(':')
      const token = Number(tokenStr), i = Number(idxStr)
      const fresh = Number.isInteger(token) && token === s.picker.token
      const item = fresh && Number.isInteger(i) ? s.picker.items[i] : undefined
      if (item) this._addModel(chatId, item)   // live-install on a warm studio, else queue. STAYS
      await this._render(chatId)                // in the list (rapid-add); the tail shows below.
      return
    }

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
        // Mod • body IS the loadout/spec — fetch it on open, then re-render to fill it in.
        if (action === 'mod' && s.podId && this.deps.fetchLoadout) {
          void this.deps.fetchLoadout(s.podId).then(l => { s.setLoadout(l); void this._render(chatId) }).catch(() => {})
        }
        await this._render(chatId)
        return

      case 'arm.back':
        if (!isHost || !s.arm) return
        if (s.arm.step === 'preset') {
          cb.timers.cancelAll()        // preset (first) step → dismiss (UI shows Cancel here now)
          s.cancel()
        } else {
          s.armBack()                  // config → image / flowdetail → preset
        }
        await this._render(chatId)
        return

      case 'submenu.back':
        if (!isHost) return
        // Picker-aware, two stages: from the list → back to the category stage; from the
        // category stage → close the picker (back to the loadout); no picker → close submenu.
        if (s.picker?.stage === 'detail') {
          s.backToList()                       // card → the list it was opened from (list state preserved)
        } else if (s.picker?.stage === 'list') {
          s.backToCategories()
          this.pickerCache.delete(chatId)
          this.pickerFetchGen.delete(chatId)
        } else if (s.picker) {
          this._closePicker(chatId)
        } else if (s.isArmedIdle) {
          // Armed but not yet launched → the flow chooser is the Mod • menu's parent. Re-open it
          // so the host can pick another flow / Custom and layer onto the queued loadout.
          await this._beginArm(s)
        } else {
          s.openSubmenu(null)
          s.setLoadout(undefined)
        }
        await this._render(chatId)
        return

      // ── Mod • → Add picker ────────────────────────────────────────────────
      case 'mod.add':
        if (!isHost) return
        s.openPicker()   // category stage; the picker sub-view replaces the loadout body
        if (this.deps.listCategories) {
          const cats = await this.deps.listCategories().catch(() => [])
          s.setPickerCategories(cats)
        }
        await this._render(chatId)
        return

      case 'mod.basefilter': {
        const p = s.picker
        if (!isHost || !p?.baseFamilies?.length) return
        const fams = p.baseFamilies
        const idx = fams.findIndex(f => f.id === (p.baseFilter ?? ''))
        s.setBaseFilter(fams[(idx + 1) % fams.length].id)   // cycle All → FLUX → SDXL → … → All
        await this._loadPicker(chatId)
        return
      }

      case 'mod.detailadd':
        if (!isHost || s.picker?.stage !== 'detail' || !s.picker.detail) return
        this._addModel(chatId, { intellaId: s.picker.detail.intellaId, nomen: s.picker.detail.nomen, genus: s.picker.detail.genus })
        this._closePicker(chatId)        // added → back to the loadout
        await this._render(chatId)
        return

      case 'mod.start':
        if (!isHost || s.podId) return    // only an armed, not-yet-provisioned studio can Start
        await this._startStudio(chatId)
        return

      case 'mod.page:prev':
      case 'mod.page:next':
        if (!isHost || !s.picker) return
        s.setPickerPage(s.picker.page + (action.endsWith('next') ? 1 : -1))
        this._paginate(chatId)           // re-slice from cache; no refetch on a page turn
        await this._render(chatId)
        return

      case 'mod.search':
        if (!isHost || !s.picker) return
        // Surface the search prompt; the reply comes back via `applyPickerSearch`.
        if (this.deps.promptSearch) void this.deps.promptSearch(chatId, s.hostUserId).catch(() => {})
        return

      case 'mod.trigger':
        if (!isHost || !s.picker) return
        // Surface the trigger-word prompt; the reply comes back via `applyPickerTriggers`.
        if (this.deps.promptTrigger) void this.deps.promptTrigger(chatId, s.hostUserId).catch(() => {})
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
        this.pickerCache.delete(chatId)
        this.pickerFetchGen.delete(chatId)
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

    }
  }

  /** The adapter calls this when the host replies to the search force-reply prompt. */
  async applyPickerSearch(chatId: number, query: string): Promise<void> {
    const cb = this.chats.get(chatId)
    const q = query.trim()
    if (!cb?.session.picker || q === '') return
    cb.session.setPickerQuery(q)
    await this._loadPicker(chatId)
  }

  /** The adapter calls this when the host replies to the trigger-word prompt. Resolves the
   *  trigger(s) → LoRAs (scoped to the studio's base family), adds matches to the standby loadout,
   *  and stays in the list with a one-line result so the host can keep adding. */
  async applyPickerTriggers(chatId: number, text: string): Promise<void> {
    const cb = this.chats.get(chatId)
    const s = cb?.session
    if (!s?.picker || !this.deps.resolveTriggers) return
    const { matched, unmatched } = await this.deps.resolveTriggers(text, s.armBase ? { family: s.armBase } : {}).catch(() => ({ matched: [], unmatched: [] }))
    for (const m of matched) this._addModel(chatId, m)
    s.setPickerNote(COPY.bulletin.mod.triggerResult(matched.map(m => m.nomen), unmatched))
    await this._render(chatId)
  }

  /** Add a picked/resolved model. On a warm-idle studio it installs LIVE onto the running pod (a
   *  background download, no gen); before a pod exists (armed / provisioning) it queues to Standby
   *  to fold into the boot job or next gen. (Decision 3: apply-semantics-by-state.) */
  private _addModel(chatId: number, item: PendingModel): void {
    const s = this.chats.get(chatId)?.session
    if (!s) return
    if (s.isWarmIdle && s.podId && this.deps.installModels) {
      s.beginInstalling(item)
      void this._installLive(chatId, s.podId, item)
    } else {
      s.queueModel(item)
    }
  }

  /** Background: download a model onto the warm pod, then move it from "Installing…" → installed
   *  (re-fetch the loadout so it reflects the pod's updated installedModels). */
  private async _installLive(chatId: number, podId: string, item: PendingModel): Promise<void> {
    const res = await this.deps.installModels?.(podId, [item.intellaId]).catch(() => null) ?? null
    const s = this.chats.get(chatId)?.session
    if (!s) return
    s.finishInstalling(item.intellaId)
    if (res && this.deps.fetchLoadout) {
      const loadout = await this.deps.fetchLoadout(podId).catch(() => undefined)
      if (loadout) s.setLoadout(loadout)
    }
    await this._render(chatId)
  }

  /** Models the host queued onto this chat's session loadout — read at /make dispatch
   *  (item 5) to stamp `aditus._pinnedModels`. Empty when no live session. */
  pendingModelsFor(chatId: number): readonly PendingModel[] {
    return this.chats.get(chatId)?.session.pendingModels ?? []
  }

  /** Clear the chat's pending loadout — called once a gen consumes it (committed at dispatch). */
  clearPendingFor(chatId: number): void {
    this.chats.get(chatId)?.session.clearPending()
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _pageSize(): number { return this.deps.pickerPageSize ?? PICKER_PAGE_SIZE }

  /** `/arm` Start — provision a warm studio with the queued loadout (no gen), then walk the
   *  session to a live, resting-warm state. The pending loadout becomes the studio's installed
   *  models (consumed). Leaves the Mod menu so the studio's journal shows. */
  private async _startStudio(chatId: number): Promise<void> {
    const cb = this.chats.get(chatId)
    const s = cb?.session
    if (!cb || !s || s.podId) return
    const models = [...s.pendingModels]
    const runtime = s.loadout?.runtime   // the flow's runtime — stamped on the warm Materia
    s.clearPending()
    this._closePicker(chatId)
    s.setLoadout(undefined)
    s.openSubmenu(null)
    s.beginStarting()                                  // provisioning in flight → "provisioning…", Start hidden
    s.onStage('provisioning', undefined, this.now())
    await this._render(chatId)                         // immediate: provisioning starts, not the armed copy
    // Stream the provision's stages onto the bulletin LIVE (pod-locked → bootstrapping → comfy-ready),
    // at parity with the /make gen path. Ignored once the session has ended (cancelled mid-provision).
    const onStage = (stage: string, info?: StageInfo) => {
      if (s.ended) return
      s.onStage(stage, info, this.now())
      void this._render(chatId)
    }
    const res = this.deps.startStudio ? await this.deps.startStudio(chatId, { models, ...(runtime ? { runtime } : {}) }, onStage).catch(() => null) : null
    if (res?.podId && s.ended) {
      // Cancelled/Destroyed mid-provision — the pod finished provisioning into a session that's
      // already gone. Kill it NOW so it doesn't bill for the whole warm window before the reaper.
      void this.deps.terminatePod?.(res.podId).catch(() => {})
      return
    }
    if (res?.podId) {
      // Ensure the pod is locked-in on the journal (in case the live callback didn't carry telemetry).
      s.onStage('pod-locked', {
        podId: res.podId,
        ...(res.gpuType ? { gpuType: res.gpuType } : {}),
        ...(typeof res.costPerHr === 'number' ? { costPerHr: res.costPerHr } : {}),
        ...(typeof res.provisionMs === 'number' ? { phaseMs: res.provisionMs } : {}),
      }, this.now())
      s.markReady()                          // up + resting warm, no gen (clears the starting flag)
      await this._render(chatId, { renew: true })   // FRESH message → push notification: ready to cook
    } else {
      s.endStarting()                        // provisioning failed/unavailable → back to armed-idle to retry
      await this._render(chatId)
    }
  }

  /** Close the picker and drop its cached list + fetch generation (stays in the `mod` submenu). */
  private _closePicker(chatId: number): void {
    this.chats.get(chatId)?.session.closePicker()
    this.pickerCache.delete(chatId)
    this.pickerFetchGen.delete(chatId)
  }

  /** Fetch the full candidate list for the session's current picker intent (browse genus or
   *  search query), cache it, reset to page 0, slice, and render. */
  private async _loadPicker(chatId: number): Promise<void> {
    const cb = this.chats.get(chatId)
    const p = cb?.session.picker
    if (!cb || !p || p.stage !== 'list') return
    const gen = (this.pickerFetchGen.get(chatId) ?? 0) + 1
    this.pickerFetchGen.set(chatId, gen)
    let all: PendingModel[] = []
    let base: { families: Array<{ id: string; label: string }>; filter: string } | undefined
    if (p.query !== undefined) {
      all = this.deps.searchModels ? await this.deps.searchModels(p.query).catch(() => []) : []
    } else if (p.mount && this.deps.listMount) {
      const res = await this.deps.listMount(p.mount, { baseFilter: p.baseFilter }).catch(() => ({ items: [] as PendingModel[] }))
      all = res.items
      if ('baseFamilies' in res && res.baseFamilies) base = { families: res.baseFamilies, filter: res.baseFilter ?? '' }
    }
    // Drop these results if a newer fetch superseded this one or the picker closed mid-fetch.
    if (this.pickerFetchGen.get(chatId) !== gen || !cb.session.picker) return
    this.pickerCache.set(chatId, { all, ...(base ? { base } : {}) })
    cb.session.setPickerPage(0)
    this._paginate(chatId)
    await this._render(chatId)
  }

  /** Slice the cached list to the session's current page and push it into the picker. */
  private _paginate(chatId: number): void {
    const cb = this.chats.get(chatId)
    const p = cb?.session.picker
    if (!cb || !p) return
    const cache = this.pickerCache.get(chatId) ?? { all: [] }
    const size = this._pageSize()
    const pageCount = cache.all.length === 0 ? 0 : Math.ceil(cache.all.length / size)
    const page = pageCount === 0 ? 0 : Math.min(p.page, pageCount - 1)
    cb.session.setPickerResults(cache.all.slice(page * size, page * size + size), pageCount, cache.base)
    if (page !== p.page) cb.session.setPickerPage(page)
  }

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
    // Hop-to-bottom keeps a LIVE HUD reachable as a chat scrolls — but it's pure glitch while
    // the host is tapping through an interactive menu (arm / submenu / picker). Skip it then.
    const s = cb.session
    const interactive = !!(s.arm || s.activeSubmenu || s.picker)
    if (!opts.renew && !interactive) this._scheduleRenew(chatId)
  }
}
