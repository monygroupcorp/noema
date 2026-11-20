// The banner is ONE line while a stream is live (noema-286). Folds `collapsedControls`'s
// three blocks, the floor readout, the launch row, the cold-start note and the estimate
// footnote down to what is running, how far along it is, and what it is costing.

import type { StreamPiece, StreamState } from './stream';
import { collapsedControls, streamHasBegun, configSummaryLine, nozzleSummaryLine, type ControlCollapseInput } from './controls';
import { hasAffix, loraStack, loraWarmupNote, type AffixInput, type NozzleInput } from './nozzle';
import type { StreamConfig } from './launch';

// ── The banner is ONE line while a stream is live (noema-286) ───────────────
//
// `collapsedControls` folds three blocks to three summary lines, and three summary
// lines plus the floor readout, the launch row, the cold-start note and the estimate
// footnote is still most of a phone viewport. Nothing had ever owned the banner's
// COMBINED height: each line arrived with its own item and each is defensible alone.
//
// So the fold is owned here, at the banner, and the unit it is measured in is LINES.
// Folded, the banner is one row that answers only what is running, how far along it is
// and what it is costing. Everything else is one press away — one, never two, and never
// behind a scroll.

/** Every line the banner can render. The ids are what `Muse.tsx` renders against, so a
 *  line that is not in `RunBanner.lines` is not on the screen at all. */
export type BannerLineId = 'run' | 'configuration' | 'nozzle' | 'floor' | 'estimate' | 'warmup';

export interface BannerLine {
  id: BannerLineId;
  text: string;
}

export interface RunBannerInput extends ControlCollapseInput {
  /** The banner's own press. `false` is the folded state; the user's press opens the
   *  detail, and it is a separate hand from the per-control pins in `hand`. */
  detail: boolean;
  config: StreamConfig;
  workflow: string | null;
  nozzle: NozzleInput;
  /** The standing prefix/suffix (noema-284), if one is set. It rides EVERY prompt, so it
   *  is part of what the user is spending against and belongs on the same line the model
   *  does — folded it is signalled, opened it is quoted. */
  affix?: AffixInput | null;
  /** The live status and price readout, as `streamStatusLine` composed it. */
  status: string;
  /** The floor readout the launcher carries, without its control. */
  floorLine: string;
  /** The models the pod has yet to fetch weights for. */
  warmup: NozzleInput;
  /** How many pieces have LANDED — a fired piece that is still running has not. */
  landed: number;
  /** Whether there is a quote, i.e. whether the `~` has anything to explain. */
  quoted: boolean;
}

export interface RunBanner {
  /** The lines the banner renders, in order. */
  lines: BannerLine[];
  /** Whether the control that ends the spend is rendered. True for every live phase,
   *  folded or not: nothing may fold away the stop. */
  stop: boolean;
  /** The banner's own control, or `null` before a stream has begun — there is nothing
   *  to fold away from a screen that has not launched anything. */
  press: 'more' | 'less' | null;
  folded: boolean;
}

/** The estimate footnote. It explains the `~` and never changes, which is what makes it
 *  a candidate for the fold rather than an exemption from it. */
export const ESTIMATE_NOTE =
  '~ is an estimate: the figure is the run’s reservation, and the server prices and charges every piece when it settles.';

/** How many pieces have come back. A piece is fired into the stream as `running` and
 *  landed when its run reaches a terminal, so this is not `pieces.length` — and the
 *  difference is the whole lifetime of the cold-start note. */
export function landedPieces(state: StreamState): number {
  const done = (p: StreamPiece): boolean => p.status !== 'running';
  return state.pieces.filter(done).length + state.pending.filter(done).length;
}

/**
 * The nozzle as the folded banner carries it: named at one, COUNTED at two or more.
 *
 * This reverses `nozzleSummaryLine`'s stated rule, deliberately and only at depth. That
 * rule — a stack is named, never counted — was written when a nozzle was one model, and
 * it is right there: one name and one trigger is a clause. At three it is a paragraph,
 * and a paragraph is the thing this item exists to remove.
 *
 * The reason the old rule existed does NOT go away: a user mid-stream is spending
 * against whatever this line says. So the count is only ever one press from the names,
 * their triggers and their weights — `nozzleSummaryLine` is unchanged and is what the
 * opened banner shows.
 *
 * Non-vacuity: naming the stack here must fail "a three-model stack folds without naming
 * all three".
 */
