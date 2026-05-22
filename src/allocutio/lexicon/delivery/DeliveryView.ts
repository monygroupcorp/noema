import type { Actum } from '../../../types/actum.js'
import type { UiKeyboard } from '../ui/Keyboard.js'
import { GLYPH, RATING } from '../symbols.js'
import { COPY } from '../copy.js'

/** Rating glyphs — the fixed set the delivery row offers (brand vocabulary). */
export const RATE_EMOJI = RATING

/** The morphing delivery row's states. */
export type MenuState = 'default' | 'rate' | 'wrench'

/**
 * The delivery menu is a single morphing 3-button row attached to a result:
 *   default → Info / Rate / Wrench
 *   rate    → the fixed rating glyphs
 *   wrench  → Back / Tweak / Rerun
 * Pure: data only, no platform calls. (`dm:` = delivery-menu callbacks.)
 */
export function menuKeyboard(actumId: string, state: MenuState, rateGlyph: string = GLYPH.rate): UiKeyboard {
  switch (state) {
    case 'rate':
      return [[
        { label: RATING.beautiful, data: `dm:rated:${actumId}:beautiful` },
        { label: RATING.funny,     data: `dm:rated:${actumId}:funny` },
        { label: RATING.negative,  data: `dm:rated:${actumId}:negative` },
      ]]
    case 'wrench':
      return [[
        { label: GLYPH.back,   data: `dm:back:${actumId}` },
        { label: GLYPH.tweak,  data: `dm:tweak:${actumId}` },
        { label: GLYPH.rerun,  data: `dm:rerun:${actumId}` },
      ]]
    default:
      return [[
        { label: GLYPH.info,   data: `dm:info:${actumId}` },
        { label: rateGlyph,    data: `dm:rate:${actumId}` },
        { label: GLYPH.wrench, data: `dm:wrench:${actumId}` },
      ]]
  }
}

/** The Info stats block, built purely from a durable actum record. */
export function formatStats(actum: Actum | null): string {
  if (!actum) return COPY.stats.unavailable
  const e = actum.executio ?? {}
  const lines: string[] = [COPY.stats.modus(actum.modusId)]
  const ms = e.executionMs ?? actum.duratio
  if (typeof ms === 'number') lines.push(COPY.stats.generation((ms / 1000).toFixed(1)))
  lines.push(COPY.stats.pod(!!e.coldStart))
  if (e.gpuType) lines.push(COPY.stats.gpu(e.gpuType))
  if (typeof e.costPerHr === 'number' && typeof actum.duratio === 'number') {
    lines.push(COPY.stats.cost((e.costPerHr * actum.duratio / 3_600_000).toFixed(3)))
  }
  if (typeof e.modelsReused === 'number') {
    lines.push(COPY.stats.models(e.modelsReused, e.modelsDownloaded ?? 0))
  }
  const seed = (actum.aditus as Record<string, unknown> | undefined)?.input_seed
  if (seed !== undefined) lines.push(COPY.stats.seed(seed as string | number))
  return lines.join('\n')
}
