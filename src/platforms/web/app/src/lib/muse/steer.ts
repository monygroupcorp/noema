// The steer keyboard and the consent sheet (noema-261): a proposal over the session floor,
// vetoed one pill at a time. THE FLOOR MOVES ONLY ON CONFIRM.

import { fragmentKey } from '../../../../../../crystal/muse/taxonomy.js';
import { MAX_FLOOR_FRAGMENTS, MAX_INSTRUCTION_CHARS } from '../../../../../../crystal/muse/steer.js';
import type {
  FragmentCategory,
  MuseFragmentIdentity,
  MuseSessionView,
  MuseSteerProposal,
  RunRequest,
} from '../api';

// ── The steer keyboard and the consent sheet (noema-261) ─────────────────────
// The surface over the steer route. A person writes a short instruction, one metered
// call returns a PROPOSAL, and the proposal is rendered as a sheet of pills that can be
// vetoed one by one. THE FLOOR MOVES ONLY ON CONFIRM, through the same two floor routes
// every other gesture on this screen uses.
//
// Three rules are load-bearing and each one is a pure function below rather than a
// judgement made in the screen:
//
//   A VETOED PILL WRITES NOTHING. A veto that still wrote would be silent destruction —
//   the user said no and the floor moved anyway — and it is the one failure the sheet
//   exists to make impossible.
//
//   NOTHING IS WRITTEN BEFORE CONFIRM. `writesForConfirm` is gated on the sheet's phase,
//   so a sheet under review yields an empty write set however many pills it holds.
//
//   THE OFFER IS AN OFFER. `dismissalOffer` returns text to pre-fill the keyboard with
//   and nothing else. It carries no flow, no aditus and no request, so no arrangement of
//   dismissals can spend: the metered call happens when a person presses send, never as
//   a side effect of passing on pieces.

/** The metered flow one steer runs on. Priced through `POST /v1/runs/quote` with the
 *  same aditus the route builds, so the figure is the run's own reservation. */
export const STEER_MODUS_ID = 'modus.muse-steer';

/**
 * The fragments a steer will actually read: everything the session holds that the floor
 * has not turned off, as identities.
 *
 * This mirrors what the route does server-side (`enabledFragments`) — a fragment with no
 * floor entry is in the draw, and only an explicit `enabled: false` takes it out. The
 * count is what the price is quoted against and what the per-steer cap is judged against,
 * so it has to be the same set the server will steer rather than every fragment on file.
 */
export function steerFloor(view: MuseSessionView | null): MuseFragmentIdentity[] {
  if (!view) return [];
  const state = new Map(view.floor.map((e) => [e.key, e]));
  return view.fragments
    .filter((f) => state.get(fragmentKey(f))?.enabled !== false)
    .map((f) => ({ category: f.category, text: f.text }));
}

/** Characters left in the instruction. Negative once it is over the server's bound, which
 *  is what the keyboard counts down and what `steerBlockReason` refuses on. */
export function instructionRemaining(instruction: string): number {
  return MAX_INSTRUCTION_CHARS - instruction.trim().length;
}

/**
 * Why this steer cannot be sent, or `null` when it can.
 *
 * Every rule here is the SERVER's, mirrored so a person is not told "no" after writing a
 * sentence — and mirrored is all it is: the API layer refuses an empty or oversized
 * instruction with a 400 and the cursor refuses an oversized floor in `reserve()`, both
 * before anything is spent. The keyboard never becomes the enforcement.
 */
export function steerBlockReason(input: {
  view: MuseSessionView | null;
  instruction: string;
  inFlight: boolean;
}): string | null {
  if (input.inFlight) return 'a steer is already running';
  if (!input.view) return 'no session yet';
  const floor = steerFloor(input.view);
  if (floor.length === 0) return 'nothing is in the draw to steer';
  if (floor.length > MAX_FLOOR_FRAGMENTS) {
    return `this floor carries ${floor.length} fragments in the draw, above the ${MAX_FLOOR_FRAGMENTS} one steer reads —`
      + ' turn some off in the cutting floor first';
  }
  const trimmed = input.instruction.trim();
  if (!trimmed) return 'write what you want changed first';
  if (trimmed.length > MAX_INSTRUCTION_CHARS) {
    return `that is ${trimmed.length} characters — a steer is at most ${MAX_INSTRUCTION_CHARS}`;
  }
  return null;
}

