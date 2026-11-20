// The stream's front door — launch configuration, refusal, and the loop's own decision of
// whether to fire the next piece. Thin composition over `src/crystal/muse`; no logic is
// reimplemented here (see the note at the top of `../muse.ts`).

// ── The stream's front door (noema-244) ──────────────────────────────────────
// Configuration, one launch control, and a loop that rides until it is stopped.
//
// WHERE THE LOOP LIVES, and why it matters for spend: in the browser. There is no
// server-side stream — no stream id, no heartbeat, no reaper — so a piece is
// requested only when the previous one settles, and closing the tab ends the
// stream because nothing is left to fire it. The property that buys: there is no
// state in which an unattended page keeps spending. The cost, which the screen
// must show rather than hide: a page that goes away comes back stopped, and the
// state readout has to say so instead of rendering as though it were still riding.
//
// Everything the loop decides is `nextPieceDecision` below — pure, and the money
// ceiling of the whole design is one comparison inside it.

/** How a stream is run: a fixed number of pieces, or until it is stopped. */
export type StreamMode = 'batched' | 'infinite';

/** The price the launch control carries: one quote for the chosen flow.
 *
 *  ONE quote prices every piece, and that is a statement about the server, not a
 *  convenience: a t2i reservation is evaluated from the flow's own cost curve against
 *  the run's NUMERIC inputs (`steps`, `width`, `height` — see `reservationImpetus` in
 *  `src/ledger/rates.ts`), falling back to the flow's schema defaults. Muse sends
 *  `aditus` = `{prompt}` and nothing else, so every piece in a stream quotes the same
 *  figure whatever prompt it was rolled from.
 *
 *  It is still an ESTIMATE and is labelled `~` everywhere it is rendered: a
 *  reservation is an upper bound that settlement charges measured pod time against
 *  and refunds the remainder of. The client figure never becomes the charge —
 *  every piece goes through `POST /v1/runs`, which prices and charges server-side. */
export interface StreamQuote { modusId: string; impetus: string }

/** A stream as it is configured before launch. */
export interface StreamConfig {
  mode: StreamMode;
  /** Batched only: how many pieces to fire. */
  cap: number;
  /** Infinite only: the runs-until-you-stop-it warning has been acknowledged. */
  acknowledged: boolean;
}

/** Everything the launch control is refused on, in one object. */
export interface LaunchState {
  config: StreamConfig;
  /** The chosen t2i flow, or null when none is chosen. */
  modusId: string | null;
  /** `ignitionBlockReason` for the chosen flow: a flow needing more than a prompt. */
  flowBlockReason: string | null;
  /** How many fragments are in the draw right now. */
  liveFragments: number;
  /** The configuration-time quote, or null while it is still being fetched. */
  quote: StreamQuote | null;
}

/**
 * The single reason launch is refused, or `null` when it may proceed.
 *
 * Four refusals, and each is load-bearing:
 *
 *  - no flow chosen, and a flow that needs more than a prompt — the two refusals the
 *    per-card arming used to perform. They did not vanish with it; they moved here.
 *  - an EMPTY FLOOR. A stream draws every piece from the floor, so a floor with
 *    nothing in the draw has nothing to make. A thin floor is allowed to run — the
 *    refusal is emptiness, not thinness.
 *  - INFINITE MODE THAT HAS NOT BEEN ACKNOWLEDGED. An infinite stream has no count to
 *    stop it; the balance is its only ceiling. The acknowledgement is the disclosure
 *    that stands in for the count, so it is a gate on the control and not a caption
 *    beside it.
 *
 * A stream also cannot launch before it is priced: `perPieceImpetus` is what the funds
 * check compares the balance against, so an unpriced stream is one with no ceiling.
 *
 * Non-vacuity: reverting the acknowledgement gate must fail "infinite mode cannot
 * launch until the runs-until-you-stop-it warning is acknowledged"; reverting the
 * empty-floor refusal must fail "launch is refused when zero fragments are live on
 * the floor".
 */
export function launchBlockReason(state: LaunchState): string | null {
  if (!state.modusId) return 'choose a workflow to fire at';
  if (state.flowBlockReason) return state.flowBlockReason;
  if (state.liveFragments <= 0) {
    return 'nothing is in the draw — add a fragment to the floor before launching';
  }
  if (state.config.mode === 'infinite' && !state.config.acknowledged) {
    return 'infinite runs until you stop it or your funds run out — acknowledge that first';
  }
  if (!state.quote || state.quote.modusId !== state.modusId) {
    return 'pricing this run…';
  }
  return null;
}

/** Why a stream stopped. `lost` is D1's honest readout: the page went away and took
 *  the loop with it, so the stream ended without anyone deciding to end it. */
export type StopReason = 'user' | 'funds' | 'cap' | 'errors';
export type StopCause = StopReason | 'lost';

