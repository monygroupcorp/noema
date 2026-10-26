import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { Ic } from '../lib/icons';
import { api, getSession, commitment, type MeStatus } from '../lib/api';
import { SECTIONS, AVAIL, resolveSection, readAvailability, SectionPane } from './accountSections';

// Account / settings (account-spec.md, renders noema-account.png + noema-account-compute.png).
// The control panel for the privacy machine — posture + sovereignty up front, then a card per
// account concern, each opening the screen or pane that owns it, and the destructive control
// last (REF-34). Two corrections baked in:
//  · the account compute default is AVAILABILITY (cost/speed: Economy/Balanced/Fastest); every
//    run executes on our compute (there is no on-device or per-run custody choice).
//  · NOEMA is multi-interface (web · Telegram · API) — the posture names this "reach".
//
// The section list, the sub-nav and the /account/:section router all read `accountSections`.

// What the posture instrument says beside "the meter". A count of nothing is not printed
// (DESIGN.md D-58): with no studio warm, the line says so in words.
export function liveLine(liveStudios: number): string {
  if (liveStudios === 0) return 'the meter · nothing running';
  return `the meter · ${liveStudios} live ${liveStudios === 1 ? 'session' : 'sessions'}`;
}

export function AccountSettings() {
  const { section } = useParams();
  const { ident, idents } = useIdentity();
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
  const availPref = readAvailability();
  // Saved logins this browser holds, besides the anonymous slot.
  const savedLogins = idents.filter((d) => d.funding !== 'bearer').length;

  const route = resolveSection(section);
  if (route.kind === 'redirect') return <Navigate to={route.to} replace />;

  // ── account home ──────────────────────────────────────────────────────────
  if (route.kind === 'home') {
    return (
      <AppShell title="Settings">
        <div className="page"><div className="pw wide">
          <div className="pagehead"><div>
            <h1>Account</h1>
            <div className="sub">Your account across every interface — web · Telegram · API. Tune what we see; your work stays yours.</div>
          </div></div>

          {/* posture instrument — the dashboard device, reused. Status only: the one control that
              changes identity is the "Go anonymous" button below (P-1d), shown while there is an
              account to step off — pressed from the anonymous slot it would do nothing. */}
          <div className="noema-frame ac-posture">
            <div className="ac-pcell">
              <div className="ac-l">Identity</div>
              <div className="ac-v"><span className={`hemi2 ${anon ? 'dashed' : 'lit'}`} /> {anon ? 'anonymous' : 'you · signed in'}</div>
            </div>
            <div className="ac-pcell">
              <div className="ac-l">Live · what we can see</div>
              <div className="ac-v">{liveLine(liveStudios)}</div>
            </div>
            <div className="ac-pcell">
              <div className="ac-l">Reach</div>
              <div className="ac-v">web · Telegram · API</div>
            </div>
          </div>

          {/* sovereignty — a right, shown up front. Go anonymous + Export are real. Delete is
              real too, but destructive, so it sits last on the page (REF-34). */}
          <div className="ac-sov">
            <button className="btn ghost" onClick={exportEverything} disabled={exporting} title="Download a complete JSON export of your account data"><Ic name="arrow-up" /> {exporting ? 'Preparing export…' : 'Export everything'}</button>
            {!anon && <button className="btn ghost amber" onClick={leaveToAnon}><span className="hemi2 dashed" /> Go anonymous</button>}
          </div>
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

          {/* section cards — the honesty bar: rows with a real backend (credits via meStatus,
              live studios, saved logins) show real data. Each card's manage link goes where the
              section's nav entry goes (accountSections). There is no plan row: credits are bought
              as packs and nothing is billed on a schedule, so a row would only read "none" (P-1c);
              the card's note names both ways to add credits instead. */}
          <div className="ac-cards">
            <SectionCard to="/funding" ico="wallet" name="Billing &amp; credits">
              <Row k="Credits" v={<span className="gold"><span className="gem">◈</span> {credits}{me ? <> credits · ≈ ${me.balanceUsd.toFixed(2)}</> : ''}</span>} />
              <div className="ac-note mono"><span className="hemi2 dashed" /> buy a pack by card or deposit from a wallet — <Link className="accent" to="/funding">add credits ▸</Link></div>
            </SectionCard>
            <SectionCard to="/account/compute" ico="server" name="Compute &amp; sessions">
              <Row k="Availability" v={<><span className="fillg">{AVAIL.find((a) => a.key === availPref)?.glyph}</span> <b>{availPref}</b> · cost vs speed</>} />
              {/* The credits row above is the one balance this page prints, zero or not — it is
                  the figure "add credits" acts on (P-1c). A live-session count of nothing is not
                  printed; the row offers what fills it instead (D-58, D-60). */}
              <Row k="Live sessions" v={liveStudios ? <><span className="rdot good" /> {liveStudios} live</> : <Link className="accent" to="/catalog">none yet — run something ▸</Link>} />
              <div className="ac-note mono">every run executes on our compute — we can see the work.</div>
            </SectionCard>
            <SectionCard to="/preferences" ico="sparkles" name="Preferences &amp; defaults">
              <Row k="Scope" v={<>portable across web · Telegram · API</>} />
              <Row k="Applies to" v={<span className="mono">/make · style · output · delivery</span>} />
              <div className="ac-note mono">generation defaults that travel with you — override inline anytime.</div>
            </SectionCard>
            <SectionCard to="/keyring" ico="key-round" name="Keyring">
              <Row k="active" v={anon ? 'anonymous' : ident.name} />
              <Row k="saved logins" v={savedLogins ? <>{savedLogins} in this browser</> : <Link className="accent" to="/onboard?add=1">none yet — add one ▸</Link>} />
              <div className="ac-note mono">switch between saved logins or add one — each keeps its own projects, history and settings.</div>
            </SectionCard>
          </div>

          {/* the destructive section — last on the page, after everything the user came to do
              (REF-34). Delete is wired (DELETE /v1/me), gated behind a typed confirmation. */}
          <div className="ac-danger">
            <div className="ac-note mono">
              <span className="hemi2 dashed" /> Data export &amp; account deletion are your legal rights — both are here. Deletion erases your identity &amp; content; financial records are retained in anonymized form for legal reasons.
            </div>
            <div className="ac-sov">
              {anon ? (
                <button className="btn ghost bad" disabled title="Sign in to erase a named account — an anonymous slot holds no identified data to erase"><Ic name="x" /> Delete account &amp; data</button>
              ) : (
                <button className="btn ghost bad" onClick={() => { setDeleteOpen((o) => !o); setDeleteErr(null); setDeleteText(''); }} aria-expanded={deleteOpen} title="Permanently erase your identity & content"><Ic name="x" /> Delete account &amp; data</button>
              )}
            </div>
            {deleteOpen && !anon && (
              <div className="ac-panel ac-danger-confirm mono">
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
          </div>
        </div></div>
      </AppShell>
    );
  }

  // ── detail page (sub-nav + pane) ──────────────────────────────────────────
  const active = route.section;
  const crumb = <span className="ph-crumb"><Link to="/account">Settings</Link> <span className="sep">/</span> <b>{active.label}</b></span>;
  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="settings-layout">
          <aside className="settings-nav" aria-label="Settings sections">
            <div className="sn-l">settings</div>
            {SECTIONS.map((s) => {
              const current = s.key === active.key;
              return (
                <Link key={s.key} to={s.to ?? `/account/${s.key}`} className={`sn-item${current ? ' on' : ''}`} aria-current={current ? 'page' : undefined}>
                  <Ic name={s.ico} /> {s.label}
                </Link>
              );
            })}
          </aside>
          <div className="settings-pane">
            <SectionPane section={active} studios={me?.studios ?? null} initialAvailability={availPref} />
          </div>
        </div>
      </div></div>
    </AppShell>
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
