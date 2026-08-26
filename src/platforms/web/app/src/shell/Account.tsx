import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { api } from '../lib/api';
import { clearOnboarded } from '../lib/entry';
import { Ic } from '../lib/icons';
import { Chip } from './Chip';
import { BuyCreditsModal } from '../screens/BuyCreditsModal';
import { guardedClick, guardedNavigate } from '../lib/dirtyGuard';

// The top-bar POSTURE CLUSTER + account dropdown (dashboard-spec.md, render
// noema-account-dropdown.png). The always-on honest readout that rides every surface:
// credits · active compute · identity — plus "+ start". The identity chip opens a
// restrained, posture-rich dropdown (NOT the old fused meter panel).

// compute label from the session execution mode (custody is per-run; this is the standing posture).
// Every run executes on our shared compute today — there is no other posture to report.
function computeLabel(_exec: string): { glyph: 'lit' | 'ring' | 'dashed'; text: string } {
  return { glyph: 'lit', text: 'shared' };
}

export function Account() {
  const { ident, idents, execution, setIdentity } = useIdentity();
  const { session, signOutActive, signOutAll, accounts } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [liveCredits, setLiveCredits] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    api.meStatus()
      .then((s) => { if (live && s?.balanceImpetus != null) setLiveCredits(Number(s.balanceImpetus).toLocaleString()); })
      .catch(() => { /* mock fallback */ });
    // Reveal the moderation surface only to the platform reviewer (server-authoritative).
    api.getMe().then((me) => { if (live) setAdmin(!!me.admin); }).catch(() => { /* not admin */ });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest('#acctpop') && !t.closest('.id-chip')) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  // Close the dropdown on navigation (including a guarded link that was allowed through).
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const signedIn = !!session;
  const anon = ident.funding === 'bearer';
  // The real fiat session takes precedence over the cosmetic identity skin for the name/reach readout.
  const name = signedIn ? (session!.username ?? 'your account') : anon ? 'anonymous' : ident.name;
  const credits = liveCredits ?? (ident.bal.match(/(\d[\d,]*)\s*credits?/)?.[1] ?? '—');
  const compute = useMemo(() => computeLabel(execution), [execution]);
  const reach = signedIn || !anon ? 'signed in · web · Telegram · API' : 'bearer purse';

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ right: Math.max(12, window.innerWidth - r.right), top: r.bottom + 8 });
    setOpen((o) => !o);
  }
  // Composes the leave guard with the menu's own "close on click" behaviour for the four
  // am-links Links below.
  function guardedClickClose(e: React.MouseEvent) {
    guardedClick(e);
    setOpen(false);
  }
  // Switch among held logins (or the anon slot) — a real act via the account list below.
  const switchTo = (id: string) => { setIdentity(id); setOpen(false); };
  // Additive sign-in: bring another account without dropping the current one.
  const addAccount = () => guardedNavigate(navigate, '/onboard?add=1');
  // Sign out of the ACTIVE account — drops to the next held login, or the anon path.
  const signOut = () => { signOutActive(); setOpen(false); };
  // Drop every held login, clear the local onboarded flag, and return to the front door. The
  // sharpest exit: it discards unsaved work AND signs the user out, so the guard runs first.
  const signOutEverything = () => guardedNavigate((to) => { signOutAll(); clearOnboarded(); navigate(to); }, '/');
  const signIn = () => guardedNavigate(navigate, '/onboard');

  return (
    <div className="posture">
      {/* credits — gold economy colour; opens the buy-credits ledger directly (add credits
          from anywhere, not just the Funding screen). */}
      <button className="pc-pill credits" title="add credits" onClick={() => setBuyOpen(true)}>
        <span className="gem">◈</span> {credits} <span className="u">cr</span>
      </button>
      <BuyCreditsModal open={buyOpen} onClose={() => setBuyOpen(false)} />
      {/* active compute — the hemisphere device; standing posture readout (not a link) */}
      <span className="pc-pill compute" title="active compute"><span className={`hemi2 ${compute.glyph}`} /> {compute.text}</span>
      {/* identity chip — opens the account dropdown */}
      <button className="pc-pill id-chip" ref={btnRef} onClick={toggle}>
        <Chip d={ident} /><span className="nm">{anon ? 'anonymous' : 'you'}</span><span className="cv"><Ic name="chevron-down" /></span>
      </button>
      <Link to="/chat" className="pc-start" onClick={guardedClick}><Ic name="plus" /> start</Link>

      {open && (
        <div id="acctpop" className="acctmenu" style={pos}>
          <div className="am-head">
            <Chip d={ident} />
            <div><div className="nm">{name}</div><div className="reach">{reach}</div></div>
          </div>
          <div className="am-stats">
            <div className="am-stat"><div className="l">credits</div><div className="v"><span className="gem">◈</span> {credits}</div></div>
            <div className="am-stat"><div className="l">compute</div><div className="v"><span className={`hemi2 ${compute.glyph}`} /> {compute.text}</div></div>
          </div>
          {/* The held logins + the anon slot — switch freely (Keyring in miniature). */}
          <div className="am-accounts">
            {idents.map((d) => {
              const active = d.id === ident.id;
              const rowAnon = d.funding === 'bearer';
              return (
                <button key={d.id} className={`am-acct${active ? ' on' : ''}`} onClick={() => switchTo(d.id)}>
                  <Chip d={d} />
                  <span className="nm">{rowAnon ? 'anonymous' : d.name}</span>
                  {active && <span className="chk">✓</span>}
                </button>
              );
            })}
            <button className="am-acct add" onClick={addAccount}><Ic name="plus" /> Add account</button>
          </div>
          {/* Account-only actions. Profile · Settings · Preferences · Funding · Activity now live on
              the Rail (UX handoff 2, Decision 1) — this menu keeps only what's identity-scoped and
              the collaboration surfaces that have no Rail home yet. */}
          <div className="am-links">
            <Link to="/teams" onClick={guardedClickClose}><Ic name="users" /> Teams <span className="meta">co-own work</span></Link>
            <Link to="/sponsorships" onClick={guardedClickClose}><Ic name="hand-coins" /> Sponsorships <span className="meta">top up others</span></Link>
            {admin && <Link to="/admin" onClick={guardedClickClose}><Ic name="layout-grid" /> Admin workspace <span className="meta">review · revenue · COGS</span></Link>}
          </div>
          {signedIn ? (
            <>
              <button className="am-signout" onClick={signOut}><Ic name="arrow-right" /> Sign out</button>
              {accounts.length > 1 && <button className="am-signout" onClick={signOutEverything}><Ic name="arrow-right" /> Sign out of all</button>}
            </>
          ) : (
            <button className="am-signout" onClick={signIn}><Ic name="circle-user" /> Sign in</button>
          )}
        </div>
      )}
    </div>
  );
}
