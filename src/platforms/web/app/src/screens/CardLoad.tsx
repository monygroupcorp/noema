import { Link } from 'react-router-dom';
import { doorPath } from '../lib/entry';

// The state of a model card's run panel while the flow schema is not yet on screen.
//
// A loading state is never terminal (DESIGN.md D-62): the read that fills the panel carries a
// deadline, and when it fails the screen says what happened and offers the way out — a retry,
// the catalogue, or sign-in when the server said the flow is not for an anonymous visitor.
// Both states hold the panel's layout (D-61), so the form does not shove the page about when
// it arrives.

export interface FlowLoadFailure {
  /** The sentence the API lib wrote for a person — never a raw code or body. */
  reason: string;
  /** True when the server answered 401/403: the flow exists, but not for this visitor. */
  needsSignIn: boolean;
}

/** Pure: read a rejected flow fetch into what the screen can act on. */
export function describeLoadFailure(e: unknown): FlowLoadFailure {
  const status = typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
    ? (e as { status: number }).status
    : undefined;
  const reason = e instanceof Error ? e.message : String(e);
  return { reason, needsSignIn: status === 401 || status === 403 };
}

export function FlowLoadNotice({ failure, id, onRetry }: { failure: FlowLoadFailure | null; id: string; onRetry: () => void }) {
  if (!failure) {
    return (
      <div className="flow-wait" aria-busy="true">
        <div className="t">Loading the run panel…</div>
      </div>
    );
  }
  return (
    <div className="flow-wait failed" role="alert">
      <div className="t">
        {failure.needsSignIn ? 'Running this model needs a signed-in account.' : 'The run panel for this model did not load.'}
      </div>
      <div className="r">{failure.reason}</div>
      <div className="actions">
        {failure.needsSignIn
          ? <Link className="btn" to={doorPath(`/card?id=${encodeURIComponent(id)}`)}>Sign in</Link>
          : <button type="button" className="btn" onClick={onRetry}>Try again</button>}
        <Link className="btn ghost" to="/catalog">Back to the catalogue</Link>
      </div>
    </div>
  );
}
