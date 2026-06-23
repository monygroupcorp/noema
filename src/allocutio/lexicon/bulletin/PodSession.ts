import type { StageInfo } from '../../../lib/bus.js'
import type { Progressus } from '../../../types/progressus.js'
import { Ledger } from './Ledger.js'
import type { BulletinSnapshot } from './BulletinView.js'
import type { ActiveSubmenu } from './affordances.js'
import {
  WARM_LADDER_MS, WARM_DEFAULT_MS, DL_SLOW_MS,
  type Audience, type JournalEntry, type LiveState, type PendingModel, type PickerState, type Loadout, type ModelDetail, type ArmState, type StudioBase,
} from './types.js'

/** Coarse phase of a pod's life — drives timer orchestration in the manager. */
export type Phase = 'hunting' | 'prep' | 'ready' | 'idle'

/**
 * PodSession — one pod's whole life as pure state: a structured journal, a Ledger,
 * the current live phase, the warm window, and the host/guests. It maps stage
 * events to journal/live transitions; it owns NO timers and does NO I/O (the
 * BulletinManager orchestrates those off `phase`). `snapshot()` feeds BulletinView.
 *
 * Multi-pod/guest is a seam: `audience` exists but only the host path is wired.
 */
export class PodSession {
  private journal: JournalEntry[] = []
  private live: LiveState | null = null
  private readonly ledger = new Ledger()
  private _phase: Phase = 'idle'
  private phaseStartMs?: number
  private podCount = 0
  private pod: { gpu?: string; rate?: number; podId?: string } = {}
  private _warmTtlMs = WARM_DEFAULT_MS
  private _confirmed = false
  private _ended = false
  private _cancelled = false   // ended via /arm cancel (never provisioned) — distinct from a pod shut-down
  private _activeSubmenu: ActiveSubmenu = null
  private _loadout?: Loadout
  private _pendingModels: PendingModel[] = []
  private _installing: PendingModel[] = []   // models downloading live onto a warm pod
  private _picker: PickerState | null = null
  private _arm: ArmState | null = null
  private _armBase?: string   // base family chosen via an arm preset — scopes the model menu's loras
  private _armed = false      // true for an /arm-originated session — gates the `[▶ Start]` affordance
  private _starting = false   // `▶ Start` pressed, provisioning in flight (cold start can take minutes)
  private _pickerEpoch = 0   // monotonic across the session — never reused, so stale pick tokens can't collide

  constructor(readonly hostUserId: string, readonly audience: Audience = 'host') {}

  get phase(): Phase { return this._phase }
  get podId(): string | undefined { return this.pod.podId }
  get warmTtlMs(): number { return this._warmTtlMs }
  get confirmed(): boolean { return this._confirmed }
  get ended(): boolean { return this._ended }
  get activeSubmenu(): ActiveSubmenu { return this._activeSubmenu }
  get pendingModels(): readonly PendingModel[] { return this._pendingModels }
  get picker(): PickerState | null { return this._picker }
  get arm(): ArmState | null { return this._arm }
  get armBase(): string | undefined { return this._armBase }
  get loadout(): Loadout | undefined { return this._loadout }