/**
 * The quote request for one steer: the same modus and the same aditus the route builds,
 * so `POST /v1/runs/quote` prices this exact run without creating it.
 *
 * The reservation is a base plus a per-floor-fragment term and does not read the
 * instruction's content, so the figure is stable for a given floor size — which is why
 * the screen re-quotes when the floor changes rather than on every keystroke. The
 * reservation still needs an instruction to be present, so an empty box prices against a
 * stand-in; the number it returns is the number the written instruction will be quoted at.
 */
export function steerQuoteRequest(
  instruction: string,
  floor: readonly MuseFragmentIdentity[],
): Pick<RunRequest, 'modusId' | 'aditus'> {
  const trimmed = instruction.trim();
  return {
    modusId: STEER_MODUS_ID,
    aditus: { instruction: trimmed || 'steer this floor', floor: floor.map((f) => ({ ...f })) },
  };
}

/** One pill in the consent sheet. `key` is the fragment's identity and is what a veto is
 *  recorded against — an elimination names a fragment the floor holds and an addition one
 *  it does not, so the two sides cannot collide on it. */
export interface SteerPill {
  kind: 'elimination' | 'addition';
  category: FragmentCategory;
  text: string;
  key: string;
}

/**
 * The proposal as pills, eliminations first.
 *
 * Nothing here re-derives what the server already decided: every elimination is on the
 * floor as it stands and every addition is in the taxonomy and new to the floor, because
 * `validateProposal` is the single validation point and it already dropped everything
 * else. An addition arrives carrying its own attribution; the pill does not render it —
 * see the note on `writesForConfirm`.
 */
export function proposalPills(proposal: MuseSteerProposal | null): SteerPill[] {
  if (!proposal) return [];
  return [
    ...proposal.eliminations.map((f) => ({
      kind: 'elimination' as const, category: f.category, text: f.text, key: fragmentKey(f),
    })),
    ...proposal.additions.map((f) => ({
      kind: 'addition' as const, category: f.category, text: f.text, key: fragmentKey(f),
    })),
  ];
}

/**
 * What the sheet says about the changes that did not survive validation, or `null` when
 * none were dropped.
 *
 * SAID IN WORDS, never swallowed. The route counts drops precisely so this sentence can
 * be true: a user shown a shorter list with no explanation comes away believing they
 * vetoed something that was never proposed to them.
 */
export function droppedNote(dropped: number): string | null {
  if (!Number.isFinite(dropped) || dropped <= 0) return null;
  return dropped === 1
    ? "1 suggestion didn't fit your floor and was dropped"
    : `${dropped} suggestions didn't fit your floor and were dropped`;
}

/** Where a sheet is: under review, or confirmed by the person reading it. Confirm is the
 *  cut line, and this is that line as a value. */
export type SheetPhase = 'reviewing' | 'confirmed';

/**
 * One floor call the confirm makes. `disable` is `PATCH …/floor/enabled` with
 * `enabled: false`; `add` is `POST …/floor/fragments`.
 *
 * A disable DARKENS a fragment, it never deletes it (S8): the pill stays on the cutting
 * floor and tapping it brings it back. A steer's elimination is the same act as tapping
 * that pill, with the same reversibility.
 */
export type FloorWrite =
  | { kind: 'disable'; fragment: MuseFragmentIdentity }
  | { kind: 'add'; fragment: MuseFragmentIdentity };

/**
 * The exact floor calls a confirmed sheet makes, and nothing else.
 *
 * THIS IS WHERE THE SHEET'S PROMISES ARE KEPT, and each one is a line of code here rather
 * than a rule the screen is trusted to follow:
 *
 *   A VETOED PILL CONTRIBUTES NOTHING. Vetoes are keyed by fragment identity and filtered
 *   before anything is emitted, on both sides.
 *
 *   AN ELIMINATION IS EXACTLY ONE `enabled: false` WRITE for that identity, and never an
 *   add. Turning an elimination into an addition — or into both — would put a phrase on
 *   the floor that the user asked to have taken off it.
 *
 *   A SHEET UNDER REVIEW WRITES NOTHING. `reviewing` yields an empty set however many
 *   pills survive, so the floor cannot move before the person reading the sheet rules on
 *   it. That is V2 stated as code: confirm is the cut line.
 *
 * One thing this deliberately does NOT carry: the proposal's own attribution. An addition
 * comes back marked as a steer's, and the confirm sends it down the floor-fragments route,
 * which builds the fragment as a manual one — so the provenance label does not survive the
 * confirm. The pills and the floor entry are both correct; only that label is lost, and
 * nothing here or on screen claims a provenance the floor does not carry. Preserving it
 * needs a `source` argument on that route, which is a server change and a separate ruling.
 */
