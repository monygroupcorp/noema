import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { Ic } from '../lib/icons';
import { api, getSession, commitment, type MeStatus, type StudioEntry } from '../lib/api';

// Account / settings (account-spec.md, renders noema-account.png + noema-account-compute.png).
// The control panel for the privacy machine — posture + sovereignty up front, then a card per
// account concern, each opening a sub-nav detail page. Two corrections baked in:
//  · the account compute default is AVAILABILITY (cost/speed: Economy/Balanced/Fastest); every
//    run executes on our compute (there is no on-device or per-run custody choice).
//  · NOEMA is multi-interface (web · Telegram · API) — the posture names this "reach".

// Preferences is folded in here (UX handoff 2, Decision 2) — it's its own screen, so its sub-nav
// entry links out to /preferences via `to` rather than an /account/:section pane.
const SECTIONS: { key: string; label: string; ico: string; to?: string }[] = [
  { key: 'account', label: 'Account', ico: 'circle-user' },
  { key: 'billing', label: 'Billing & credits', ico: 'wallet' },
  { key: 'compute', label: 'Compute', ico: 'server' },
  { key: 'preferences', label: 'Preferences', ico: 'sparkles', to: '/preferences' },
  { key: 'api', label: 'API keys', ico: 'key-round' },
];

type Availability = 'economy' | 'balanced' | 'fastest';
const AVAIL: { key: Availability; glyph: string; t: string; s: string }[] = [
  { key: 'economy', glyph: '◔', t: 'Economy', s: 'Wait for spot / cheaper GPUs. Lowest credits.' },
  { key: 'balanced', glyph: '◑', t: 'Balanced', s: 'Wait briefly for a cheaper slot, then proceed.' },
  { key: 'fastest', glyph: '●', t: 'Fastest', s: 'Always grab the fastest available. Higher credits.' },
];

