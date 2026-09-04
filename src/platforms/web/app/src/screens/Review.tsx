import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';
import { useSession } from '../state/session';
import type { Editio, EditionPreviewItem } from '../lib/editio';
import { mediaFromOutput, textFromOutput } from '../lib/media';

// Feed-review — the moderation held-queue (publishing spec §4). The moderation gate HOLDS
// public-surface publications it can't auto-clear; a human adjudicates here.
//
// TWO audiences, ONE endpoint (GET /v1/editiones/review): an AUTHOR sees only their own held
// items (transparency: "your publish is under review", read-only); the PLATFORM ADMIN sees
// EVERY held item and gets the adjudication controls. `me.admin` (server-authoritative) decides
// which. approve/reject/confirm-csam are admin-only server-side too — the UI just mirrors that.
//
// SAFETY: held content is not auto-loaded. A reviewer clicks "Reveal" to fetch+show it, so
// potentially-unlawful imagery is never rendered without an explicit, deliberate action.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Shared "Yours, in review" section — the non-admin reveal-gated row rendering, reused by the
// Feed page (noema-075: /review collapsed into Feed as a conditional section shown only when
// the caller has pending publications). Admin-only approve/reject/confirm-CSAM controls are NOT
// part of this piece; they stay exclusive to ReviewRow's admin branch below, unchanged on
// /admin/review.
export function ReviewQueueSection({ editions, onError }: { editions: Editio[]; onError: (e: string) => void }) {
  const [items, setItems] = useState(editions);
  const remove = (id: string) => setItems((cur) => cur.filter((e) => e.id !== id));
  if (items.length === 0) return null;
  return (
    <div className="page-section">
      <div className="sectionhead">yours, in review</div>
      {items.map((e) => (
        <ReviewRow key={e.id} editio={e} admin={false} onDone={() => remove(e.id)} onError={onError} />
      ))}
    </div>
  );
}

export function Review() {
  const { session, ready } = useSession();
  const [admin, setAdmin] = useState(false);
  const [items, setItems] = useState<Editio[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!session) { setItems([]); return; }
    let live = true;
    Promise.all([api.getMe().catch(() => null), api.listReviewQueue()])
      .then(([me, q]) => { if (!live) return; setAdmin(!!me?.admin); setItems(q.editions); })
      .catch((e) => { if (live) { setErr(msg(e)); setItems([]); } });
    return () => { live = false; };
  }, [ready, session]);

  // Drop an item from the local list once it's adjudicated (it leaves the pending queue).
  const remove = (id: string) => setItems((cur) => (cur ?? []).filter((e) => e.id !== id));

  const pending = (items ?? []).filter((e) => e.reviewOutcome === 'pending');

  return (
    <AppShell title={admin ? 'Feed review · moderation' : 'Your publications in review'}>
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div>
            <h1>{admin ? 'Feed review' : 'In review'}</h1>
            <div className="sub">
              {admin
                ? 'Publications the moderation gate held. Approve to let them go live, reject to decline, or confirm-as-CSAM to reject and file the mandated report.'
                : 'These publications are held pending a moderator’s review. They appear in the public feed once approved.'}
            </div>
          </div>
          <Link className="btn-ghost" to="/feed"><Ic name="rss" /> Public feed</Link>
        </div>

        {err && <div className="warn">{err}</div>}

        {!ready && <div className="sub">Loading…</div>}

        {ready && !session && (
          <div className="empty">
            <div className="t">Sign in to see your review status</div>
            <div className="s">Held publications are shown to their author and to moderators.</div>
            <Link className="btn" to="/onboard"><Ic name="circle-user" /> Sign in</Link>
          </div>
        )}

        {ready && session && items === null && !err && <div className="sub">Loading the queue…</div>}

        {ready && session && items !== null && pending.length === 0 && (
          <div className="empty">
            <div className="t">Nothing awaiting review</div>
            <div className="s">{admin ? 'The moderation queue is clear.' : 'None of your publications are being held.'}</div>
          </div>
        )}

        {pending.map((e) => (
          <ReviewRow key={e.id} editio={e} admin={admin} onDone={() => remove(e.id)} onError={setErr} />
        ))}
      </div></div>
    </AppShell>
  );
}

