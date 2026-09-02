import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type PartnerRequest, type PartnerRequestStatus } from '../lib/api';
import { useSession } from '../state/session';

// AdminPartnerRequests — the platform-admin review queue for the B2B partner intake
// (partnerAdminRouter.ts). Linked from AdminWorkspace.tsx the same way /admin/review is: a
// dedicated sub-screen off the admin hub. `me.admin` gates the UI client-side (cosmetic — the
// server re-asserts platform-admin on every GET/PATCH regardless), same pattern as Review.tsx.
//
// A request with no `animaId` is a fully anonymous submission: approving it only flips its
// status — no Partner record and no API key are provisioned, because there is no email-verified
// signup flow in this codebase to safely attach credentials to (see partnerAdminRouter.ts's
// header). That is called out inline on each such row so nobody mistakes a no-op approval for a
// bug.
//
// The API key an approval mints is shown EXACTLY ONCE, in the PATCH response, and never again —
// this screen keeps it only in local component state (never localStorage, never re-fetched) so
// it cannot outlive a refresh.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TABS: { label: string; value: PartnerRequestStatus | 'all' }[] = [
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Declined', value: 'declined' },
  { label: 'All', value: 'all' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function AdminPartnerRequests() {
  const { session, ready } = useSession();
  const [admin, setAdmin] = useState(false);
  const [tab, setTab] = useState<PartnerRequestStatus | 'all'>('pending');
  const [items, setItems] = useState<PartnerRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!session) { setAdmin(false); return; }
    let live = true;
    api.getMe()
      .then((me) => { if (live) setAdmin(!!me.admin); })
      .catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, [ready, session]);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    setItems(null);
    api.adminListPartnerRequests(tab === 'all' ? undefined : tab)
      .then((r) => { if (live) setItems(r.requests); })
      .catch((e) => { if (live) { setErr(msg(e)); setItems([]); } });
    return () => { live = false; };
  }, [admin, tab]);

  const remove = (id: string) => setItems((cur) => (cur ?? []).filter((r) => r.id !== id));
  const replace = (updated: PartnerRequest) =>
    setItems((cur) => (cur ?? []).map((r) => (r.id === updated.id ? updated : r)));

  return (
    <AppShell title="Partner requests · admin">
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div>
            <h1>Partner requests</h1>
            <div className="sub">The B2B partner-program intake queue. Approve to provision access, decline to close it out.</div>
          </div>
          <Link className="btn-ghost" to="/admin"><Ic name="chevron-left" /> Admin workspace</Link>
        </div>

        {err && <div className="warn">{err}</div>}

        {!ready && <div className="sub">Loading…</div>}

        {ready && !session && (
          <div className="empty">
            <div className="t">Sign in to continue</div>
            <div className="s">This surface is restricted to the platform administrator.</div>
            <Link className="btn" to="/onboard"><Ic name="circle-user" /> Sign in</Link>
          </div>
        )}

        {ready && session && !admin && (
          <div className="empty">
            <div className="t">Not available</div>
            <div className="s">This surface is restricted to the platform administrator.</div>
          </div>
        )}

        {ready && session && admin && (
          <>
            <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
              {TABS.map((t) => (
                <button
                  key={t.value}
                  className={tab === t.value ? 'btn' : 'btn-ghost'}
                  onClick={() => setTab(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {items === null && <div className="sub">Loading the queue…</div>}

            {items !== null && items.length === 0 && (
              <div className="empty">
                <div className="t">Nothing here</div>
                <div className="s">No partner requests in this view.</div>
              </div>
            )}

            {items?.map((r) => (
              <RequestRow key={r.id} request={r} onDecided={replace} onRemove={remove} onError={setErr} />
            ))}
          </>
        )}
      </div></div>
    </AppShell>
  );
}

function RequestRow({ request, onDecided, onError }: {
  request: PartnerRequest;
  onDecided: (updated: PartnerRequest) => void;
  onRemove: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState<null | 'approved' | 'declined'>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function decide(status: 'approved' | 'declined') {
    setBusy(status);
    onError('');
    try {
      const res = await api.adminDecidePartnerRequest(request.id, status);
      onDecided(res.request);
      if (res.apiKey) setApiKey(res.apiKey);
    } catch (e) {
      onError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyKey() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch { /* clipboard unavailable — the key is still selectable text */ }
  }

  const decided = request.status !== 'pending';

  return (
    <div className="byo-row">
      <div className="byo-head">
        <span className="byo-prov">{request.nomen || request.org || request.contactEmail}</span>
        <span className={`byo-state${request.status === 'approved' ? ' connected' : ''}`}>{request.status}</span>
      </div>

      <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
        <div className="meta-line"><span>Contact</span><span className="v">{request.contactEmail}</span></div>
        {request.org && <div className="meta-line"><span>Org</span><span className="v">{request.org}</span></div>}
        <div className="meta-line"><span>Use case</span><span className="v">{request.useCase}</span></div>
        {request.notes && <div className="meta-line"><span>Notes</span><span className="v">{request.notes}</span></div>}
        <div className="meta-line"><span>Submitted</span><span className="v">{fmtDate(request.natum)}</span></div>
        {decided && request.decidedAt && (
          <div className="meta-line"><span>Decided</span><span className="v">{fmtDate(request.decidedAt)}</span></div>
        )}

        {request.animaId ? (
          <div className="sub mono" style={{ fontSize: 'var(--fs-xs)' }}>
            <Ic name="circle-user" /> account attached ({request.animaId})
          </div>
        ) : (
          <div className="sub" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
            no account attached — approval won't provision access (no Partner record, no API key)
          </div>
        )}

        {apiKey && (
          <div className="warn" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div><b>Copy this now — it will never be shown again.</b></div>
            <code className="mono" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{apiKey}</code>
            <button className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={copyKey}>
              {copied ? 'Copied' : 'Copy key'}
            </button>
          </div>
        )}
      </div>

      {!decided && (
        <div className="byo-body byo-connect" style={{ gap: 'var(--s3)' }}>
          <button className="btn" disabled={!!busy} onClick={() => decide('approved')}>
            {busy === 'approved' ? 'Approving…' : 'Approve'}
          </button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => decide('declined')}>
            {busy === 'declined' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      )}
    </div>
  );
}