export function AccountSettings() {
  const { section } = useParams();
  const { ident } = useIdentity();
  const { goAnonymous } = useSession();
  const navigate = useNavigate();
  const anon = ident.funding === 'bearer';
  // Go anonymous = deactivate to the anon slot, keeping any held logins (real, reversible — switch
  // back anytime). Export is now real (POST /v1/me/export → signed download); Delete is still gated.
  const leaveToAnon = () => { goAnonymous(); navigate('/'); };
  const [me, setMe] = useState<MeStatus | null>(null);

  // GDPR "Export everything" — POST /v1/me/export assembles the caller's OWN data server-side and
  // returns a short-lived signed URL; we surface it as a download link. Auth mirrors the api client:
  // a bearer session when signed in, else the anon commitment header.
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const exportEverything = async () => {
    setExporting(true); setExportErr(null); setExportUrl(null);
    try {
      const s = getSession();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(s ? { authorization: `Bearer ${s}` } : { 'x-commitment': commitment() }),
      };
      const res = await fetch('/v1/me/export', { method: 'POST', headers });
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const body = (await res.json()) as { url: string };
      setExportUrl(body.url);
    } catch {
      setExportErr('Export failed — please try again in a moment.');
    } finally {
      setExporting(false);
    }
  };
  // GDPR "Delete account & data" — DELETE /v1/me (noema-025). Irreversible, so it's fronted by a
  // TYPED-confirmation gate: the user must type the exact phrase before the confirm button arms.
  // Truthful copy: identity/content is deleted, but financial records are RETAINED-ANONYMIZED for
  // legal reasons — we never claim "everything is deleted" (the privacy-truthfulness bar). On
  // success we drop to the anonymous slot and go home (the old session token is now revoked too).
  const DELETE_PHRASE = 'delete my account';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const deleteArmed = deleteText.trim().toLowerCase() === DELETE_PHRASE;
  const deleteAccount = async () => {
    if (!deleteArmed || deleting) return;
    setDeleting(true); setDeleteErr(null);
    try {
      const s = getSession();
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(s ? { authorization: `Bearer ${s}` } : { 'x-commitment': commitment() }),
      };
      const res = await fetch('/v1/me', { method: 'DELETE', headers });
      if (res.status === 404) throw new Error('not-enabled');
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      // Erased — the session token is now revoked server-side; drop to anonymous and leave.
      goAnonymous();
      navigate('/');
    } catch (e) {
      setDeleteErr(
        (e as Error).message === 'not-enabled'
          ? 'Account deletion isn’t enabled on this environment yet.'
          : 'Deletion failed — please try again in a moment.',
      );
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    let live = true;
    api.meStatus().then((s) => { if (live) setMe(s); }).catch(() => {});
    return () => { live = false; };
  }, []);
  // Real balance (impetus credits) + live studio count from the account snapshot.
  const credits = me ? Number(me.balanceImpetus).toLocaleString() : '…';
  const liveStudios = me?.studios.filter((s) => s.status === 'idle' || s.status === 'running').length ?? 0;
  // The availability preference is a real (local) setting — read it, don't invent it.
  const availPref = (localStorage.getItem('noema-availability') as Availability) || 'balanced';

  // ── account home ──────────────────────────────────────────────────────────
  if (!section) {
    return (
      <AppShell title="Settings">
        <div className="page"><div className="pw wide">
          <div className="pagehead"><div>
            <h1>Account</h1>
            <div className="sub">Your account across every interface — web · Telegram · API. Tune what we see; your work stays yours.</div>
          </div></div>

          {/* posture instrument — the dashboard device, reused */}
          <div className="noema-frame ac-posture">
            <div className="ac-pcell">
              <div className="ac-l">identity</div>
              <div className="ac-v"><span className={`hemi2 ${anon ? 'dashed' : 'lit'}`} /> {anon ? 'anonymous' : 'you · signed in'} <Link className="ac-link" to="/account/security">go anonymous ▸</Link></div>
            </div>
            <div className="ac-pcell">
              <div className="ac-l">live · what we can see</div>
              <div className="ac-v">the meter · {liveStudios} live {liveStudios === 1 ? 'session' : 'sessions'}</div>
            </div>
            <div className="ac-pcell">
              <div className="ac-l">reach</div>
              <div className="ac-v">web · Telegram · API</div>
            </div>
          </div>

          {/* sovereignty trio — a right, shown up front. Go anonymous + Export are real; Delete is
              now wired (DELETE /v1/me), gated behind a typed irreversible-confirmation. */}
          <div className="ac-sov">
            <button className="btn ghost" onClick={exportEverything} disabled={exporting} title="Download a complete JSON export of your account data"><Ic name="arrow-up" /> {exporting ? 'Preparing export…' : 'Export everything'}</button>
            <button className="btn ghost amber" onClick={leaveToAnon}><span className="hemi2 dashed" /> Go anonymous</button>
            {anon ? (
              <button className="btn ghost bad" disabled title="Sign in to erase a named account — an anonymous slot holds no identified data to erase"><Ic name="x" /> Delete account &amp; data</button>
            ) : (
              <button className="btn ghost bad" onClick={() => { setDeleteOpen((o) => !o); setDeleteErr(null); setDeleteText(''); }} aria-expanded={deleteOpen} title="Permanently erase your identity & content"><Ic name="x" /> Delete account &amp; data</button>
            )}
          </div>
          {deleteOpen && !anon && (
            <div className="ac-note mono" style={{ marginTop: 'var(--s3)', borderLeft: '2px solid var(--bad, #c0392b)', paddingLeft: 'var(--s3)' }}>
              <div><b>This is permanent and cannot be undone.</b></div>
              <div style={{ marginTop: 'var(--s2)' }}>
                We will erase your identity and content — your profile, credentials, saved preferences,
                projects, conversations and memory. For legal reasons we must <b>retain your financial
                records</b> (deposits, credits and payouts); those are kept in <b>anonymized</b> form,
                no longer linked to your name, and your published work stays live under an anonymous
                author. You’ll be signed out immediately and this account can never sign in again.
              </div>
              <div style={{ marginTop: 'var(--s3)' }}>
                Type <b>{DELETE_PHRASE}</b> to confirm:
                <input
                  className="input mono"
                  style={{ marginTop: 'var(--s2)', width: '100%' }}
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder={DELETE_PHRASE}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Type "${DELETE_PHRASE}" to confirm account deletion`}
                />
              </div>
              <div style={{ marginTop: 'var(--s3)', display: 'flex', gap: 'var(--s2)' }}>
                <button className="btn bad" onClick={deleteAccount} disabled={!deleteArmed || deleting}>
                  {deleting ? 'Erasing…' : 'Permanently delete my account'}
                </button>
                <button className="btn ghost" onClick={() => { setDeleteOpen(false); setDeleteText(''); setDeleteErr(null); }} disabled={deleting}>Cancel</button>
              </div>
              {deleteErr && <div style={{ marginTop: 'var(--s2)' }}><span className="hemi2 dashed" /> {deleteErr}</div>}
            </div>
          )}
          {exportUrl && (
            <div className="ac-note mono" style={{ marginTop: 'var(--s3)' }}>
              <span className="hemi2 lit" /> Your export is ready — <a className="accent" href={exportUrl} target="_blank" rel="noreferrer" download>download it ▸</a> (link expires shortly).
            </div>
          )}
          {exportErr && (
            <div className="ac-note mono" style={{ marginTop: 'var(--s3)' }}>
              <span className="hemi2 dashed" /> {exportErr}
            </div>
          )}
          <div className="ac-note mono" style={{ marginTop: 'var(--s3)' }}>
            <span className="hemi2 dashed" /> Data export &amp; account deletion are your legal rights — both are here. Deletion erases your identity &amp; content; financial records are retained in anonymized form for legal reasons.
          </div>

          {/* section cards — the honesty bar: rows with a real backend (credits via meStatus,
              live studios) show real data; everything not wired yet (card billing, API keys,
              devices, local runner) is gated "soon", same as Export/Delete above. */}
          <div className="ac-cards">
            <SectionCard to="/account/billing" ico="wallet" name="Billing &amp; credits">
              <Row k="credits" v={<span className="gold"><span className="gem">◈</span> {credits}{me ? <> credits · ≈ ${me.balanceUsd.toFixed(2)}</> : ''}</span>} />
              <Row k="plan · card" v={<span className="muted">coming soon — no subscriptions or card billing yet</span>} />
              <div className="ac-note mono"><span className="hemi2 dashed" /> credits fund on-chain today — <Link className="accent" to="/funding">deposit from a wallet ▸</Link></div>
            </SectionCard>
            <SectionCard to="/account/api" ico="key-round" name="API keys">
              <Row k="keys" v={<span className="muted">coming soon</span>} />
              <div className="ac-note mono"><span className="hemi2 dashed" /> the /v1 API is live; personal key management isn’t wired here yet.</div>
            </SectionCard>
            <SectionCard to="/account/compute" ico="server" name="Compute &amp; sessions">
              <Row k="availability" v={<><span className="fillg">{AVAIL.find((a) => a.key === availPref)?.glyph}</span> <b>{availPref}</b> · cost vs speed</>} />
              <Row k="live sessions" v={<><span className="rdot good" /> {liveStudios} live</>} />
              <div className="ac-note mono">every run executes on our compute — we can see the work.</div>
            </SectionCard>
            <SectionCard to="/preferences" ico="sparkles" name="Preferences &amp; defaults">
              <Row k="scope" v={<>portable across web · Telegram · API</>} />
              <Row k="applies to" v={<span className="mono">/make · style · output · delivery</span>} />
              <div className="ac-note mono">generation defaults that travel with you — override inline anytime.</div>
            </SectionCard>
          </div>
        </div></div>
      </AppShell>
    );
  }

  // ── detail page (sub-nav + pane) ──────────────────────────────────────────
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const crumb = <span className="ph-crumb"><Link to="/account">Settings</Link> <span className="sep">/</span> <b>{active.label}</b></span>;
  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="settings-layout">
          <aside className="settings-nav">
            <div className="sn-l">settings</div>
            {SECTIONS.map((s) => (
              <Link key={s.key} to={s.to ?? `/account/${s.key}`} className={`sn-item${s.key === section ? ' on' : ''}`}>
                <Ic name={s.ico} /> {s.label}
              </Link>
            ))}
          </aside>
          <div className="settings-pane">
            {section === 'compute' ? <ComputeDetail studios={me?.studios ?? null} /> : (
              <>
                <h1>{active.label}</h1>
                <div className="sub">This section opens here from the account home’s <b>manage ▸</b>.</div>
                <div className="empty" style={{ marginTop: 'var(--s5)' }}><div className="t">{active.label} detail — building this pane in a later pass.</div></div>
              </>
            )}
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}

const fmtWarm = (ms?: number) => (ms == null ? 'idle' : ms <= 0 ? 'draining' : `~${Math.round(ms / 60000)}m left`);

function ComputeDetail({ studios }: { studios: StudioEntry[] | null }) {
  const [avail, setAvail] = useState<Availability>(() => (localStorage.getItem('noema-availability') as Availability) || 'balanced');
  const set = (a: Availability) => { setAvail(a); localStorage.setItem('noema-availability', a); };
  return (
    <>
      <h1>Compute</h1>
      <div className="sub">Your cost-vs-speed preference, private-tunnel sessions, and your own machine.</div>

      <div className="ac-panel">
        <div className="ac-panel-l">availability · cost vs speed for remote runs</div>
        <div className="avail-grid">
          {AVAIL.map((a) => (
            <button key={a.key} className={`availcard${avail === a.key ? ' on' : ''}`} onClick={() => set(a.key)}>
              <div className="av-t"><span className="fillg">{a.glyph}</span> {a.t}</div>
              <div className="av-s">{a.s}</div>
            </button>
          ))}
        </div>
        <div className="ac-note mono">↳ every run executes on our compute — this sets cost vs speed, not custody.</div>
      </div>

      <div className="ac-panel">
        <div className="ac-panel-l">active sessions · your studios <Link to="/studio" className="accent" style={{ float: 'right', fontWeight: 400 }}>open studio ▸</Link></div>
        {studios === null ? (
          <div className="ac-note mono">loading your sessions…</div>
        ) : studios.length === 0 ? (
          <div className="ac-note mono">no live studios — <Link to="/studio" className="accent">lease one</Link> to warm a GPU.</div>
        ) : (
          studios.map((s) => (
            <SessionRow key={s.studioId} name={s.label} detail={`${s.status} · ${s.guestsToday} guest gens · net ≈ $${s.netUsd.toFixed(2)}`} state={fmtWarm(s.warmRemainingMs)} />
          ))
        )}
      </div>

    </>
  );
}

function SessionRow({ name, detail, state }: { name: string; detail: string; state: string }) {
  return (
    <div className="ac-session">
      <span className="hemi2 ring" />
      <div className="ac-sess-main"><b>{name}</b><span className="mono">{detail}</span></div>
      <span className="ac-sess-state"><span className="rdot good" /> {state}</span>
      <button className="btn ghost danger sm">■ stop</button>
    </div>
  );
}

function SectionCard({ to, ico, name, children }: { to: string; ico: string; name: string; children: React.ReactNode }) {
  return (
    <div className="ac-card">
      <div className="ac-card-h"><span className="ac-card-ico"><Ic name={ico} /></span><b dangerouslySetInnerHTML={{ __html: name }} /><Link className="ac-manage" to={to}>manage ▸</Link></div>
      <div className="ac-card-body">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="ac-row"><span className="ac-rk mono">{k}</span><span className="ac-rv">{v}</span></div>;
}