export function writesForConfirm(
  proposal: MuseSteerProposal | null,
  vetoed: ReadonlySet<string>,
  phase: SheetPhase,
): FloorWrite[] {
  if (!proposal || phase !== 'confirmed') return [];
  const writes: FloorWrite[] = [];
  for (const f of proposal.eliminations) {
    if (vetoed.has(fragmentKey(f))) continue;
    writes.push({ kind: 'disable', fragment: { category: f.category, text: f.text } });
  }
  for (const f of proposal.additions) {
    if (vetoed.has(fragmentKey(f))) continue;
    writes.push({ kind: 'add', fragment: { category: f.category, text: f.text } });
  }
  return writes;
}

/** One floor write named as the sheet names it, for the row that says which ones landed
 *  and which did not. */
export function writeLabel(write: FloorWrite): string {
  return `${write.kind === 'disable' ? 'off' : 'add'} · ${write.fragment.category}: ${write.fragment.text}`;
}

/**
 * What the sheet says after a confirm that did not fully land.
 *
 * The writes that landed STAY LANDED and the ones that did not are named — the same
 * partial-batch honesty the moodboard append uses. A consent sheet that half-applied and
 * said nothing is worse than one that visibly failed: the floor would have moved in a way
 * the user could neither see nor undo.
 */
export function confirmOutcomeNote(landed: number, failed: readonly string[]): string {
  const applied = `${landed} ${landed === 1 ? 'change' : 'changes'} applied to the floor`;
  if (failed.length === 0) return `${applied}.`;
  return `${applied} · ${failed.length} did not land and ${failed.length === 1 ? 'is' : 'are'} still as`
    + ` ${failed.length === 1 ? 'it' : 'they'} ${failed.length === 1 ? 'was' : 'were'}: ${failed.join('; ')}`;
}

/**
 * How many pieces a person passes on before the screen offers to help (S12).
 *
 * Three in a row, with no floor change between them: one dismissal is taste, three
 * without touching the floor is a pattern the floor has not been told about.
 */
export const DISMISSALS_BEFORE_OFFER = 3;

/** Dismissals since the floor last moved. The only state the offer is derived from. */
export interface DismissalState { sinceFloorChange: number }

/** No dismissals yet — where a screen starts. */
export const NO_DISMISSALS: DismissalState = { sinceFloorChange: 0 };

/** One ✕. Counted, and that is the whole of what a dismissal does on its own: it moves no
 *  floor by itself, exactly as it did before this sheet existed. */
export function recordDismissal(state: DismissalState): DismissalState {
  return { sinceFloorChange: state.sinceFloorChange + 1 };
}

/**
 * Any floor change — an enable, a weight, an add, a confirmed sheet — resets the count.
 *
 * THE RESET IS THE PROPERTY. A count that survived a floor change would re-offer the same
 * suggestion immediately after the user acted on it, so the offer has to be earned again
 * from zero: three more dismissals, after the floor moved.
 */
export function recordFloorChange(state: DismissalState): DismissalState {
  return state.sinceFloorChange === 0 ? state : NO_DISMISSALS;
}

/**
 * The offer, when it has been earned.
 *
 * AN OFFER, NEVER AN ACTION. What comes back is a line to render and text to pre-fill the
 * instruction box with — no flow id, no aditus, no request, nothing that can be dispatched.
 * Compare `steerQuoteRequest`, which is the metered path and carries a `modusId`. That gap
 * is the product rule: a steer is user-initiated, and one that fired because somebody
 * scrolled past three pieces would be a spend nobody chose.
 */
export interface SteerOffer { kind: 'offer'; line: string; instruction: string }

export function dismissalOffer(state: DismissalState): SteerOffer | null {
  if (state.sinceFloorChange < DISMISSALS_BEFORE_OFFER) return null;
  return {
    kind: 'offer',
    line: "you've passed on three in a row — want me to suggest a change?",
    instruction: "I keep passing on these — suggest what to change about the floor",
  };
}