/** Where a stream is. `stopping` is a stop pressed while a piece is still in flight:
 *  the loop finishes the piece that is already paid for and then stops.
 *
 *  `holding` is the nozzle being changed (S6) and it is NOT a stop: the loop parks,
 *  keeping its fired count, its cap, its run mode and its generation, and committing
 *  the change returns it to `running` with no relaunch. See `HoldReason`.
 *
 *  `resumed` is a session reopened with pieces already in its ledger: no loop is riding,
 *  but the screen is not sitting at a fresh configuration either. See `resumePhase`. */
export type StreamPhase = 'idle' | 'running' | 'holding' | 'stopping' | 'stopped' | 'resumed';

/** Consecutive failures that end a stream. A loop that retries a hard failure forever
 *  is the other way this design can spend without a hand on it. */
export const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Why the stream is holding (S6). Both reasons are a nozzle change and nothing else —
 * a floor change never holds, which is the distinction this whole control turns on:
 * pieces drawn while the floor is being edited are still pieces the user asked for,
 * while pieces fired while a model is being chosen come out of the old nozzle at full
 * price and are exactly the ones they were about to stop wanting.
 *
 *  - `picking` — the model control is open or mid-change.
 *  - `loading` — the change is committed and the new weights are being taken up. The
 *    first piece under a new LoRA can be slow because the pod fetches those weights,
 *    so the readout says so instead of reading as a stall.
 */
export type HoldReason = 'picking' | 'loading';

/** A hold, and the trigger word it is loading when it has one to name. */
export interface HoldState { reason: HoldReason; trigger?: string }

/** What the stream is holding for, in words — the same shape `stopLabel` gives a stop,
 *  and deliberately worded as a wait rather than an ending. */
export function holdLabel(hold: HoldState): string {
  if (hold.reason === 'loading') {
    return hold.trigger ? `holding — loading ${hold.trigger}` : 'holding — loading the model';
  }
  return 'holding — choosing a model';
}

/** What the loop knows when it decides whether to fire the next piece. */
export interface StreamDecisionInput {
  mode: StreamMode;
  /** Batched only. */
  cap: number;
  /** How many pieces this stream has fired so far. */
  fired: number;
  /** True while a piece is still generating. */
  inFlight: boolean;
  /** The caller's balance, freshly read — impetus, as a decimal integer string. */
  balanceImpetus: string;
  /** The quoted reservation for one piece, same units. */
  perPieceImpetus: string;
  stopRequested: boolean;
  consecutiveErrors: number;
  /** The nozzle change in progress, or `null` when there is none. */
  hold?: HoldState | null;
}

/** Fire, or don't — and when not, whether the stream is over and why. `stop: null`
 *  means "not now, not over": a piece is still in flight. The third shape is the same
 *  family — "not now, not over" — with a reason to show: the nozzle is being changed,
 *  and the stream resumes from exactly where it is parked. */
export type StreamDecision =
  | { fire: true }
  | { fire: false; stop: StopReason | null }
  | { fire: false; hold: HoldState };

/** Whether a decision is the non-terminal nozzle hold. The loop parks on this and keeps
 *  everything it is holding; it must never be folded into the `stop` branch. */
export function isHold(decision: StreamDecision): decision is { fire: false; hold: HoldState } {
  return decision.fire === false && 'hold' in decision;
}

/** Impetus figures cross the wire as decimal integer strings and are compared exactly.
 *  A malformed or absent figure reads as 0, which fails the funds check closed. */
function impetus(value: string | null | undefined): bigint {
  if (!value || !/^\d+$/.test(value.trim())) return 0n;
  return BigInt(value.trim());
}

/** `count` pieces at `perPiece` each, as a decimal string — what the launch control
 *  shows as the batch total, and what the readout shows as spent so far. Estimates
 *  both, and both are rendered with a `~`. */
export function impetusTotal(perPiece: string, count: number): string {
  const n = Number.isFinite(count) && count > 0 ? BigInt(Math.trunc(count)) : 0n;
  return (impetus(perPiece) * n).toString();
}

