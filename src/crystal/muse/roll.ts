// =============================================================================
// muse/roll — a readable report over N rolls, and the free/paid tally
// =============================================================================
//
// `sampler` picks fragments and `weaver` composes and gates them. This module
// puts the three together into the thing a human (or a UI) actually reads: for
// each roll, what was chosen, where each fragment came from, the composed
// prompt, and whether the cheap template stands on its own.
//
// The free/paid split is the cost shape of the whole front half. A roll the
// detector reports NO reasons for is FREE — pure string assembly, no model call.
// A roll with reasons is what a paid smoother would be bought for. The tally is
// therefore a measurement, and it is derived from `detectConflicts` alone: this
// module never forms its own opinion about what conflicts, so the number always
// describes the detector that is actually shipping.
//
// Pure and deterministic: same garden, same count, same report.

import { rollFragments, type SteerState } from './sampler.js'
import { type Fragment, type Garden } from './taxonomy.js'
import { composeTemplate, detectConflicts } from './weaver.js'

/** One roll, fully explained. */
export type RolledPrompt = {
  /** The roll index that produced it; replaying this index reproduces the roll. */
  index: number
  /** The chosen fragments, each carrying its category, source and trigger. */
  fragments: Fragment[]
  /** The zero-cost composed prompt. */
  prompt: string
  /** Why the cheap gate thinks a smoother is warranted; empty means it is not. */
  reasons: string[]
  /** True iff the detector reported at least one reason. */
  paid: boolean
  /** Distinct triggers contributing to this roll — the model bindings a gen would attach. */
  triggers: string[]
}

/** N rolls plus the tally across them. */
export type RollReport = {
  rolls: RolledPrompt[]
  /** Rolls the detector reported no reasons for. */
  free: number
  /** Rolls the detector reported at least one reason for. */
  paid: number
  /** `paid / rolls.length`, or 0 when there are no rolls. */
  paidShare: number
}

/** Distinct, non-empty triggers across a fragment set, in first-seen order. */
function triggersOf(fragments: readonly Fragment[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of fragments) {
    if (!f.trigger || seen.has(f.trigger)) continue
    seen.add(f.trigger)
    out.push(f.trigger)
  }
  return out
}

/**
 * Roll `count` times against a garden and report each roll plus the free/paid tally.
 *
 * Roll indices are `0 .. count-1`, so the report is reproducible from the garden,
 * the count and the steer state alone. A non-positive count yields an empty report
 * rather than throwing.
 *
 * `steer` is passed straight to the sampler and is the only thing that changes
 * which fragment a given roll index draws; omitting it reports the unsteered roll.
 */
export function rollReport(garden: Garden, count: number, steer?: SteerState): RollReport {
  const rolls: RolledPrompt[] = []
  for (let index = 0; index < Math.max(0, Math.trunc(count)); index++) {
    const fragments = rollFragments(garden, index, steer)
    const reasons = detectConflicts(fragments)
    rolls.push({
      index,
      fragments,
      prompt: composeTemplate(fragments),
      reasons,
      // The tally is the detector's verdict, never a second opinion formed here.
      paid: reasons.length > 0,
      triggers: triggersOf(fragments),
    })
  }

  const paid = rolls.filter((r) => r.paid).length
  return {
    rolls,
    free: rolls.length - paid,
    paid,
    paidShare: rolls.length === 0 ? 0 : paid / rolls.length,
  }
}

/** One roll rendered for a terminal: the prompt, its fragments' provenance, and the verdict. */
export function formatRoll(roll: RolledPrompt): string {
  const lines: string[] = []
  lines.push(`roll ${roll.index}  ${roll.paid ? 'PAID (a smoother would run)' : 'FREE (template stands)'}`)
  lines.push(`  ${roll.prompt || '(empty)'}`)
  for (const f of roll.fragments) {
    const binding = f.trigger ? ` <- ${f.trigger}` : ''
    lines.push(`    [${f.category}] ${f.text}  (${f.source}${binding})`)
  }
  for (const reason of roll.reasons) lines.push(`    ! ${reason}`)
  return lines.join('\n')
}

/** The tally line: how many rolls the free template carried on its own. */
export function formatTally(report: RollReport): string {
  const pct = (report.paidShare * 100).toFixed(1)
  return `${report.rolls.length} rolls: ${report.free} free, ${report.paid} paid (${pct}% would buy a smoother)`
}
