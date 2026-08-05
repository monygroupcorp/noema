import type { LedgerSummary } from './Ledger.js'
import {
  WARM_LADDER_MS, WARM_LADDER_LABEL, WARM_TYPICAL_SEC, COLD_TYPICAL_MS,
  type Audience, type JournalEntry, type LiveState, type PendingModel, type PickerState, type Loadout, type ModelDetail, type ArmState, type StudioBase,
  type RenderedBulletin,
} from './types.js'
import { COPY } from '../copy.js'
import { affordancesFor, packAffordances, type ActiveSubmenu } from './affordances.js'

/** Everything BulletinView needs to render — a pure snapshot of a PodSession. */
export interface BulletinSnapshot {
  journal: JournalEntry[]
  live: LiveState | null
  ledger: LedgerSummary
  warmTtlMs: number
  confirmed: boolean
  rateUsdPerHr?: number     // drives the "next gen ~$X" marginal estimate
  ended: boolean
  /** True once a pod was provisioned — separates "Pod shut down" from a never-provisioned cancel. */
  everHadPod: boolean
  /** Ended via /arm cancel (no pod ever existed) — the body reads "cancelled", not "shut down". */
  cancelled: boolean
  audience: Audience        // seam — only 'host' is wired today
  /** Which submenu is currently expanded on the bulletin (`null` = top-3). */
  activeSubmenu: ActiveSubmenu
  /** True for an armed, not-yet-provisioned studio — Mod • shows `[▶ Start]`. */
  canStart: boolean
  /** True while a Started studio is provisioning (cold start in flight) — body reads "provisioning…". */
  starting: boolean
  /** The studio's model base — when set, the `mod` submenu replaces the bulletin body with it. */
  loadout?: Loadout
  /** Models queued onto the loadout via `Mod • → Add`, not yet installed. Rendered as a
   *  "queued: …" tail under the loadout; merged into the next gen's spec at dispatch. */
  pendingModels: PendingModel[]
  /** Models downloading live onto a warm pod (Mod • Add on a warm-idle studio) — an "Installing…"
   *  tail under the loadout until they land in `installedModels`. */
  installing: PendingModel[]
  /** The `Mod • → Add` picker, when open (a sub-state of the `mod` submenu). */
  picker?: PickerState
  /** The `/arm` wizard, when active — takes over the whole body until config is chosen. */
  arm?: ArmState
}

// ── formatting ───────────────────────────────────────────────────────────────

/** Compact duration: "30s" under a minute, "4.5m" above. */
function fmtDur(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  return sec < 60 ? `${sec}s` : `${(sec / 60).toFixed(1)}m`
}
/** $X.XX, but "<$0.01" for a positive sub-cent so it never reads $0.00. */
function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}
/** Finer money for per-gen figures, where sub-cent precision tells the averaging story. */
function moneyFine(usd: number): string {
  if (usd <= 0) return '$0.00'
  return `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`
}
/** "NVIDIA GeForce RTX 4090" → "RTX 4090"; drop vendor noise the user doesn't need. */
function shortGpu(gpu?: string): string | undefined {
  return gpu?.replace(/^NVIDIA\s+(GeForce\s+)?/i, '').trim() || undefined
}

function journalLine(e: JournalEntry): string {
  switch (e.kind) {
    case 'found': {
      const gpu = shortGpu(e.gpu)
      const rate = typeof e.rate === 'number' ? `$${e.rate.toFixed(2)}/hr` : undefined
      return COPY.bulletin.foundPod(COPY.bulletin.podDescriptor(gpu, rate), fmtDur(e.ms))
    }
    case 'quit':
      return COPY.bulletin.quitPod(e.podNum, e.reason)
    case 'prepared': {
      const ratio = COLD_TYPICAL_MS > 0 ? e.ms / COLD_TYPICAL_MS : 1
      return COPY.bulletin.preparedSetup(fmtDur(e.ms), COPY.bulletin.avgComparison(Math.round((ratio - 1) * 100)))
    }
  }
}