/**
 * THE WHOLE OF THE LOOP'S JUDGEMENT. `Muse.tsx` awaits a settlement and asks this
 * what to do next; it decides nothing itself.
 *
 * Order, and every position is deliberate:
 *
 *  1. `stopRequested` always wins. A stop pressed mid-stream is the user's, whatever
 *     else is true — including while the stream is holding.
 *  2. `inFlight` is not a stop — it is "not yet". Exactly one piece is in flight at a
 *     time, because a loop that fires on a timer rather than on settlement spends at a
 *     rate nobody chose.
 *  3. A HOLD is the same family as `inFlight`: "not now, not over". It sits ABOVE the
 *     error, cap and funds checks precisely so a nozzle change can never be turned into
 *     a terminal stop on the way past them — the fired count, the cap and the run mode
 *     have to survive it (S6), and a hold rendered as a stop looks identical on screen
 *     for one second and is a different product by the second one.
 *  4. `consecutiveErrors`, then the cap, then funds. All three are still reached the
 *     moment the hold is released.
 *
 * THE FUNDS COMPARISON IS THE ENTIRE CEILING OF THIS DESIGN. Infinite mode has no
 * count; the balance is what ends it. It must therefore be compared against a balance
 * READ AGAIN as the stream runs, never the one read at launch — a stale balance is a
 * stream that keeps firing into a refusal.
 *
 * Non-vacuity: reverting the funds check must fail "a stream stops with reason 'funds'
 * when the balance is below the next piece's quoted impetus"; reverting the cap must
 * fail "a batched stream of K fires exactly K pieces and then stops with reason 'cap'";
 * reverting the in-flight guard must fail "no second piece is requested while one is
 * still in flight"; reverting the hold branch must fail "an uncommitted nozzle change
 * holds the stream instead of firing the next piece", and reverting the hold/stop
 * distinction must fail "a hold is NOT a stop".
 */
export function nextPieceDecision(input: StreamDecisionInput): StreamDecision {
  if (input.stopRequested) return { fire: false, stop: 'user' };
  if (input.inFlight) return { fire: false, stop: null };
  if (input.hold) return { fire: false, hold: input.hold };
  if (input.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return { fire: false, stop: 'errors' };
  if (input.mode === 'batched' && input.fired >= input.cap) return { fire: false, stop: 'cap' };
  if (impetus(input.balanceImpetus) < impetus(input.perPieceImpetus)) return { fire: false, stop: 'funds' };
  return { fire: true };
}

/**
 * What the launch control says. The price is ON the control rather than behind a
 * separate step, which is the change this item makes to how spend is seen: once, and
 * earlier, instead of per piece — not less.
 */
export function launchLabel(config: StreamConfig, quote: StreamQuote | null): string {
  if (!quote) return 'launch';
  const each = `~${quote.impetus} impetus each`;
  if (config.mode === 'infinite') return `launch · ${each} · rides until you stop it`;
  const n = Math.max(0, Math.trunc(config.cap));
  return `launch ${n} · ${each} · ~${impetusTotal(quote.impetus, n)} total`;
}

/** Why a stream ended, in words. Every stop reason gets one — including the one
 *  nobody chose (`lost`), which is what keeps D1's tradeoff visible instead of
 *  rendering a dead stream as a live one. */
export function stopLabel(cause: StopCause, fired: number, cap: number): string {
  switch (cause) {
    case 'user': return 'stopped — you stopped it';
    case 'funds': return 'stopped — out of funds';
    case 'cap': return `stopped — ${fired} of ${cap}`;
    case 'errors': return `stopped — ${MAX_CONSECUTIVE_ERRORS} fires failed`;
    case 'lost': return 'stopped — the page lost the stream';
  }
}

/** The stream's state in one line. Infinite mode has no progress bar and no total, so
 *  this readout is the only place a user can watch the money: it carries the pieces
 *  fired and the impetus this stream has spent, at every phase. */
export function streamStatusLine(
  phase: StreamPhase,
  cause: StopCause | null,
  fired: number,
  config: StreamConfig,
  quote: StreamQuote | null,
  hold?: HoldState | null,
): string {
  const spent = quote ? ` · ~${impetusTotal(quote.impetus, fired)} impetus this stream` : '';
  const made = `${fired} ${fired === 1 ? 'piece' : 'pieces'}`;
  if (phase === 'idle') return 'idle';
  // A reopened session that is not riding carries no fired count and no spend of its own —
  // both belong to the stream that made its pieces, which ended. What this line has to say
  // is that there is something here to come back to, so it says that and nothing more.
  if (phase === 'resumed') return "resumable · this session's pieces are below · launch to make more";
  // A hold carries the SAME figures a running stream carries — the count and the spend
  // are what a stop would reset, so showing them unchanged is how the readout says this
  // is a wait and not an ending.
  if (phase === 'holding') {
    return `${holdLabel(hold ?? { reason: 'picking' })} · ${made}${spent} · the stream resumes where it is`;
  }
  if (phase === 'running') {
    const progress = config.mode === 'batched'
      ? `${fired} of ${Math.max(0, Math.trunc(config.cap))} pieces`
      : made;
    return `running · ${progress}${spent}`;
  }
  if (phase === 'stopping') return `stopping after this piece · ${made}${spent}`;
  const why = cause ? stopLabel(cause, fired, Math.max(0, Math.trunc(config.cap))) : 'stopped';
  return `${why} · ${made}${spent}`;
}