  /** Advance the journal/live for a pod lifecycle stage. */
  onStage(stage: string, info?: StageInfo, now: number = Date.now()): void {
    if (info?.gpuType) this.pod.gpu = info.gpuType
    if (typeof info?.costPerHr === 'number') this.pod.rate = info.costPerHr
    if (info?.podId) this.pod.podId = info.podId

    if (stage === 'provisioning') {
      this.podCount += 1
      this.phaseStartMs = now
      this.live = null            // hunt is silent unless it drags (manager arms the timer)
      this._phase = 'hunting'
      // A cold start is in flight — render "Provisioning…" during the otherwise-silent hunt
      // (the `/make` path never calls beginStarting; only `/arm`'s ▸ Start did). Cleared at
      // pod-locked so it can't leak into the warm-idle "keep cooking" state afterward.
      this._starting = true
      return
    }
    if (stage === 'pod-locked') {
      this._starting = false      // hunt over — let `live` drive the display from here
      if (this._phase === 'hunting') {
        // Cold start (or bail replacement): commit the Found line + enter prep.
        this.journal.push({ kind: 'found', gpu: this.pod.gpu, rate: this.pod.rate, ms: this._phaseMs(info, now) })
        this.phaseStartMs = now
        this.live = { kind: 'initializing' }
        this._phase = 'prep'
      } else {
        // Warm reuse of an already-known pod: no new Found line, straight to work.
        this.live = { kind: 'generating' }
        this._phase = 'ready'
      }
      return
    }
    if (stage === 'ssh-ready' || stage === 'bootstrapping') { this.live = { kind: 'initializing' }; this._phase = 'prep'; return }
    if (stage.startsWith('downloading')) {
      const slow = this.phaseStartMs !== undefined && now - this.phaseStartMs > DL_SLOW_MS
      const [n, m] = stage.startsWith('downloading:') ? stage.slice(12).split('/').map(Number) : [undefined, undefined]
      this.live = { kind: 'downloading', n, m, slow }
      this._phase = 'prep'
      return
    }
    if (stage === 'installing-nodes') { this.live = { kind: 'plugins' }; return }
    if (stage === 'restarting')       { this.live = { kind: 'reloading' }; return }
    if (stage === 'pod-bailed')       { this._bail(info); return }
    if (stage === 'comfy-ready') {
      this.journal.push({ kind: 'prepared', ms: this._phaseMs(info, now) })
      this.live = { kind: 'generating' }
      this._phase = 'ready'
      return
    }
    if (stage === 'inferring') { this.live = { kind: 'generating' }; this._phase = 'ready'; return }
    if (stage === 'uploading') { this.live = { kind: 'saving' }; return }
    // unknown stage — keep the current live line
  }

  /**
   * Advance the journal/live from a `Progressus` (build #6b) — the owned status vocabulary,
   * mapped to the SAME live/journal transitions `onStage` makes from the legacy stage strings.
   * From #6b this is the bulletin's single source; the `actum.stage` shim still emits in parallel
   * for not-yet-migrated consumers but no longer drives this. Pure: no I/O, no timers.
   *
   * Discriminators the flat phase vocabulary needs (`onStage`'s string set is richer than `Phasis`):
   *  - `provisioning` WITHOUT a pod = the silent hunt opener (legacy `provisioning`); WITH a pod =
   *    the pod is locked (legacy `pod-locked`). A warm reuse (`message: 'warm pod reused'`) is
   *    owned by the 🔥 reaction, not the journal — skipped here, mirroring legacy where
   *    `warm-pod-found` never reached the session.
   *  - `pulling` + `runtime ready` = comfy is up (legacy `comfy-ready`: commit Prepared, go ready);
   *    any other `pulling` = still bootstrapping (legacy `bootstrapping`/`ssh-ready`: initializing).
   *  - `loading`/`warming` get no distinct line (legacy emitted no stage there — `comfy-ready`
   *    already set 'generating'); we keep the current live.
   *  - terminals (`done`/`failed`) are owned by the WideEvent path (`onComplete`/`onFail`) — ignored.
   */
  onProgressus(p: Progressus, now: number = Date.now()): void {
    // Pod identity rides on the cold-start phases (replaces StageInfo) — capture it like onStage.
    if (p.pod?.gpuType) this.pod.gpu = p.pod.gpuType
    if (typeof p.pod?.costPerHr === 'number') this.pod.rate = p.pod.costPerHr
    if (p.pod?.podId) this.pod.podId = p.pod.podId

    switch (p.phase) {
      case 'provisioning': {
        if (!p.pod?.podId) {
          // Silent hunt opener (legacy 'provisioning') — render "Provisioning…" during the hunt.
          this.podCount += 1
          this.phaseStartMs = now
          this.live = null
          this._phase = 'hunting'
          this._starting = true
          return
        }
        if (p.message === 'warm pod reused') return   // 🔥 reaction owns this; never journaled
        // Pod locked (legacy 'pod-locked').
        this._starting = false
        if (this._phase === 'hunting') {
          this.journal.push({ kind: 'found', gpu: this.pod.gpu, rate: this.pod.rate, ms: this.phaseStartMs !== undefined ? now - this.phaseStartMs : 0 })
          this.phaseStartMs = now
          this.live = { kind: 'initializing' }
          this._phase = 'prep'
        } else {
          // Warm reuse of an already-known pod: straight to work, no new Found line.
          this.live = { kind: 'generating' }
          this._phase = 'ready'
        }
        return
      }
      case 'pulling':
        if (p.message === 'runtime ready') {   // legacy 'comfy-ready'
          this.journal.push({ kind: 'prepared', ms: this.phaseStartMs !== undefined ? now - this.phaseStartMs : 0 })
          this.live = { kind: 'generating' }
          this._phase = 'ready'
        } else {                                // legacy 'bootstrapping' / 'ssh-ready'
          this.live = { kind: 'initializing' }
          this._phase = 'prep'
        }
        return
      case 'downloading': {
        const slow = this.phaseStartMs !== undefined && now - this.phaseStartMs > DL_SLOW_MS
        this.live = { kind: 'downloading', n: p.progress?.done, m: p.progress?.total, slow }
        this._phase = 'prep'
        return
      }
      case 'installing':
        this.live = p.message === 'restarting ComfyUI' ? { kind: 'reloading' } : { kind: 'plugins' }
        return
      case 'executing':   // legacy 'inferring'
        this.live = { kind: 'generating' }
        this._phase = 'ready'
        return
      case 'uploading':
        this.live = { kind: 'saving' }
        return
      // queued/attesting/loading/warming/finalizing/cancelling/done/failed: no pod-bulletin line —
      // keep the current live (terminals are the WideEvent path's; the rest had no legacy stage).
      default:
        return
    }
  }

