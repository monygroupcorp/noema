// =============================================================================
// subsidyCycle — deterministic cycle keys for the subsidy sweep idempotency guard.
// =============================================================================
//
// A pledge drips once per cycle. The sweeper can run as often as it likes (say
// hourly); the cycle key makes the drip idempotent — `2026-W27` (weekly), `2026-F13`
// (fortnight), `2026-M07` (monthly). The sweeper CAS-claims this key on the pledge,
// so a drip fires at most once per cycle regardless of sweep frequency.

import type { SubsidyCadence } from '../types/sponsio.js'

/** ISO-8601 week-numbering year + week for a date (weeks start Monday; week 1 holds Jan 4). */
export function isoYearWeek(d: Date): { year: number; week: number } {
  // Shift to the Thursday of this week — the ISO week-year is that Thursday's year.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = (date.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return { year: date.getUTCFullYear(), week }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The cycle key for a cadence at a given instant. */
export function cycleKey(cadence: SubsidyCadence, at: Date): string {
  if (cadence === 'monthly') {
    return `${at.getUTCFullYear()}-M${pad2(at.getUTCMonth() + 1)}`
  }
  const { year, week } = isoYearWeek(at)
  if (cadence === 'biweekly') {
    // Fortnight index — pairs of ISO weeks. Stable within a year.
    return `${year}-F${pad2(Math.ceil(week / 2))}`
  }
  return `${year}-W${pad2(week)}`
}
