import { Fragment, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';
import { useIdentity } from '../state/identity';
import { IDENTITY_PRIV } from '../lib/idents';
import { Chip } from './Chip';

// The single global nav — the production pillars that cover the whole product (UX handoff 2,
// Decision 1): Create · Memory · Build · Publish · Identity · Account (pinned footer). "Create"
// is the generate bucket — deliberately NOT "Make" (a protected canon verb / the default
// text→image flow). This rail replaces every surface's ad-hoc breadcrumb. The privacy posture is
// NOT here — it rides the top-bar posture cluster on every surface.
// Keyring (multi-account) and Private/sealed compute (Tee, D8) both have real homes on the
// Identity pillar now. Trace (D7) was deleted (superseded by Space's in-page viewer). Studio
// (the warm-pod HUD) is reached from Settings → Compute; /map is retired.
interface NavLeaf { to: string; ico: string; label: string }
interface NavSection { sec?: string; items: NavLeaf[] }

const NAV: NavSection[] = [
  { items: [
    { to: '/app', ico: 'home', label: 'Home' },
  ] },
  { sec: 'Create', items: [
    { to: '/chat', ico: 'message-square', label: 'Chat' },
    { to: '/catalog', ico: 'layout-grid', label: 'Catalogue' },
    { to: '/canvas', ico: 'workflow', label: 'Canvas' },
  ] },
  { sec: 'Memory', items: [
    { to: '/space', ico: 'footprints', label: 'Space' },
  ] },
  { sec: 'Build', items: [
    { to: '/datasets', ico: 'database', label: 'Datasets' },
    { to: '/models', ico: 'box', label: 'Models' },
    { to: '/collections', ico: 'hexagon', label: 'Collections' },
  ] },
  { sec: 'Publish', items: [
    { to: '/feed', ico: 'rss', label: 'Feed' },
    { to: '/review', ico: 'eye', label: 'In review' },
  ] },
  { sec: 'Identity', items: [
    { to: '/profile', ico: 'circle-user', label: 'Profile' },
    { to: '/keyring', ico: 'key-round', label: 'Keyring' },
    { to: '/tee', ico: 'eye-off', label: 'Private' },
  ] },
];

export function Rail() {
  const { ident } = useIdentity();
  const who = IDENTITY_PRIV[ident.funding];
  // Moderation nav appears only for the platform reviewer (server-authoritative me.admin).
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    api.getMe().then((me) => { if (live) setAdmin(!!me.admin); }).catch(() => { /* not admin */ });
    return () => { live = false; };
  }, []);
  return (
    <aside className="rail">
      <div className="brand">
        <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><path className="lit" d="M12,2 A10 10 0 0 0 12,22 Z" /><circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.4" /></svg><b>noema</b>
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
        {admin && (
          <Fragment key="admin">
            <div className="lbl">Admin</div>
            <NavLink to="/admin" end className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
              <span className="ico"><Ic name="layout-grid" /></span> Workspace
            </NavLink>
            <NavLink to="/admin/review" className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
              <span className="ico"><Ic name="eye" /></span> Feed review
            </NavLink>
          </Fragment>
        )}
      </nav>

      {/* pinned bottom — the Account pillar: funding · activity · settings · the identity avatar */}
      <div className="railfoot">
        <NavLink to="/funding" className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="wallet" /></span> Funding
        </NavLink>
        <NavLink to="/status" className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="receipt-text" /></span> Activity
        </NavLink>
        <NavLink to="/account" className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="settings-2" /></span> Settings
        </NavLink>
        <Link to="/profile" className="railavatar" title={`${ident.funding === 'bearer' ? 'anonymous' : ident.name} · identity`}>
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