  /** Manager calls this when the hunt drags past the threshold. */
  markHuntSlow(): void {
    if (this._phase === 'hunting' && !this._ended) this.live = { kind: 'hunting-slow' }
  }

  /** Record a completed gen and return to the resting (stat-line) state. */
  recordGen(entry: { costUsd?: number; execMs?: number }): void {
    this.ledger.record(entry)
    this.live = null
    this._phase = 'idle'
  }

  /** Step the warm window along the ladder. */
  stepWarm(dir: 'inc' | 'dec'): void {
    let idx = WARM_LADDER_MS.indexOf(this._warmTtlMs)
    if (idx < 0) idx = WARM_LADDER_MS.indexOf(WARM_DEFAULT_MS)
    idx = dir === 'inc' ? Math.min(WARM_LADDER_MS.length - 1, idx + 1) : Math.max(0, idx - 1)
    this._warmTtlMs = WARM_LADDER_MS[idx]
  }
  setConfirmed(v: boolean): void { this._confirmed = v }
  /** A studio is up and resting warm (no gen in flight) — e.g. after `/arm` Start provisioned it. */
  markReady(): void { this.live = null; this._phase = 'idle'; this._starting = false }
  /** `▸ Start` pressed — provisioning is in flight (cold start can take minutes). Gates the Start
   *  affordance + the armed-idle copy off, and renders a "provisioning…" line, until the pod parks
   *  warm (`markReady`) or provisioning fails (`endStarting`, back to armed). */
  beginStarting(): void { this._starting = true }
  endStarting(): void { this._starting = false }
  get starting(): boolean { return this._starting }
  end(): void { this._ended = true; this.live = null; this._activeSubmenu = null; this._picker = null; this._arm = null; this._armBase = undefined }
  clearLive(): void { this.live = null }

  /** Open a submenu (Mod / Share / Destroy) or close one (null). The Add picker only
   *  exists under `mod`, so leaving `mod` always closes it. */
  openSubmenu(which: ActiveSubmenu): void {
    this._activeSubmenu = which
    if (which !== 'mod') this._picker = null
  }

