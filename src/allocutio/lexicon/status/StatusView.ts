// =============================================================================
// StatusView — pure render of the user's app HUD
// =============================================================================
// The complementary surface to BulletinView. Same shape (text + keyboard) so
// the Telegram adapter treats it identically. No I/O, no timers, no bus.

import type { StatusSnapshot, GenEntry, StudioEntry, JoinableEntry } from './types.js'
import { statusAffordancesFor, packStatusAffordances } from './affordances.js'
import type { UiKeyboard } from '../ui/Keyboard.js'

export interface RenderedStatus {
  text: string
  keyboard: UiKeyboard
}

export const StatusView = {
  render(s: StatusSnapshot): RenderedStatus {
    const lines: string[] = []

    // 1. Balance line — always present.
    if (s.auctorKey) {
      lines.push(`Balance: ${formatImpetus(s.balanceImpetus)} (${money(s.balanceUsd)})`)
    } else {
      lines.push('Not signed in — connect a wallet or run /start.')
    }

    // 2. YOUR GENS — section omitted if empty (no clutter for the common case).
    if (s.gens.length > 0) {
      lines.push('')
      lines.push(`YOUR GENS (${s.gens.length})`)
      for (const g of s.gens) lines.push(`  • ${genLine(g)}`)
    }

    // 3. YOUR STUDIOS — section omitted if empty.
    if (s.studios.length > 0) {
      lines.push('')
      lines.push(`YOUR STUDIOS (${s.studios.length})`)
      for (const st of s.studios) lines.push(`  • ${studioLine(st)}`)
    }

    // 4. JOINABLE — section omitted if empty (v1 always empty pending admission spec).
    if (s.joinable.length > 0) {
      lines.push('')
      lines.push(`JOINABLE (${s.joinable.length})`)
      for (const j of s.joinable) lines.push(`  • ${joinableLine(j)}`)
    }

    return {
      text: lines.join('\n'),
      keyboard: packStatusAffordances(statusAffordancesFor(s)),
    }
  },
}

// ── line formatting ─────────────────────────────────────────────────────────

function genLine(g: GenEntry): string {
  // A gen holding a place in the warm-pod line has a more useful thing to say than
  // "queued on pending": it can say where it stands and what it is waiting for.
  if (g.queue) {
    return `${g.modusLabel} — waiting for a warm pod — ${g.queue.place} of ${g.queue.depth} in line`
  }
  const where = g.studio
    ? (g.studio.isOwn ? 'your studio' : `${g.studio.hostLabel}'s studio`)
    : 'pending'
  const timing =
    g.status === 'agens' && g.elapsedMs !== undefined ? `${fmtDur(g.elapsedMs)} elapsed` :
    g.etaMs !== undefined ? `ETA ${fmtDur(g.etaMs)}` :
    g.status === 'nascens' ? 'queued' : 'running'
  return `${g.modusLabel} — ${g.status === 'agens' ? 'running on' : 'queued on'} ${where} — ${timing}`
}

function studioLine(st: StudioEntry): string {
  const segs = [st.label]
  switch (st.status) {
    case 'idle':         segs.push('idle'); break
    case 'running':      segs.push('running'); break
    case 'provisioning': segs.push('provisioning'); break
    case 'draining':     segs.push('draining (balance depleted)'); break
    case 'terminated':   segs.push('terminated'); break
  }
  if (st.warmRemainingMs !== undefined && st.status !== 'terminated') {
    segs.push(`${fmtDur(st.warmRemainingMs)} warm`)
  }
  if (st.guestsToday > 0) segs.push(`${st.guestsToday} guests today`)
  if (st.netImpetus !== 0n) {
    const sign = st.netImpetus > 0n ? '+' : ''
    segs.push(`${sign}${st.netImpetus.toString()} (${moneySigned(st.netUsd)})`)
  }
  return segs.join(' — ')
}

function joinableLine(j: JoinableEntry): string {
  const q = j.queueDepth === 0 ? 'open' : `${j.queueDepth} in queue`
  return `${j.hostLabel}'s ${j.label} — ${q}`
}

// ── primitives ──────────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`
  return `${(sec / 3600).toFixed(1)}h`
}
function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}
function moneySigned(usd: number): string {
  if (usd === 0) return '$0.00'
  const abs = Math.abs(usd)
  const sign = usd < 0 ? '-' : '+'
  if (abs < 0.01) return `${sign}<$0.01`
  return `${sign}$${abs.toFixed(2)}`
}
function formatImpetus(n: bigint): string {
  // 1,240 impetus — thin spaces grouped for legibility at scale
  const s = n.toString()
  if (s.length <= 3) return `${s} impetus`
  // Group from the right
  const parts: string[] = []
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i))
  return `${parts.join(',')} impetus`
}
