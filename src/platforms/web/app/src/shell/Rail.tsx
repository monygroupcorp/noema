import { Fragment } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { usePins } from '../lib/pins';
import { useIdentity } from '../state/identity';
import { WORK_PRIV, redactionFor } from '../lib/idents';
import { ProjectSwitcher } from './ProjectSwitcher';

// Ambient privacy reminder at the foot of the (now spacious) rail — the live "what actually
// reaches us" table, reacting to the current profile × execution mode.
function RailPrivacy() {
  const { ident, execution } = useIdentity();
  const work = WORK_PRIV[execution];
  return (
    <div className="railpriv">
      <div className="rp-l"><Ic name={work[0]} /> what reaches us</div>
      <div className="redact mono">
        {redactionFor(ident, execution).map((r, i) => (
          <div className="row" key={i}><span className="k">{r.k}</span><span className={`v ${r.block ? 'block' : ''}`}>{r.v}</span></div>
        ))}
      </div>
    </div>
  );
}

interface NavLeaf { to: string; ico: string; label: string; key?: string }
interface NavSection { sec: string; items: NavLeaf[] }

// Navigation only. Everything "you" — identity, wallet, live compute, account links —
// now lives in the top-right Account control (was three separate surfaces).
const NAV: NavSection[] = [
  // Catalog is the entry point for tools; a single "card" is the detail you reach from it.
  // "Cards" only earns a nav slot when there's something to show (active card / pinned) — see Rail().
  { sec: 'Create', items: [
    { to: '/', ico: 'message-square', label: 'Chat', key: '⌘1' },
    { to: '/catalog', ico: 'layout-grid', label: 'Catalog', key: '⌘2' },
    { to: '/canvas', ico: 'workflow', label: 'Canvas', key: '⌘3' },
  ] },
  { sec: 'Remember', items: [
    { to: '/space', ico: 'sparkles', label: 'Space', key: '⌘5' },
    { to: '/trace', ico: 'footprints', label: 'Traces' },
  ] },
];

export function Rail() {
  const loc = useLocation();
  const here = loc.pathname;
  const pinned: NavLeaf[] = usePins().map((p) => ({ to: `/card?id=${encodeURIComponent(p.id)}`, ico: 'star', label: p.name }));
  // The card you're on — surfaced as its own nav entry unless it's already pinned.
  const activeId = new URLSearchParams(loc.search).get('id');
  const activeTo = here === '/card' ? `/card?id=${encodeURIComponent(activeId ?? 'flux-schnell')}` : null;
  const activeUnpinned = activeTo && !pinned.some((p) => p.to === activeTo);
  // Inject under Create: the active (unpinned) card first, then the pinned cards.
  const cards: NavLeaf[] = [
    ...(activeUnpinned ? [{ to: activeTo, ico: 'sliders-horizontal', label: 'Active card' }] : []),
    ...pinned,
  ];
  const sections = NAV.map((s) =>
    s.sec === 'Create' && cards.length > 0 ? { ...s, items: [...s.items, ...cards] } : s
  );

  return (
    <aside className="rail">
      <div className="brand">
        <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><path className="lit" d="M12,2 A10 10 0 0 0 12,22 Z" /><circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.4" /></svg><b>noema</b>
        <Link to="/map" className="maplink" title="all screens"><Ic name="map" /></Link>
      </div>
      <ProjectSwitcher />
      <nav className="nav">
        {sections.map((s) => (
          <Fragment key={s.sec}>
            <div className="lbl">{s.sec}</div>
            {s.items.map((it) =>
              it.to.includes('?') ? (
                // Card links share the /card path — match on the full url so only the
                // card you're actually viewing highlights, not every pinned one.
                <Link key={it.to} to={it.to} className={`navitem${it.to === here + loc.search ? ' active' : ''}`}>
                  <span className="ico"><Ic name={it.ico} /></span> {it.label}
                </Link>
              ) : (
                <NavLink key={it.to} to={it.to} end className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
                  <span className="ico"><Ic name={it.ico} /></span> {it.label}
                  {it.key && <span className="k mono">{it.key}</span>}
                </NavLink>
              )
            )}
          </Fragment>
        ))}
      </nav>
      <RailPrivacy />
    </aside>
  );
}
