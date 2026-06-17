import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { TIER_LABEL } from '../lib/idents';
import { usePins } from '../lib/pins';
import { Chip } from './Chip';

interface NavLeaf { to: string; ico: string; label: string; key?: string }
interface NavMenu { ico: string; label: string; menu: NavLeaf[] }
interface NavSection { sec: string; items: (NavLeaf | NavMenu)[] }

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
  { sec: 'You', items: [
    { ico: 'circle-user', label: 'Account', menu: [
      { to: '/vault', ico: 'key-round', label: 'Vault' },
      { to: '/profile', ico: 'palette', label: 'Profile' },
      { to: '/status', ico: 'receipt-text', label: 'Ledger' },
    ] },
  ] },
];

const ACCOUNT_PATHS = ['/vault', '/profile', '/status'];

function AccountMenu({ item }: { item: NavMenu }) {
  const here = useLocation().pathname;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLButtonElement>(null);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(r.left, window.innerWidth - 196), bottom: window.innerHeight - r.top + 8 });
    setOpen((o) => !o);
  }
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest('#navmenu') && !t.closest('#accountnav')) setOpen(false);
    };
    document.addEventListener('click', c);
    return () => document.removeEventListener('click', c);
  }, [open]);

  return (
    <>
      <button id="accountnav" ref={ref} className={`navitem${ACCOUNT_PATHS.includes(here) ? ' active' : ''}`} onClick={toggle}>
        <span className="ico"><Ic name={item.ico} /></span> {item.label}
      </button>
      {open && (
        <div id="navmenu" className="open" style={pos}>
          {item.menu.map((m) => (
            <Link key={m.to} to={m.to} className={m.to === here ? 'on' : ''} onClick={() => setOpen(false)}>
              <Ic name={m.ico} /> {m.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Keyring() {
  const { ident, idents, setIdentity } = useIdentity();
  return (
    <div className="keyring">
      <div className="lbl">Keyring <Link to="/keyring" title="manage identities"><Ic name="settings-2" /></Link></div>
      <div>
        {idents.map((d) => (
          <div key={d.id} className={`ident ${d.id === ident.id ? 'sel' : ''}`} onClick={() => setIdentity(d.id)}>
            <Chip d={d} />
            <span className="meta">
              <div className="nm">{d.tier === 'anon' ? 'anonymous' : d.name}</div>
              <div className="tt"><span className="ttdot" />{TIER_LABEL[d.tier]}</div>
            </span>
          </div>
        ))}
      </div>
      <Link className="newid" to="/keyring"><span className="plus"><Ic name="plus" /></span><span>New identity…</span></Link>
    </div>
  );
}

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
        <span className="glyph" /><b>noema</b>
        <Link to="/map" className="maplink" title="all screens"><Ic name="map" /></Link>
      </div>
      <nav className="nav">
        {sections.map((s) => (
          <Fragment key={s.sec}>
            <div className="lbl">{s.sec}</div>
            {s.items.map((it) =>
              'menu' in it ? (
                <AccountMenu key="account" item={it} />
              ) : it.to.includes('?') ? (
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
      <Keyring />
    </aside>
  );
}
