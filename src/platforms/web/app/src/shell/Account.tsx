import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { api } from '../lib/api';
import { clearOnboarded } from '../lib/entry';
import { Ic } from '../lib/icons';
import { Chip } from './Chip';

// The top-bar POSTURE CLUSTER + account dropdown (dashboard-spec.md, render
// noema-account-dropdown.png). The always-on honest readout that rides every surface:
// credits · active compute · identity — plus "+ start". The identity chip opens a
// restrained, posture-rich dropdown (NOT the old fused meter panel).

// compute label from the session execution mode (custody is per-run; this is the standing posture).
function computeLabel(exec: string): { glyph: 'lit' | 'ring' | 'dashed'; text: string } {
  if (exec === 'tee') return { glyph: 'ring', text: '1 sealed session' };
  if (exec === 'local') return { glyph: 'dashed', text: 'local · off-grid' };
  return { glyph: 'lit', text: 'shared' };
}

export function Account() {
  const { ident, execution } = useIdentity();
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [liveCredits, setLiveCredits] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
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
  // Switch who you are here — a real act now, not a cosmetic toggle: identified ⇄ anonymous
  // IS sign in / sign out. Signed in → sign out drops the fiat session onto the anon
  // commitment path; anonymous → the onboarding door to bring an identity.
  const switchIdentity = () => {
    setOpen(false);
    if (signedIn) { logout(); clearOnboarded(); navigate('/'); }
    else navigate('/onboard');
  };
  // Real sign out: drop the fiat session (falls back to the anon commitment path), then
  // clear the local onboarded flag and return home. Also used for the cosmetic-only case.
  const signOut = () => { if (signedIn) logout(); clearOnboarded(); setOpen(false); navigate('/'); };
  const signIn = () => { setOpen(false); navigate('/onboard'); };

  return (
    <div className="posture">
      {/* credits — gold economy colour */}
      <Link to="/funding" className="pc-pill credits" title="credits"><span className="gem">◈</span> {credits} <span className="u">cr</span></Link>
      {/* active compute — the hemisphere device */}
      <span className="pc-pill compute" title="active compute"><span className={`hemi2 ${compute.glyph}`} /> {compute.text}</span>
      {/* identity chip — opens the account dropdown */}
      <button className="pc-pill id-chip" ref={btnRef} onClick={toggle}>
        <Chip d={ident} /><span className="nm">{anon ? 'anonymous' : 'you'}</span><span className="cv"><Ic name="chevron-down" /></span>
      </button>
      <Link to="/chat" className="pc-start"><Ic name="plus" /> start</Link>

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
          <button className="am-switch" onClick={switchIdentity}>
            <Ic name="shuffle" /> switch to {anon ? 'identified' : 'anonymous'}
          </button>
          {/* Account-only actions. Profile · Settings · Preferences · Funding · Activity now live on
              the Rail (UX handoff 2, Decision 1) — this menu keeps only what's identity-scoped and
              the collaboration surfaces that have no Rail home yet. */}
          <div className="am-links">
            <Link to="/teams" onClick={() => setOpen(false)}><Ic name="users" /> Teams <span className="meta">co-own work</span></Link>
            <Link to="/sponsorships" onClick={() => setOpen(false)}><Ic name="hand-coins" /> Sponsorships <span className="meta">top up others</span></Link>
            {admin && <Link to="/admin/review" onClick={() => setOpen(false)}><Ic name="eye" /> Feed review <span className="meta">moderation</span></Link>}
          </div>
          {signedIn
            ? <button className="am-signout" onClick={signOut}><Ic name="arrow-right" /> Sign out</button>
            : <button className="am-signout" onClick={signIn}><Ic name="circle-user" /> Sign in</button>}
        </div>
      )}
    </div>
  );
}
