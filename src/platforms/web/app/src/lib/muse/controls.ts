// The controls get out of the way, on the user's hand, at any time (noema-264, noema-282).
// Pure so the collapse rule can be gated by the hermetic web tests, which run with no React
// in scope.

import type { StreamConfig, StreamPhase } from './launch';
import { affixSummaryLine, loraStack, loraWeight, type AffixInput, type NozzleInput } from './nozzle';

// ── The controls get out of the way, on the user's hand, at any time (noema-264, noema-282) ──
//
// On a wide viewport the configuration, the nozzle and the steer dock read as chrome
// around the grid. On a narrow one they are most of the viewport, and the stream — the
// thing the user launched and is paying for — is what they scroll past the menu to see.
//
// The rule is here, and pure, because this is where it can be gated: the hermetic web
// tests run from the repo root under `tsx --test` with no react in scope, so a rule that
// lived in `Muse.tsx` could not be asserted at all.

/** The three blocks that collapse to a summary line. The launch/stop control, the price
 *  readout and the infinite acknowledgement are NOT in this list and never collapse:
 *  they are what starts, stops and prices the stream. */
export type MuseControl = 'configuration' | 'nozzle' | 'steer';

/** The user's hand on each control. `'open'` or `'closed'` PINS it against the auto
 *  rule below, in either direction, at any phase — including before a stream has begun.
 *  No entry (the common case) leaves the auto rule to decide. Only the user's hand ever
 *  writes here; the auto rule reads `hand` but never writes it. */
export type ControlHand = Partial<Record<MuseControl, 'open' | 'closed'>>;

export interface ControlCollapseInput {
  /** Where the stream is. */
  phase: StreamPhase;
  /** How many pieces are on the stream right now. */
  pieces: number;
  /** The controls the user has pinned open or closed by hand. */
  hand: ControlHand;
}

export interface ControlCollapse {
  configuration: boolean;
  nozzle: boolean;
  steer: boolean;
}

/** A stream that has something to show: pieces already on it, or a loop riding toward
 *  the first one. Until then there is nothing for the controls to be in the way of. */
export function streamHasBegun(input: Pick<ControlCollapseInput, 'phase' | 'pieces'>): boolean {
  if (input.pieces > 0) return true;
  return input.phase === 'running' || input.phase === 'holding' || input.phase === 'stopping';
}

/**
 * Which launcher controls — configuration, nozzle, and the steer dock — are collapsed
 * to their summary lines.
 *
 * Four properties, and each is load-bearing:
 *
 *  - A stream with pieces on it collapses all three. The grid gets the viewport.
 *  - A session with nothing on it opens EXPANDED. Collapsing an idle screen would hide
 *    the only control that starts anything, which is the one thing a fresh screen is for.
 *  - The collapse is a DEFAULT, never a lock: a control the user pinned open stays open
 *    while the stream rides, and nothing re-collapses it under their hand.
 *  - The pin runs the OTHER way too, and at any phase: a control the user pinned closed
 *    stays closed even before the stream has begun. Configuring a run is exactly when
 *    the banner is tallest, and exactly when the user must be able to fold it.
 *
 * Non-vacuity: reverting the collapse must fail "a stream with pieces on it collapses
 * the configuration, the nozzle and the steer dock to their summary lines"; reverting
 * the idle branch must fail "a session with nothing on it opens with every control
 * expanded"; reverting the open-pin must fail "pinning a control open keeps it expanded
 * while the stream rides"; reverting the closed-pin must fail "a control can be
 * collapsed by hand with zero pieces fired".
 */
export function collapsedControls(input: ControlCollapseInput): ControlCollapse {
  const begun = streamHasBegun(input);
  const resolve = (control: MuseControl): boolean => {
    const pin = input.hand[control];
    if (pin === 'open') return false;
    if (pin === 'closed') return true;
    return begun;
  };
  return {
    configuration: resolve('configuration'),
    nozzle: resolve('nozzle'),
    steer: resolve('steer'),
  };
}

/** The user's hand pinning one control open or closed. This is the only place a control
 *  is ever set to `'closed'` or `'open'` — the auto rule above never writes `hand`, so a
 *  pin persists through every phase the stream moves through until the user's hand
 *  changes it again. */
export function setControlHand(hand: ControlHand, control: MuseControl, open: boolean): ControlHand {
  const next: 'open' | 'closed' = open ? 'open' : 'closed';
  return hand[control] === next ? hand : { ...hand, [control]: next };
}

/**
 * The collapsed nozzle in one line: the model that is loaded AND the weight it is
 * loaded at.
 *
 * This is not `loraChoiceLine`, which omits the weight when none is set. A collapsed row
 * exists to answer "what is firing right now" without being opened, and "at its own
 * default" is an answer where a missing clause is not — the user is mid-stream and
 * spending against whatever this says.
 *
 * A STACK IS NAMED, NEVER COUNTED. "3 models" answers a question nobody asked: the
 * trigger word is on this line because it is the part a user has to see to trust that a
 * model is reaching the prompt at all, and a count carries none of it. Every entry is
 * named with its trigger and its weight; where the row runs out of room the ELISION is
 * the stylesheet's, on text that is already there.
 *
 * Non-vacuity: dropping the weight clause must fail "a collapsed nozzle still names the
 * model that is loaded and its weight"; dropping the affix clause must fail "the
 * collapsed nozzle line names the standing affix when one is set".
 */
export function nozzleSummaryLine(nozzle: NozzleInput, affix?: AffixInput | null): string {
  const stack = loraStack(nozzle);
  const base = stack.length === 0
    ? 'no model — the workflow’s own base only'
    : stack
      .map((choice) => {
        const weight = loraWeight(choice.weight);
        const at = weight == null ? 'its own default weight' : `weight ${weight}`;
        return `${choice.nomen} · trigger ${choice.trigger} · ${at}`;
      })
      .join(' + ');
  const affixLine = affixSummaryLine(affix);
  return affixLine ? `${base} · ${affixLine}` : base;
}

/** The collapsed configuration in one line: what it is firing through, in which run
 *  mode, and — batched — how many pieces that mode is bounded by. */
export function configSummaryLine(config: StreamConfig, workflow: string | null): string {
  const run = config.mode === 'infinite' ? 'infinite' : `batched · ${config.cap} pieces`;
  const flow = (workflow ?? '').trim();
  return `${flow || 'no workflow'} · ${run}`;
}

/**
 * The collapsed steer dock in one line: the floor line it already shows expanded, or
 * the failure if the last steer sent did not land.
 *
 * A collapsed control that hides a failure is worse than one that never collapses — the
 * user is mid-stream and spending against a steer they cannot see failed. `failure`
 * outranks the floor line for exactly that reason.
 *
 * Non-vacuity: dropping the failure branch must fail "a collapsed steer dock still says
 * a steer failed".
 */
export function steerDockSummaryLine(input: { floorLine: string; failure: string | null }): string {
  if (input.failure) return `steer failed — ${input.failure}`;
  return input.floorLine;
}

