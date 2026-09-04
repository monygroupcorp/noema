import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { api, getActivitySnapshot, subscribeActivity } from '../lib/api';
import { activityBadgeCount } from '../lib/muse';
import { useIdentity } from '../state/identity';
import { IDENTITY_PRIV } from '../lib/idents';
import { Chip } from './Chip';
import { guardedClick } from '../lib/dirtyGuard';

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
  ] },
  { sec: 'Identity', items: [
    { to: '/profile', ico: 'circle-user', label: 'Profile' },
    { to: '/keyring', ico: 'key-round', label: 'Keyring' },
  ] },
];

// Mobile (<=760px) bottom bar: 7 tiles, distinct from NAV above. Desktop reads NAV unchanged.
type MobileTile =
  | { to: string; ico: string; label: string }
  | { group: string; ico: string; label: string; items: NavLeaf[] };

const MOBILE_PROJECTS: NavLeaf[] = [
  { to: '/datasets', ico: 'database', label: 'Datasets' },
  { to: '/models', ico: 'box', label: 'Models' },
  { to: '/collections', ico: 'hexagon', label: 'Collections' },
];
const MOBILE_PROFILE: NavLeaf[] = [
  { to: '/profile', ico: 'circle-user', label: 'Profile' },
  { to: '/keyring', ico: 'key-round', label: 'Keyring' },
];
const MOBILE_FEED_ADMIN: NavLeaf[] = [
  { to: '/feed', ico: 'rss', label: 'Feed' },
  { to: '/admin', ico: 'layout-grid', label: 'Workspace' },
  { to: '/admin/review', ico: 'eye', label: 'Feed review' },
];

const MOBILE_TILES_BASE: MobileTile[] = [
  { to: '/app', ico: 'home', label: 'Home' },
  { to: '/chat', ico: 'message-square', label: 'Chat' },
  { to: '/catalog', ico: 'layout-grid', label: 'Catalogue' },
  { to: '/space', ico: 'footprints', label: 'Space' },
  { group: 'projects', ico: 'folder', label: 'Projects', items: MOBILE_PROJECTS },
];

export function Rail() {
  const { ident } = useIdentity();
  const who = IDENTITY_PRIV[ident.funding];
  const location = useLocation();
  // Same poll Status reads for its running/finished bands — one fetch, two consumers.
  const { rows: activity } = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getActivitySnapshot);
  const activityCount = activityBadgeCount(activity);
  // Moderation nav appears only for the platform reviewer (server-authoritative me.admin).
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    api.getMe().then((me) => { if (live) setAdmin(!!me.admin); }).catch(() => { /* not admin */ });
    return () => { live = false; };
  }, []);

  // Partner nav appears only for an approved B2B partner — same shape as `admin` above, gated on
  // the same authority the /partner screen itself uses (GET /v1/me/partner 404s for everyone
  // else). This link is the ONLY way a partner finds their dashboard: approval happens in an
  // admin queue they can't see, and this codebase sends no mail, so without it an approved
  // partner has no way to learn they were approved or to issue their API key.
  const [partner, setPartner] = useState(false);
  useEffect(() => {
    let live = true;
    api.mePartner().then(() => { if (live) setPartner(true); }).catch(() => { /* not a partner */ });
    return () => { live = false; };
  }, []);

  // Mobile group dropup state — closes on any navigation (including back/forward).
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => { setOpenGroup(null); }, [location.pathname]);

  // noema-069: the open dropup is portaled to document.body (out of .rail's stacking context, so it
  // paints above .concierge). It's no longer a positioned descendant of its triggering tile, so we
  // track the tile's ref and recompute its viewport rect to anchor the portaled pop — mirrors what
  // the old `position:absolute` (relative to the tile's group) did automatically via layout.
  const groupBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!openGroup) { setAnchor(null); return; }
    const measure = () => {
      const btn = groupBtnRefs.current[openGroup];
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setAnchor({ left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 10 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [openGroup]);

  const mobileTiles: MobileTile[] = [
    ...MOBILE_TILES_BASE,
    admin
      ? { group: 'feed', ico: 'rss', label: 'Feed', items: MOBILE_FEED_ADMIN }
      : { to: '/feed', ico: 'rss', label: 'Feed' },
    { group: 'profile', ico: 'circle-user', label: 'Profile', items: MOBILE_PROFILE },
  ];

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
              <NavLink key={it.to} to={it.to} end onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
                <span className="ico"><Ic name={it.ico} /></span> {it.label}
              </NavLink>
            ))}
          </Fragment>
        ))}
        {admin && (
          <Fragment key="admin">
            <div className="lbl">Admin</div>
            <NavLink to="/admin" end onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
              <span className="ico"><Ic name="layout-grid" /></span> Workspace
            </NavLink>
            <NavLink to="/admin/review" onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
              <span className="ico"><Ic name="eye" /></span> Feed review
            </NavLink>
          </Fragment>
        )}
      </nav>

      {/* Mobile-only (<=760px) grouped bottom bar — 7 tiles; CSS does the breakpoint swap with .nav above. */}
      <nav className="mobilenav">
        {mobileTiles.map((t) => 'to' in t ? (
          <NavLink key={t.to} to={t.to} end onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
            <span className="ico"><Ic name={t.ico} /></span> {t.label}
          </NavLink>
        ) : (
          <div className="railgroup" key={t.group}>
            <button
              type="button"
              ref={(el) => { groupBtnRefs.current[t.group] = el; }}
              className={`railgroup-btn navitem${t.items.some((it) => location.pathname === it.to || location.pathname.startsWith(it.to + '/')) ? ' active' : ''}`}
              aria-expanded={openGroup === t.group}
              onClick={() => setOpenGroup((g) => (g === t.group ? null : t.group))}
            >
              <span className="ico"><Ic name={t.ico} /></span> {t.label}
            </button>
            {openGroup === t.group && anchor && createPortal(
              <>
                <div className="railgroup-backdrop" onClick={() => setOpenGroup(null)} />
                <div className="railgroup-pop" style={{ left: anchor.left, bottom: anchor.bottom }}>
                  {t.items.map((it) => (
                    <NavLink key={it.to} to={it.to} end onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
                      <span className="ico"><Ic name={it.ico} /></span> {it.label}
                    </NavLink>
                  ))}
                </div>
              </>,
              document.body,
            )}
          </div>
        ))}
      </nav>

      {/* pinned bottom — the Account pillar: funding · activity · settings · the identity avatar */}
      <div className="railfoot">
        <NavLink to="/funding" onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="wallet" /></span> Funding
        </NavLink>
        <NavLink to="/status" onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="receipt-text" /></span> Activity
          {activityCount > 0 && <span className="badge accent" style={{ marginLeft: 'auto' }}>{activityCount}</span>}
        </NavLink>
        {partner && (
          <NavLink to="/partner" onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
            <span className="ico"><Ic name="key-round" /></span> Partner
          </NavLink>
        )}
        <NavLink to="/account" onClick={guardedClick} className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}>
          <span className="ico"><Ic name="settings-2" /></span> Settings
        </NavLink>
        <Link to="/profile" onClick={guardedClick} className="railavatar" title={`${ident.funding === 'bearer' ? 'anonymous' : ident.name} · identity`}>
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