  /** Set the loadout shown as the body while the `mod` submenu is open. */
  setLoadout(loadout: Loadout | undefined): void { this._loadout = loadout }

  /**
   * Queue a model onto the session's pending loadout (`Mod • → Add`). Deduped on
   * `intellaId`. A base (`genus: 'model'`) replaces any prior pending base — one base per
   * loadout, first-come-first-served; LoRAs accumulate. The pending set merges into the next
   * gen's spec at dispatch (`aditus._pinnedModels`) and is cleared then.
   */
  queueModel(m: PendingModel): void {
    if (m.genus === 'model') {
      this._pendingModels = this._pendingModels.filter(p => p.genus !== 'model')
    } else if (this._pendingModels.some(p => p.intellaId === m.intellaId)) {
      return   // already queued
    }
    this._pendingModels.push(m)
  }

  /** Drop a queued model by id (e.g. the host un-picks it before the next gen). */
  unqueueModel(intellaId: string): void {
    this._pendingModels = this._pendingModels.filter(p => p.intellaId !== intellaId)
  }

  /** Clear the pending loadout — called at dispatch once a gen consumes it. */
  clearPending(): void { this._pendingModels = [] }

  // ── Live install (warm studio: a Mod • Add downloads onto the running pod, no gen) ─────────
  /** A warm studio is up and resting (pod bound, no gen in flight) — a model added now installs
   *  LIVE onto the pod rather than queuing for the next gen. */
  get isWarmIdle(): boolean {
    return !!this.pod.podId && this._confirmed && !this.live && !this._ended
  }
  /** Mark a model as installing live (shown as an "Installing…" tail until it lands). */
  beginInstalling(m: PendingModel): void {
    if (!this._installing.some(p => p.intellaId === m.intellaId)) this._installing.push(m)
  }
  /** A live install finished — drop it from the installing tail (it's now in the loadout). */
  finishInstalling(intellaId: string): void {
    this._installing = this._installing.filter(p => p.intellaId !== intellaId)
  }
  get installing(): readonly PendingModel[] { return this._installing }

  // ── Add-model picker (sub-state of the `mod` submenu) ──────────────────────
  // PodSession owns the picker INTENT (filter, page, query); the manager fills the
  // page's `items` + `pageCount` from the catalog via `setPickerResults` after a fetch.

  // ── /arm wizard (image → config → then the model menu) ─────────────────────