function liveLine(live: LiveState): string {
  const c = COPY.bulletin.live
  switch (live.kind) {
    case 'hunting-slow': return c.huntingSlow
    case 'initializing': return c.initializing
    case 'downloading':  return c.downloading(live.n, live.m, live.slow)
    case 'plugins':      return c.plugins
    case 'reloading':    return c.reloading
    case 'generating':   return c.generating
    case 'training':     return c.training(live.step, live.total, live.etaMs !== undefined ? fmtDur(live.etaMs) : undefined)
    case 'saving':       return c.saving
  }
}

function statLine(s: LedgerSummary): string {
  const segs = [COPY.bulletin.stat.gens(s.genCount)]
  if (s.hasExec) segs.push(COPY.bulletin.stat.execAvg(fmtDur(s.avgExecMs)))
  if (s.hasCost) { segs.push(COPY.bulletin.stat.each(moneyFine(s.avgCostUsd))); segs.push(COPY.bulletin.stat.total(money(s.totalCostUsd))) }
  return segs.join(' · ')
}

/** The loadout/spec view: container image, runtime shape, then base models grouped by
 *  architectura — each base carrying its LoRAs nested beneath it. The studio's "model base".
 *  Indentation is 2 spaces per level: architectura(0) ▸ base(1) ▸ "LoRA"(2) ▸ lora name(3). */
function loadoutLines(loadout?: Loadout): string[] {
  if (!loadout) return [COPY.bulletin.mod.loadoutEmpty()]
  const out: string[] = []
  if (loadout.image)   out.push(COPY.bulletin.mod.loadoutImage(loadout.image))
  if (loadout.runtime) out.push(COPY.bulletin.mod.loadoutRuntime(loadout.runtime))

  const empty = loadout.categories.length === 0 && !(loadout.looseLoras?.length)
  if (empty) { out.push(COPY.bulletin.mod.loadoutEmpty()); return out }

  for (const cat of loadout.categories) {
    out.push(cat.architectura)
    for (const base of cat.bases) {
      out.push(`  ${base.nomen}`)
      if (base.loras.length > 0) {
        out.push(`    ${COPY.bulletin.mod.loraSection}`)
        for (const l of base.loras) out.push(`      ${l}`)
      }
    }
  }
  // LoRAs whose base isn't installed — a flat fallback section so they're still visible.
  if (loadout.looseLoras?.length) {
    out.push(COPY.bulletin.mod.loraSection)
    for (const l of loadout.looseLoras) out.push(`  ${l}`)
  }
  return out
}

/** The model detail card — name + the reliably-populated structural fields, then a description
 *  when the record carries one. (Ratings / comments / example images are a later content sprint.) */
function detailLines(d: ModelDetail): string[] {
  const C = COPY.bulletin.mod.detail
  const out = [d.nomen]
  if (d.mount)                     out.push(C.type(d.mount))
  if (d.base)                      out.push(C.base(d.base))
  if (d.trigger)                   out.push(C.trigger(d.trigger))
  if (typeof d.sizeGb === 'number') out.push(C.size(d.sizeGb))
  if (d.provenance)                out.push(C.from(d.provenance))
  if (d.auctor)                    out.push(C.by(d.auctor))
  if (d.description)               out.push('', d.description)
  return out
}

/** The /arm flow detail card — a flow is a base + models + a runtime/config + an image, laid out
 *  so an advanced host reads the full shape before committing. Lines omitted when absent. */
function flowDetailLines(p: StudioBase): string[] {
  const C = COPY.bulletin.arm.flow
  const out = [p.label]
  if (p.blurb)            out.push('', p.blurb)
  if (p.models?.length)   out.push('', C.models, ...p.models.map(m => `  ${m}`))
  if (p.config)           out.push(C.config(p.config))
  if (p.image)            out.push(C.image(p.image))
  if (typeof p.vramGb === 'number' && p.vramGb > 0) out.push(C.vram(p.vramGb))
  return out
}

/** Mod • takes over the body: the Add picker (categories / list / detail) when open, else the
 *  loadout/spec view — plus the queued tail (models added but not yet installed). */
