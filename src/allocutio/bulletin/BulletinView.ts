import type { LedgerSummary } from './Ledger.js'
import {
  WARM_LADDER_MS, WARM_LADDER_LABEL, WARM_TYPICAL_SEC, COLD_TYPICAL_MS,
  type Audience, type JournalEntry, type LiveState,
  type BulletinKeyboard, type RenderedBulletin,
} from './types.js'

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
      const who = gpu ? (rate ? `${gpu} for ${rate}` : gpu) : 'a pod'
      return `Found ${who} in ${fmtDur(e.ms)}`
    }
    case 'quit':
      return `Quit pod ${e.podNum} for ${e.reason}`
    case 'prepared': {
      const ratio = COLD_TYPICAL_MS > 0 ? e.ms / COLD_TYPICAL_MS : 1
      const pct = Math.round((ratio - 1) * 100)
      const cmp = pct > 0 ? `${pct}% > avg` : pct < 0 ? `${-pct}% < avg` : '~avg'
      return `Prepared Make Setup in ${fmtDur(e.ms)} (${cmp})`
    }
  }
}

function liveLine(live: LiveState): string {
  switch (live.kind) {
    case 'hunting-slow': return 'Hunting for an open GPU — providers are slammed. Hang tight.'
    case 'initializing': return 'Initializing…'
    case 'downloading': {
      const tail = live.slow ? ' — taking longer than usual' : ''
      return live.n && live.m
        ? `Connected, downloading models (${live.n}/${live.m})…${tail}`
        : `Connected, downloading models…${tail}`
    }
    case 'plugins':    return 'Loading plugins…'
    case 'reloading':  return 'Reloading the pod…'
    case 'generating': return 'Generating…'
    case 'saving':     return 'Saving your result…'
  }
}

function statLine(s: LedgerSummary): string {
  const segs = [`${s.genCount} gen${s.genCount > 1 ? 's' : ''}`]
  if (s.hasExec) segs.push(`exec ~${fmtDur(s.avgExecMs)} avg`)
  if (s.hasCost) { segs.push(`${moneyFine(s.avgCostUsd)} ea`); segs.push(`${money(s.totalCostUsd)} total`) }
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
    if (s.ledger.genCount > 0) lines.push((s.ended ? 'Session receipt · ' : '') + statLine(s.ledger))

    // 3. Live line (in-flight), else the resting warm nudge / setup prompt.
    if (!s.ended) {
      if (s.live) {
        lines.push(liveLine(s.live))
      } else if (!s.confirmed) {
        lines.push('Set how long to keep the pod warm, then ✓.')
      } else {
        const idx = Math.max(0, WARM_LADDER_MS.indexOf(s.warmTtlMs))
        const marginal = typeof s.rateUsdPerHr === 'number'
          ? ` · next gen ~${moneyFine(s.rateUsdPerHr * WARM_TYPICAL_SEC / 3600)}`
          : ''
        lines.push(`Warm ${WARM_LADDER_LABEL[idx]}${marginal} — keep cooking.`)
      }
    } else if (s.ledger.genCount === 0) {
      lines.push('Pod shut down.')   // closed before any gen — the stat line never showed
    }

    return { text: lines.join('\n') || 'Pod active.', keyboard: keyboard(s) }
  },
}

function keyboard(s: BulletinSnapshot): BulletinKeyboard {
  if (s.ended) return []
  if (!s.confirmed) {
    const idx = Math.max(0, WARM_LADDER_MS.indexOf(s.warmTtlMs))
    return [
      [ { label: '⏱ ‹', data: 'bul:dec' }, { label: `warm: ${WARM_LADDER_LABEL[idx]}`, data: 'bul:noop' }, { label: '› ⏱', data: 'bul:inc' } ],
      [ { label: '✓', data: 'bul:confirm' } ],
    ]
  }
  return [[ { label: '⟳', data: 'bul:refresh' }, { label: '⏱', data: 'bul:time' }, { label: '✕', data: 'bul:kill' } ]]
}
