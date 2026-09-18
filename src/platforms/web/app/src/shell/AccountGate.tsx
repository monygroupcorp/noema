import { Link, useLocation } from 'react-router-dom';
import { doorPath } from '../lib/entry';
import { Ic } from '../lib/icons';

// ONE RULE for what a visitor with no account sees.
//
// "Signed out" is not "no identity" here: a browser with no account still carries the anonymous
// commitment, and the server treats it as a real caller (`x-commitment` resolves to an AuctorKey).
// So the question a screen has to answer is not "is there a session?" but "can this work happen
// without an identified account?" — and the server already answers it, by refusing the calls that
// cannot with `auth.forbidden: requires an identified account`.
//
// The rule that follows from that, and the only one this app gets:
//
//   * ACCOUNT-BOUND — nothing on the screen works without an identified account. It renders its
//     heading and <AccountGate/>, and NOTHING else. No form, no empty list, no disabled control.
//     An empty "your teams" list is a lie when the emptiness is only the absence of an account,
//     and a form nobody can submit is worse: it invites work it will throw away.
//
//   * ANON-CAPABLE — the anonymous commitment can do most or all of it. The screen renders in
//     full, and each action that does need an account stays LIVE and routes through the door,
//     which hands the visitor back to this same page (see Funding, Profile, Vault).
//
// Both halves send the visitor through `doorPath`, so nobody loses their place signing in. The
// gate card is spelled exactly once — here — because four hand-copied versions of it is how the
// app came to have two designs for the same moment. `signedOut.test.ts` holds both halves shut.

/** The front door for the page the visitor is standing on, with the walk back built in. */
export function useDoorHere(): string {
  const { pathname, search } = useLocation();
  return doorPath(pathname + search);
}

/**
 * The whole of what an account-bound screen shows a visitor without an account.
 * `why` is that screen's own reason, in its own words — the one thing that varies.
 */
export function AccountGate({ why }: { why: string }) {
  const door = useDoorHere();
  return (
    <div className="empty">
      <div className="ico"><Ic name="circle-user" /></div>
      <div className="t">Sign in to continue</div>
      <div className="s">{why}</div>
      <Link className="btn" to={door}><Ic name="circle-user" /> Sign in</Link>
    </div>
  );
}