  /** Begin the arm wizard at the preset step (curated quick-starts; Custom → manual path). */
  beginArm(presets: StudioBase[], images: string[]): void {
    this._confirmed = true
    this._armed = true
    this._activeSubmenu = null
    this._picker = null
    this._armBase = undefined
    this._arm = { step: 'preset', presets, images, configs: [] }
  }
  /** Add a flow's resolved spec onto the studio loadout, then stay on the chooser so more flows
   *  can be layered (FLUX + Z-Image …). Image/runtime are set from the first flow; each flow's
   *  base models append as their own architectura (deduped). Returns to the chooser if called
   *  from a flow's detail card. The host advances explicitly via `proceedArm`. */
  addFlow(baseFamily: string, frag: Loadout): boolean {
    const cur = this._loadout
    // A studio is ONE container/runtime — reject a flow whose runtime differs from what's already
    // armed (the caller surfaces a notice). Same-runtime flows (e.g. FLUX + SDXL) still stack.
    if (cur?.runtime && frag.runtime && cur.runtime !== frag.runtime) {
      if (this._arm) this._arm = { ...this._arm, step: 'preset', flow: undefined }
      return false
    }
    this._armBase = baseFamily
    const image = cur?.image ?? frag.image
    const runtime = cur?.runtime ?? frag.runtime
    const have = new Set((cur?.categories ?? []).map(c => c.architectura))
    const fresh = frag.categories.filter(c => !have.has(c.architectura))
    // Accumulate footprint only for genuinely-new flows (re-adding the same one is a no-op).
    const vramGb = (cur?.vramGb ?? 0) + (fresh.length ? (frag.vramGb ?? 0) : 0)
    this._loadout = {
      ...(image ? { image } : {}),
      ...(runtime ? { runtime } : {}),
      categories: [...(cur?.categories ?? []), ...fresh],
      ...(cur?.looseLoras ? { looseLoras: cur.looseLoras } : {}),
      ...(vramGb > 0 ? { vramGb } : {}),
    }
    if (this._arm) this._arm = { ...this._arm, step: 'preset', flow: undefined, note: undefined }
    return true
  }
  /** Set/clear a transient notice on the /arm chooser (e.g. a runtime-conflict rejection). */
  setArmNote(note: string | undefined): void {
    if (this._arm) this._arm = { ...this._arm, note }
  }
  /** Done picking flows → hand off to the Mod • loadout/Add menu (the loadout is already built). */
  proceedArm(): void { this.finishArm() }
  /** Open a flow's detail card — what it bundles (base/models + config) before committing. */
  openFlowDetail(preset: StudioBase): void {
    if (this._arm) this._arm = { ...this._arm, step: 'flowdetail', flow: preset }
  }
  /** Custom chosen → drop into the manual image step. */
  armToCustom(): void {
    if (this._arm) this._arm = { ...this._arm, step: 'image' }
  }
  /** Image chosen → advance to the config step with that image's runtimes. */
  setArmImage(image: string, configs: string[]): void {
    if (this._arm) this._arm = { ...this._arm, step: 'config', image, configs }
  }
  /** Config chosen → finish the wizard and hand off to the Mod • loadout/Add menu, displaying the
   *  resolved spec (container image + runtime + any base models the flow bundles). */
  finishArm(loadout?: Loadout): void {
    this._arm = null
    this._activeSubmenu = 'mod'
    if (loadout) this._loadout = loadout
  }
  /** An /arm-originated studio that's been armed but not yet provisioned (no pod). Gates the
   *  `[▸ Start]` affordance and makes the flow chooser the parent of the Mod • menu on Back. */
  get isArmedIdle(): boolean {
    return this._armed && this._confirmed && !this._ended && !this.pod.podId && !this._starting
  }
  /** Step back: config → image (or straight to preset when a flow already fixed the image, so the
   *  skipped image step isn't surfaced on the way back); image/flowdetail → preset; preset →
   *  cancel (clears the wizard). */
  armBack(): void {
    if (this._arm?.step === 'config') {
      const step = this._loadout?.image ? 'preset' : 'image'
      this._arm = { ...this._arm, step, image: undefined, configs: [] }
    }
    else if (this._arm?.step === 'image') this._arm = { ...this._arm, step: 'preset' }
    else if (this._arm?.step === 'flowdetail') this._arm = { ...this._arm, step: 'preset', flow: undefined }
    else this._arm = null
  }
  /** Cancel an un-provisioned /arm session from its first layer — a clean dismiss, not a pod
   *  shut-down (there was never a pod). The body reads "cancelled" rather than "Pod shut down". */
  cancel(): void { this._cancelled = true; this.end() }

