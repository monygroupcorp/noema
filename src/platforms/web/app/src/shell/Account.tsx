import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useIdentity } from '../state/identity';
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
  const { ident, idents, setIdentity, execution } = useIdentity();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [liveCredits, setLiveCredits] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    api.meStatus()
      .then((s) => { if (live && s?.balanceImpetus != null) setLiveCredits(Number(s.balanceImpetus).toLocaleString()); })
      .catch(() => { /* mock fallback */ });
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

  const anon = ident.funding === 'bearer';
  const name = anon ? 'anonymous' : ident.name;
  const credits = liveCredits ?? (ident.bal.match(/(\d[\d,]*)\s*credits?/)?.[1] ?? '—');
  const compute = useMemo(() => computeLabel(execution), [execution]);
  const reach = anon ? 'bearer purse' : 'signed in · web · Telegram · API';

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ right: Math.max(12, window.innerWidth - r.right), top: r.bottom + 8 });
    setOpen((o) => !o);
  }
  // switch identity between the named profile and the bearer (the signature "change who you are here").
  const switchIdentity = () => {
    const other = idents.find((d) => (anon ? d.funding === 'named' : d.funding === 'bearer'));
    if (other) setIdentity(other.id);
    setOpen(false);
  };
  const signOut = () => { clearOnboarded(); setOpen(false); navigate('/'); };

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
          <div className="am-links">
            <Link to="/account" onClick={() => setOpen(false)}><Ic name="settings-2" /> Account &amp; settings</Link>
            <Link to="/preferences" onClick={() => setOpen(false)}><Ic name="sparkles" /> Preferences <span className="meta">your defaults</span></Link>
            <Link to="/funding" onClick={() => setOpen(false)}><Ic name="wallet" /> Funding &amp; credits</Link>
          </div>
          <button className="am-signout" onClick={signOut}><Ic name="arrow-right" /> Sign out</button>
        </div>
      )}
    </div>
  );
}
