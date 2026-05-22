// =============================================================================
// Bulletin subsystem — shared types & constants
// =============================================================================
// The session bulletin is a per-conversation HUD that narrates one pod's life as
// a JOURNAL (committed lines that persist) plus one volatile live line and an
// execution stat line. These types are platform-agnostic; the Telegram adapter
// renders the neutral keyboard spec into inline buttons.

/** Warm-window ladder for the stepper. ‹ steps toward 1s, › toward 30m. */
export const WARM_LADDER_MS    = [1_000, 5_000, 30_000, 60_000, 300_000, 600_000, 1_800_000]
export const WARM_LADDER_LABEL = ['1s', '5s', '30s', '1m', '5m', '10m', '30m']
export const WARM_DEFAULT_MS    = 60_000   // 1m
export const AUTO_SETTLE_MS     = 20_000   // confirm the warm window if untouched this long
export const COLD_TYPICAL_MS    = 7 * 60_000 // baseline the prep "(% vs avg)" races against
export const WARM_TYPICAL_SEC   = 25       // typical warm compute → "next gen ~$X" estimate
export const HUNT_SLOW_MS       = 12_000   // surface the hunt line only if it drags past this
export const DL_SLOW_MS         = 90_000   // annotate the download if prep runs long

/** Who is looking at the bulletin — scopes controls + copy. Only 'host' is wired today. */
export type Audience = 'host' | 'guest' | 'onlooker'

/**
 * A committed journal line — STRUCTURED, not prose, so `bail` removes by kind and
 * tests assert on data. Rendered to text by BulletinView at display time.
 */
export type JournalEntry =
  | { kind: 'found'; gpu?: string; rate?: number; ms: number }
  | { kind: 'quit'; podNum: number; reason: string }
  | { kind: 'prepared'; ms: number }

/** The current in-flight phase — drives the single volatile "live" line. */
export type LiveState =
  | { kind: 'hunting-slow' }                                  // escalated only when the hunt drags
  | { kind: 'initializing' }
  | { kind: 'downloading'; n?: number; m?: number; slow: boolean }
  | { kind: 'plugins' }
  | { kind: 'reloading' }
  | { kind: 'generating' }
  | { kind: 'saving' }

/** A neutral keyboard: rows of buttons with a label + callback data. Adapter maps it. */
export type BulletinButton = { label: string; data: string }
export type BulletinKeyboard = BulletinButton[][]

/** A fully-rendered bulletin: text + keyboard. Pure output of BulletinView. */
export interface RenderedBulletin {
  text: string
  keyboard: BulletinKeyboard
}
