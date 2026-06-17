import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { TIER_LABEL } from '../lib/idents';
import { Chip } from './Chip';

interface NavLeaf { to: string; ico: string; label: string; key?: string }
interface NavMenu { ico: string; label: string; menu: NavLeaf[] }
interface NavSection { sec: string; items: (NavLeaf | NavMenu)[] }

const NAV: NavSection[] = [
  { sec: 'Create', items: [
    { to: '/', ico: 'message-square', label: 'Chat', key: '⌘1' },
    { to: '/card', ico: 'sliders-horizontal', label: 'Cards', key: '⌘2' },
    { to: '/catalog', ico: 'layout-grid', label: 'Catalog', key: '⌘3' },
    { to: '/canvas', ico: 'workflow', label: 'Canvas', key: '⌘4' },
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
  return (
    <aside className="rail">
      <div className="brand">
        <span className="glyph" /><b>noema</b>
        <Link to="/map" className="maplink" title="all screens"><Ic name="map" /></Link>
      </div>
      <nav className="nav">
        {NAV.map((s) => (
          <Fragment key={s.sec}>
            <div className="lbl">{s.sec}</div>
            {s.items.map((it) =>
              'menu' in it ? (
                <AccountMenu key="account" item={it} />
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
