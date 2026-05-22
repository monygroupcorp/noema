import type { Actum } from '../../types/actum.js'
import type { UiKeyboard } from '../ui/Keyboard.js'

/** Rating glyphs — the fixed set the delivery row offers. */
export const RATE_EMOJI: Record<string, string> = { beautiful: '😻', funny: '😹', negative: '😿' }

/** The morphing delivery row's states. */
export type MenuState = 'default' | 'rate' | 'wrench'

/**
 * The delivery menu is a single morphing 3-button row attached to a result:
 *   default → Info / Rate / Wrench
 *   rate    → the fixed rating glyphs
 *   wrench  → Back / Tweak / Rerun
 * Pure: data only, no platform calls. (`dm:` = delivery-menu callbacks.)
 */
export function menuKeyboard(actumId: string, state: MenuState, rateGlyph = '♥'): UiKeyboard {
  switch (state) {
    case 'rate':
      return [[
        { label: RATE_EMOJI.beautiful, data: `dm:rated:${actumId}:beautiful` },
        { label: RATE_EMOJI.funny,     data: `dm:rated:${actumId}:funny` },
        { label: RATE_EMOJI.negative,  data: `dm:rated:${actumId}:negative` },
      ]]
    case 'wrench':
      return [[
        { label: '←', data: `dm:back:${actumId}` },
        { label: '✎', data: `dm:tweak:${actumId}` },
        { label: '↻', data: `dm:rerun:${actumId}` },
      ]]
    default:
      return [[
        { label: 'ℹ',       data: `dm:info:${actumId}` },
        { label: rateGlyph, data: `dm:rate:${actumId}` },
        { label: '⚙',       data: `dm:wrench:${actumId}` },
      ]]
  }
}

/** The Info stats block, built purely from a durable actum record. */
export function formatStats(actum: Actum | null): string {
  if (!actum) return 'Stats unavailable.'
  const e = actum.executio ?? {}
  const lines: string[] = [`Modus: ${actum.modusId}`]
  const ms = e.executionMs ?? actum.duratio
  if (typeof ms === 'number') lines.push(`Generation: ${(ms / 1000).toFixed(1)}s`)
  lines.push(`Pod: ${e.coldStart ? 'cold start' : 'warm'}`)
  if (e.gpuType) lines.push(`GPU: ${e.gpuType}`)
  if (typeof e.costPerHr === 'number' && typeof actum.duratio === 'number') {
    lines.push(`Cost: ~$${(e.costPerHr * actum.duratio / 3_600_000).toFixed(3)}`)
  }
  if (typeof e.modelsReused === 'number') {
    lines.push(`Models: ${e.modelsReused} reused, ${e.modelsDownloaded ?? 0} downloaded`)
  }
  const seed = (actum.aditus as Record<string, unknown> | undefined)?.input_seed
  if (seed !== undefined) lines.push(`Seed: ${seed}`)
  return lines.join('\n')
}