function modBody(s: BulletinSnapshot): string[] {
  const lines: string[] = []
  if (s.picker) {
    const p = s.picker
    if (p.stage === 'detail') {
      if (p.detail) lines.push(...detailLines(p.detail))
    } else if (p.stage === 'categories') {
      lines.push(COPY.bulletin.mod.pickType)
    } else {
      lines.push(p.items.length === 0
        ? COPY.bulletin.mod.pickerEmpty(p.query)
        : COPY.bulletin.mod.listTitle(p.mount, p.page, p.pageCount, p.query))
      if (p.note) lines.push(p.note)   // transient add-by-trigger result
    }
  } else {
    lines.push(...loadoutLines(s.loadout))
  }
  if (s.pendingModels.length > 0) lines.push(COPY.bulletin.mod.queued(s.pendingModels.map(m => m.nomen)))
  if (s.installing.length > 0) lines.push(COPY.bulletin.mod.installing(s.installing.map(m => m.nomen)))
  return lines
}

// ── render ─────────────────────────────────────────────────────────────────

/**
 * BulletinView — pure render of one pod's bulletin. No I/O, no timers, no bus.
 * (Multi-pod rendering will compose several snapshots; today we render one.)
 */
export const BulletinView = {
  render(s: BulletinSnapshot): RenderedBulletin {
    const keyboard = packAffordances(affordancesFor(s))

    // /arm wizard takes over the body: choose a flow (preset) → its detail card, or Custom →
    // image → runtime.
    if (!s.ended && s.arm) {
      if (s.arm.step === 'flowdetail' && s.arm.flow) {
        return { text: flowDetailLines(s.arm.flow).join('\n'), keyboard }
      }
      if (s.arm.step === 'preset') {
        const added = s.loadout?.categories.map(c => c.architectura) ?? []
        const tail = s.arm.note                                            // a conflict notice wins
          ? `\n\n${s.arm.note}`
          : added.length ? `\n\n${COPY.bulletin.arm.added(added)}` : ''
        return { text: `${COPY.bulletin.arm.pickPreset}${tail}`, keyboard }
      }
      const head = s.arm.step === 'image' ? COPY.bulletin.arm.pickImage
        : COPY.bulletin.arm.pickConfig(s.arm.image ?? '')
      return { text: head, keyboard }
    }

    // Mod • replaces the HUD body entirely with the loadout/spec view (or the Add picker).
    if (!s.ended && s.activeSubmenu === 'mod') {
      return { text: modBody(s).join('\n') || COPY.bulletin.podActive, keyboard }
    }

    const lines: string[] = []

    // 1. Journal — committed infra-story lines (GPU + rate live inside "Found …").
    for (const e of s.journal) lines.push(journalLine(e))

    // 2. Execution stats — appears once a gen completes; per-gen average falls as
    //    warm gens accumulate (the cost-averaging story made self-evident).
    if (s.ledger.genCount > 0) lines.push((s.ended ? COPY.bulletin.receiptPrefix : '') + statLine(s.ledger))

    // 3. Live line (in-flight), else the resting warm nudge / setup prompt.
    if (!s.ended) {
      if (s.live) {
        lines.push(liveLine(s.live))
      } else if (!s.confirmed) {
        lines.push(COPY.bulletin.setupPrompt)
      } else if (s.starting) {
        // ▶ Start pressed — a real cold start is in flight (clone + deps can take minutes).
        lines.push(COPY.bulletin.provisioning)
      } else if (s.canStart) {
        // Armed via /arm, no pod yet — don't imply a warm pod is resting.
        lines.push(COPY.bulletin.armedIdle)
      } else {
        const idx = Math.max(0, WARM_LADDER_MS.indexOf(s.warmTtlMs))
        const marginal = typeof s.rateUsdPerHr === 'number'
          ? COPY.bulletin.nextGen(moneyFine(s.rateUsdPerHr * WARM_TYPICAL_SEC / 3600))
          : ''
        lines.push(COPY.bulletin.keepCooking(WARM_LADDER_LABEL[idx], marginal))
      }
    } else if (s.ledger.genCount === 0) {
      // Closed before any gen — a cancelled /arm never had a pod, so don't say "shut down".
      lines.push(s.cancelled ? COPY.bulletin.armCancelled : COPY.bulletin.podShutDown)
    }

    return { text: lines.join('\n') || COPY.bulletin.podActive, keyboard }
  },
}