  /** Open the picker at the category (mount-location) stage. */
  openPicker(): void {
    this._picker = { stage: 'categories', categories: [], items: [], page: 0, pageCount: 0, token: this._pickerEpoch }
  }
  /** Close the picker, returning to the mod loadout body. */
  closePicker(): void { this._picker = null }
  /** Fill the mount-location categories (stage 'categories'). */
  setPickerCategories(categories: string[]): void {
    if (this._picker) this._picker = { ...this._picker, stage: 'categories', mount: undefined, categories, query: undefined }
  }
  /** Descend into a mount/category — the paginated list (stage 'list'). */
  enterMount(mount: string): void {
    if (this._picker) this._picker = { ...this._picker, stage: 'list', mount, query: undefined, page: 0, items: [], baseFamilies: undefined, baseFilter: undefined }
  }
  /** Back up from a list to the category stage. */
  backToCategories(): void {
    if (this._picker) this._picker = { ...this._picker, stage: 'categories', mount: undefined, query: undefined, items: [], page: 0, baseFamilies: undefined, baseFilter: undefined, note: undefined }
  }
  /** Open a model's detail card (the list state behind it is preserved for Back). */
  openDetail(detail: ModelDetail): void {
    if (this._picker) this._picker = { ...this._picker, stage: 'detail', detail, note: undefined }
  }
  /** Back from the detail card to the list it was opened from. */
  backToList(): void {
    if (this._picker) this._picker = { ...this._picker, stage: 'list', detail: undefined }
  }
  /** Set the transient "add by trigger" result line shown under the list (cleared on next nav). */
  setPickerNote(note: string): void {
    if (this._picker) this._picker = { ...this._picker, note }
  }
  /** Record a search term — flat results list across all mounts (overrides mount). */
  setPickerQuery(query: string): void {
    if (this._picker) this._picker = { ...this._picker, stage: 'list', mount: undefined, query, page: 0, items: [], baseFamilies: undefined, baseFilter: undefined }
  }
  /** Select a LoRA base family (`''` = all); resets to page 0. */
  setBaseFilter(baseFilter: string): void {
    if (this._picker) this._picker = { ...this._picker, baseFilter, page: 0, items: [] }
  }
  /** Record the target page (the manager fetches + fills items for it). Clamped to
   *  [0, pageCount-1] when a page count is known, so a stale/replayed callback can't
   *  scroll past the ends. */
  setPickerPage(page: number): void {
    if (!this._picker) return
    const top = this._picker.pageCount > 0 ? this._picker.pageCount - 1 : 0
    this._picker = { ...this._picker, page: Math.min(Math.max(0, page), top) }
  }
  /** Fill the current page's items + page count after a catalog fetch; for a LoRA mount,
   *  also the base families + resolved selection. Bumps the generation token so any button
   *  from the previously-displayed set is rejected. */
  setPickerResults(items: PendingModel[], pageCount: number, base?: { families: Array<{ id: string; label: string }>; filter: string }): void {
    if (!this._picker) return
    this._picker = {
      ...this._picker, items, pageCount, token: ++this._pickerEpoch, note: undefined,
      ...(base ? { baseFamilies: base.families, baseFilter: base.filter } : {}),
    }
  }

  snapshot(): BulletinSnapshot {
    return {
      journal: this.journal,
      live: this.live,
      ledger: this.ledger.summary(),
      warmTtlMs: this._warmTtlMs,
      confirmed: this._confirmed,
      rateUsdPerHr: this.pod.rate,
      ended: this._ended,
      // Distinguishes "Pod shut down" (a real pod existed) from "Setup cancelled" (an armed
      // studio dismissed before it ever provisioned).
      everHadPod: !!this.pod.podId,
      cancelled: this._cancelled,
      audience: this.audience,
      activeSubmenu: this._activeSubmenu,
      // A confirmed, pod-less session is an armed studio that hasn't been Started yet — the
      // Mod • menu offers `[▶ Start]`. A live (pod-bound) session never shows it.
      canStart: this.isArmedIdle,
      starting: this._starting,
      pendingModels: this._pendingModels,
      installing: this._installing,
      ...(this._loadout ? { loadout: this._loadout } : {}),
      ...(this._picker ? { picker: this._picker } : {}),
      ...(this._arm ? { arm: this._arm } : {}),
    }
  }

  private _phaseMs(info: StageInfo | undefined, now: number): number {
    return info?.phaseMs ?? (this.phaseStartMs !== undefined ? now - this.phaseStartMs : 0)
  }

  /** Cut a sluggish pod loose: erase its Found entry, record a permanent Quit entry. */
  private _bail(info?: StageInfo): void {
    for (let i = this.journal.length - 1; i >= 0; i--) {
      if (this.journal[i].kind === 'found') { this.journal.splice(i, 1); break }
    }
    this.journal.push({ kind: 'quit', podNum: this.podCount, reason: info?.bailReason ?? 'download throttle' })
    this.live = null
    this.phaseStartMs = undefined
    this._phase = 'hunting'
  }
}