export function nozzleFoldLine(nozzle: NozzleInput, affix?: AffixInput | null): string {
  const stack = loraStack(nozzle);
  const base = stack.length === 0
    ? 'the workflow’s own base only'
    : stack.length === 1
      ? `${stack[0].nomen} · trigger ${stack[0].trigger}`
      : `${stack.length} models stacked`;
  // A standing affix rides every prompt, so a folded banner that does not admit it exists
  // is the bill the user cannot read (noema-284). The WORDS are one press away with the
  // model names; what folding may not do is hide that there are any.
  return hasAffix(affix) ? `${base} · standing text` : base;
}

/**
 * What the banner renders, as a list of lines.
 *
 * Folded (a stream has begun and the user has not pressed for the detail) that list is
 * ONE line, and the cold-start note while it is alive. Opened, it is the same summary
 * lines the launcher showed before, each still carrying its own control.
 *
 * Three things are settled here and each is load-bearing:
 *
 *  - **The status leads the folded line.** It carries the count and the spend, it is
 *    the one thing that never folds, and it is first so that the stylesheet's elision
 *    falls on the configuration tail — which is one press away — rather than on the
 *    price, which is not recoverable by pressing anything.
 *  - **The cold-start note is a claim about the FIRST piece.** It lives until a piece
 *    lands and not one moment longer; after that it is furniture on the tallest part of
 *    the screen. It is not folded while it lives — a warning the user must press to
 *    find is a warning that arrives after the wait it was explaining.
 *  - **The estimate footnote folds.** It explains the `~` and never changes, so it is
 *    the clearest candidate for the press; the `~` itself stays on the folded line.
 *
 * What is NOT here, and stays where it is in `Muse.tsx`: the launch/stop control, the
 * infinite acknowledgement, and every error and refusal line. A control that ends the
 * spend, a gate that has to be ticked, and a failure the user is spending against are
 * not furniture and are never behind a press.
 *
 * Non-vacuity: dropping the fold must fail "a running stream renders ONE banner line,
 * not one per control"; dropping the landed check must fail "the cold-start note is gone
 * once a piece has landed"; folding the stop must fail "stop is rendered while the banner
 * is folded".
 */
export function runBanner(input: RunBannerInput): RunBanner {
  const begun = streamHasBegun(input);
  const folded = begun && !input.detail;
  const collapsed = collapsedControls(input);
  const config = configSummaryLine(input.config, input.workflow);

  const lines: BannerLine[] = [
    {
      id: 'run',
      text: folded ? `${input.status} · ${config} · ${nozzleFoldLine(input.nozzle, input.affix)}` : input.status,
    },
  ];
  if (!folded) {
    if (collapsed.configuration) lines.push({ id: 'configuration', text: config });
    if (collapsed.nozzle) lines.push({ id: 'nozzle', text: nozzleSummaryLine(input.nozzle, input.affix) });
    lines.push({ id: 'floor', text: input.floorLine });
    if (input.quoted) lines.push({ id: 'estimate', text: ESTIMATE_NOTE });
  }

  // The note warns that the first piece may be slow. Once one has landed the wait it
  // described is over and the sentence is answering a question nobody is still asking.
  const warmup = input.phase === 'running' && input.landed === 0 ? loraWarmupNote(input.warmup) : null;
  if (warmup) lines.push({ id: 'warmup', text: warmup });

  return {
    lines,
    stop: input.phase === 'running' || input.phase === 'holding' || input.phase === 'stopping',
    press: begun ? (input.detail ? 'less' : 'more') : null,
    folded,
  };
}

/** The viewport the phone layout starts at. Declared here and used by `Muse.tsx` to pick
 *  the picker's chrome, so the query the script switches on is the same string the
 *  stylesheet switches on — `muse.css`'s `@media (max-width: 640px)` block must be kept
 *  in step with this value. */
export const MUSE_NARROW_VIEWPORT = '(max-width: 640px)';

