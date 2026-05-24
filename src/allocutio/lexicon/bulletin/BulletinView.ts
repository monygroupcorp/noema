import type { LedgerSummary } from './Ledger.js'
import {
  WARM_LADDER_MS, WARM_LADDER_LABEL, WARM_TYPICAL_SEC, COLD_TYPICAL_MS,
  type Audience, type JournalEntry, type LiveState,
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
  audience: Audience        // seam — only 'host' is wired today
  /** Which submenu is currently expanded on the bulletin (`null` = top-3). */
  activeSubmenu: ActiveSubmenu
  /** OCI image / loadout descriptor — shown in the body when `Mod • → View loadout` is invoked. */
  loadoutSummary?: string
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
    case 'saving':       return c.saving
  }
}

function statLine(s: LedgerSummary): string {
  const segs = [COPY.bulletin.stat.gens(s.genCount)]
  if (s.hasExec) segs.push(COPY.bulletin.stat.execAvg(fmtDur(s.avgExecMs)))
  if (s.hasCost) { segs.push(COPY.bulletin.stat.each(moneyFine(s.avgCostUsd))); segs.push(COPY.bulletin.stat.total(money(s.totalCostUsd))) }
  return segs.join(' · ')
}

// ── render ─────────────────────────────────────────────────────────────────

/**
 * BulletinView — pure render of one pod's bulletin. No I/O, no timers, no bus.
 * (Multi-pod rendering will compose several snapshots; today we render one.)
 */
export const BulletinView = {
  render(s: BulletinSnapshot): RenderedBulletin {
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
      } else {
        const idx = Math.max(0, WARM_LADDER_MS.indexOf(s.warmTtlMs))
        const marginal = typeof s.rateUsdPerHr === 'number'
          ? COPY.bulletin.nextGen(moneyFine(s.rateUsdPerHr * WARM_TYPICAL_SEC / 3600))
          : ''
        lines.push(COPY.bulletin.keepCooking(WARM_LADDER_LABEL[idx], marginal))
      }
    } else if (s.ledger.genCount === 0) {
      lines.push(COPY.bulletin.podShutDown)   // closed before any gen — the stat line never showed
    }

    // Mod • → View loadout shows the loadout summary as a body line when set.
    if (s.activeSubmenu === 'mod' && s.loadoutSummary) lines.push(s.loadoutSummary)

    return { text: lines.join('\n') || COPY.bulletin.podActive, keyboard: packAffordances(affordancesFor(s)) }
  },
}
