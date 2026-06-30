import { Fragment } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { IDENTITY_PRIV } from '../lib/idents';
import { Chip } from './Chip';

// The single global nav (app-shell-overview.md / dashboard-spec.md): Home; Make (Chat·Canvas);
// Library (Catalogue·Datasets); Build (Models·Collections); pinned bottom Funding · Settings ·
// account avatar. This rail replaces every surface's ad-hoc breadcrumb. The privacy posture
// is NOT here — it rides the top-bar posture cluster on every surface.
interface NavLeaf { to: string; ico: string; label: string }
interface NavSection { sec?: string; items: NavLeaf[] }

const NAV: NavSection[] = [
  { items: [{ to: '/app', ico: 'home', label: 'Home' }] },
  { sec: 'Make', items: [
    { to: '/chat', ico: 'message-square', label: 'Chat' },
    { to: '/canvas', ico: 'workflow', label: 'Canvas' },
  ] },
  { sec: 'Library', items: [
    { to: '/catalog', ico: 'layout-grid', label: 'Catalogue' },
    { to: '/datasets', ico: 'database', label: 'Datasets' },
  ] },
  { sec: 'Build', items: [
    { to: '/models', ico: 'box', label: 'Models' },
    { to: '/collections', ico: 'hexagon', label: 'Collections' },
  ] },
];

export function Rail() {
  const { ident } = useIdentity();
  const who = IDENTITY_PRIV[ident.funding];
  return (
    <aside className="rail">
      <div className="brand">
        <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><path className="lit" d="M12,2 A10 10 0 0 0 12,22 Z" /><circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.4" /></svg><b>noema</b>
        <Link to="/map" className="maplink" title="all screens"><Ic name="map" /></Link>
      </div>

      <nav className="nav">
        {NAV.map((s, i) => (
          <Fragment key={s.sec ?? `g${i}`}>
            {s.sec && <div className="lbl">{s.sec}</div>}
            {s.items.map((it) => (
              <NavLink key={it.to} to={it.to} end className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
                <span className="ico"><Ic name={it.ico} /></span> {it.label}
              </NavLink>
            ))}
          </Fragment>
        ))}
      </nav>

      {/* pinned bottom: funding · settings · the account avatar (sign-in state) */}
      <div className="railfoot">
        <NavLink to="/funding" className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="wallet" /></span> Funding
        </NavLink>
        <NavLink to="/account" className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="settings-2" /></span> Settings
        </NavLink>
        <Link to="/status" className="railavatar" title={`${ident.funding === 'bearer' ? 'anonymous' : ident.name} · account`}>
          <Chip d={ident} />
          <span className="ra-main">
            <span className="nm">{ident.funding === 'bearer' ? 'anonymous' : ident.name}</span>
            <span className="ra-sub"><Ic name={who[0]} /> {who[1]}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