function ReviewRow({ editio, admin, onDone, onError }: {
  editio: Editio; admin: boolean; onDone: () => void; onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'csam'>(null);
  const [confirmCsam, setConfirmCsam] = useState(false);
  const [preview, setPreview] = useState<
    { url: string; kind: string } | { text: string } | { gallery: EditionPreviewItem[] } | 'none' | null
  >(null);
  const [revealing, setRevealing] = useState(false);

  // Reveal the held content on demand. An `actum` (a generation run) resolves via the run
  // endpoint, same as always. Any OTHER kind — an `intella` model promotion is the case
  // MODERATION_MANUAL_REVIEW routes through here routinely, and this stays kind-agnostic so
  // a future `collectio` hold needs no new branch — goes through the admin-only preview
  // route, which resolves the SAME media the moderation gate itself scanned to make its hold
  // decision (up to 8 sample images for a model, so a multi-image gallery, not a single url).
  // A scope/permission miss or empty result falls back to "no inline preview" so the reviewer
  // can still act on the metadata + external handle.
  async function reveal() {
    if (revealing || preview) return;
    setRevealing(true);
    try {
      if (editio.artifact.kind === 'actum') {
        const { run } = await api.getRun(editio.artifact.id);
        const media = mediaFromOutput(run.exitus);
        if (media) { setPreview(media); return; }
        const text = textFromOutput(run.exitus);
        if (text) { setPreview({ text }); return; }
      } else {
        const p = await api.getEditionPreview(editio.id);
        const gallery = p.items?.length ? p.items : p.mediaUrls.map((url) => ({ url }));
        if (gallery.length > 0) { setPreview({ gallery }); return; }
      }
      setPreview('none');
    } catch { setPreview('none'); }
    finally { setRevealing(false); }
  }

  async function act(verb: 'approve' | 'reject' | 'csam') {
    setBusy(verb); onError('');
    try {
      if (verb === 'approve') await api.approveEdition(editio.id);
      else if (verb === 'reject') await api.rejectEdition(editio.id);
      else await api.confirmCsam(editio.id);
      onDone();
    } catch (e) { onError(msg(e)); setBusy(null); setConfirmCsam(false); }
  }

  return (
    <div className="byo-row">
      <div className="byo-head">
        <span className="byo-prov">{editio.destination} · {editio.visibility}</span>
        <span className="byo-state connected">held {ago(editio.createdAt)}</span>
      </div>

      <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s3)' }}>
        <div className="sub mono" style={{ fontSize: 'var(--fs-xs)' }}>
          {editio.artifact.kind}:{editio.artifact.id}
          {editio.owners && editio.owners.length > 0 && <> · {editio.owners.length} owner{editio.owners.length === 1 ? '' : 's'}</>}
          {editio.license && <> · {editio.license}</>}
        </div>

        {/* Content preview — off by default; revealed on click. */}
        {preview === null ? (
          <button className="btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={revealing} onClick={reveal}>
            <Ic name="eye" /> {revealing ? 'Loading…' : 'Reveal content to review'}
          </button>
        ) : preview === 'none' ? (
          <div className="sub">No inline preview available. {editio.externalRef && <>Handle: <code className="mono">{editio.externalRef}</code></>}</div>
        ) : 'text' in preview ? (
          <div className="sidecard"><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{preview.text}</p></div>
        ) : 'gallery' in preview ? (
          // A model hold can carry up to 8 sample images — a scrollable thumbnail row rather
          // than the single-image shape below. Kept plain; this exists so a reviewer sees
          // SOMETHING instead of nothing, not to be polished.
          <div style={{ display: 'flex', gap: 'var(--s2)', overflowX: 'auto', maxWidth: 480, paddingBottom: 'var(--s2)' }}>
            {preview.gallery.map((item, i) => (
              <img
                key={item.url + i}
                src={item.url}
                alt={item.prompt ?? ''}
                title={item.prompt}
                style={{ height: 120, width: 120, objectFit: 'cover', borderRadius: 'var(--r2)', flex: '0 0 auto' }}
              />
            ))}
          </div>
        ) : (
          <div style={{ maxWidth: 360 }}>
            {preview.kind === 'image' && <img src={preview.url} alt="" style={{ maxWidth: '100%', borderRadius: 'var(--r2)' }} />}
            {preview.kind === 'video' && <video src={preview.url} controls muted playsInline style={{ maxWidth: '100%', borderRadius: 'var(--r2)' }} />}
            {preview.kind === 'audio' && <audio src={preview.url} controls />}
            {preview.kind === '3d' && <div className="sub"><Ic name="box" /> 3D model — <a href={preview.url} target="_blank" rel="noreferrer">open</a></div>}
          </div>
        )}
      </div>

      {admin ? (
        <div className="byo-body byo-connect" style={{ gap: 'var(--s3)' }}>
          <button className="btn" disabled={!!busy} onClick={() => act('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
          <button className="btn-ghost" disabled={!!busy} onClick={() => act('reject')}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</button>
          {confirmCsam ? (
            <button className="btn" style={{ background: 'var(--danger, #b23)', color: '#fff' }} disabled={!!busy} onClick={() => act('csam')}>
              {busy === 'csam' ? 'Filing…' : 'Confirm & file NCMEC report'}
            </button>
          ) : (
            <button className="btn-ghost" disabled={!!busy} onClick={() => setConfirmCsam(true)} title="Reject and file the mandated NCMEC CyberTipline report">Confirm CSAM…</button>
          )}
        </div>
      ) : (
        <div className="sub">Awaiting a moderator’s decision.</div>
      )}
    </div>
  );
}
