import { Link, useLocation } from 'react-router-dom';
import { ApiRequestError, getSession } from '../lib/api';
import { doorPath } from '../lib/entry';
import './load-failure.css';

// The one state a record screen shows when the record it was opened on cannot be read
// (DESIGN.md D-62). Every screen that loads one thing by id — a collection, a dataset, a run —
// renders this instead of its chrome, so the sentence, the hue and the way out are the same
// everywhere and none of them quotes the id or the server's wording back at the reader.
//
// Three kinds, because they ask for three different things:
//   • `missing`   — the API said not found. The server answers 404 for a record that is not
//                   the caller's as well as for one that does not exist (ids stay
//                   non-enumerable), so for a signed-in reader the sentence says both. No retry:
//                   asking again will not change the answer. A visitor with no session is told
//                   the one thing the app knows for certain — that they are not signed in — and
//                   offered the door, since the record may be theirs under an account.
//   • `signin`    — the API refused the caller (401/403). The record is not open to visitors.
//   • `transient` — anything else: the server fell over, the connection dropped, the read timed
//                   out. Retry is the action, and the back link is the way out if it keeps failing.
//
// One action is the filled button and the rest are ghost buttons (D-42): whichever one resolves
// the state — retry, the door, or failing both, the way back. The way back is a button either
// way, never a bare underlined word beside a pill (D-43); ghost chrome keeps the primary primary.

export type LoadFailureKind = 'missing' | 'signin' | 'transient';

/** Which kind a failed read is, from the error the API client threw. */
export function loadFailureKind(e: unknown): LoadFailureKind {
  if (e instanceof ApiRequestError) {
    if (e.status === 404 && e.code.startsWith('not_found')) return 'missing';
    if (e.status === 401 || e.status === 403) return 'signin';
  }
  return 'transient';
}

/** The lists that own records, named as the rail names them (D-69) — the way out of a dead end.
 *  Labels are lowercase because they land mid-sentence ("Back to collections", D-26). */
export const BACK = {
  collections: { to: '/collections', label: 'collections' },
  datasets: { to: '/datasets', label: 'datasets' },
  home: { to: '/app', label: 'home' },
} as const;

export interface LoadFailureProps {
  /** The record, as a lowercase noun: 'collection', 'dataset', 'run'. */
  noun: string;
  kind: LoadFailureKind;
  /** The list this record belongs to. */
  back: { to: string; label: string };
  /** Run the read again. Offered only for a transient failure; a 404 is not retried. */
  onRetry?: () => void;
}

/** What happened and what to do, in plain words. */
export function loadFailureCopy(noun: string, kind: LoadFailureKind, signedIn: boolean): { what: string; next: string | null } {
  switch (kind) {
    case 'missing':
      return signedIn
        ? { what: `This ${noun} doesn't exist, or isn't yours to open.`, next: null }
        : { what: "You're not signed in.", next: `If this ${noun} is yours, sign in to open it.` };
    case 'signin':
      return signedIn
        ? { what: `This ${noun} isn't yours to open.`, next: 'Sign in to the account that owns it to open it.' }
        : { what: "You're not signed in.", next: `This ${noun} is not open to visitors. Sign in to open it.` };
    default:
      return {
        what: `This ${noun} couldn't be loaded.`,
        next: 'Something went wrong on the way, not with anything you did. Try again in a moment.',
      };
  }
}

/** Whether the card is a failed read (danger frame) or a door (neutral frame), per D-10. */
export function loadFailureFailed(kind: LoadFailureKind, signedIn: boolean): boolean {
  return kind === 'transient' || (kind === 'missing' && signedIn);
}

export function LoadFailure({ noun, kind, back, onRetry }: LoadFailureProps) {
  const location = useLocation();
  const signedIn = getSession() !== null;
  const copy = loadFailureCopy(noun, kind, signedIn);
  const failed = loadFailureFailed(kind, signedIn);
  const offerRetry = kind === 'transient' && onRetry !== undefined;
  const offerDoor = kind === 'signin' || (kind === 'missing' && !signedIn);
  // The way back is the primary only when nothing else is offered.
  const backIsPrimary = !offerRetry && !offerDoor;
  return (
    <div className="page"><div className="pw">
      <div className={`load-fail${failed ? ' bad' : ''}`} role="alert">
        <p className="load-fail-what">{copy.what}</p>
        {copy.next && <p className="load-fail-next">{copy.next}</p>}
        <div className="load-fail-actions">
          {offerRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
          {offerDoor && <Link className="btn" to={doorPath(location.pathname + location.search)}>Sign in</Link>}
          <Link className={backIsPrimary ? 'btn' : 'btn ghost load-fail-back'} to={back.to}>Back to {back.label}</Link>
        </div>
      </div>
    </div></div>
  );
}
