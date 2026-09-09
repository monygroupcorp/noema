// ── writeConfirmed — remembering which write cards have already been pressed ──
//
// A reply that carries an un-confirmed write card persists SERIALIZED (colloquiaRouter's
// `dictumCorpus`), so resuming the thread shows the confirmation again. That is the point when
// nobody has pressed GO yet — and a hazard the moment somebody has: the stored corpus is the
// agent's proposal, not a record of what the user did with it, so without this the resumed card
// offers a second GO and `create_dataset` mints the dataset twice.
//
// The write happened in the browser, on the user's own click, through the ordinary public API —
// there is nothing on the server that could be asked. So the browser is what remembers, keyed by
// the turn's own idempotency key (the `turnKey` the agent Dictum carries), which is the one
// identity both the live turn and the resumed one have in hand.
//
// It fails OPEN, deliberately: a browser with no storage, or a different browser, shows a live
// card again. That is the safe direction — a card the user must press is recoverable, a write
// they never authorized is not.

const KEY = 'noema-concierge-writes-confirmed';

/** Turn keys kept. A card is only replayable while its thread is resumable in practice, so this
 *  is a small recency window, not an archive. The oldest fall off first. */
export const CONFIRMED_MAX = 200;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch { return []; }
}

/** True once GO has landed for this turn in this browser. An absent key reads as not-confirmed. */
export function isWriteConfirmed(turnKey: string | undefined): boolean {
  if (!turnKey) return false;
  return read().includes(turnKey);
}

/** Record that this turn's write has been performed. Idempotent; silent on any storage error. */
export function markWriteConfirmed(turnKey: string | undefined): void {
  if (!turnKey) return;
  try {
    const kept = read().filter((k) => k !== turnKey);
    localStorage.setItem(KEY, JSON.stringify([...kept, turnKey].slice(-CONFIRMED_MAX)));
  } catch { /* ignore — fails open, the card stays live */ }
}
