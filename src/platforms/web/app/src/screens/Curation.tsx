import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Collection, type CollectionPiece } from '../lib/api';
import { mediaFromOutput } from '../lib/media';
import { collTile } from '../lib/collections';

// Curation — approve the supply. Every piece is the human's call (approve counts it toward the
// collection; reject rerolls a fresh one). Private & reversible — nothing leaves until export.

export function Curation() {
  const { id } = useParams();
  const [col, setCol] = useState<Collection | null>(null);
  const [queue, setQueue] = useState<CollectionPiece[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [kept, setKept] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    Promise.all([api.getCollection(id).catch(() => null), api.listCollectionPieces(id, 'all')])
      .then(([c, p]) => {
        if (!live) return;
        if (c) setCol(c.collection);
        // 'none' = review not enabled for this piece (auto-approved) — excluded from the
        // reviewable queue so an auto-approve collection still shows the empty state below.
        const reviewable = p.pieces.filter((piece) => piece.review !== 'none');
        setQueue(reviewable);
        const resumeAt = reviewable.findIndex((piece) => piece.review === 'pending');
        setIdx(resumeAt === -1 ? reviewable.length : resumeAt);
        setKept(reviewable.filter((piece) => piece.review === 'approved').length);
        setRejected(reviewable.filter((piece) => piece.review === 'rejected').length);
      })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  const current = queue?.[idx];

  const decide = useCallback(async (keep: boolean) => {
    if (!id || !current || busy) return;
    setBusy(true); setErr(null);
    try {
      await (keep ? api.approvePiece(id, current.actumId) : api.rejectPiece(id, current.actumId));
      keep ? setKept((n) => n + 1) : setRejected((n) => n + 1);
      setIdx((i) => i + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [id, current, busy]);

  // K = keep, R = reject.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'k' || e.key === 'K') decide(true);
      if (e.key === 'r' || e.key === 'R') decide(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide]);

  const name = col?.nomen || 'collection';
  const crumb = <span className="ph-crumb"><Link to={`/collections/${id}`}>{name}</Link> <span className="sep">/</span> <b>curation</b></span>;
  const reviewed = kept + rejected;
  const totalQ = queue ? queue.length : 0;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Curate the supply</h1><div className="sub mono">approve counts a piece · reject rerolls a fresh one</div></div>
          <div className="right"><span className="badge">private · not minted</span></div>
        </div>

        {err && <div className="warn">{err}</div>}

        {queue === null && !err && <div className="empty"><div className="t">Loading review queue…</div></div>}

        {queue !== null && totalQ === 0 && (
          <div className="empty">
            <div className="t">Nothing awaiting review</div>
            <div className="s">This collection auto-approves pieces (review isn’t enabled), or you’ve reviewed them all.</div>
            <Link className="btn accent" to={`/collections/${id}/export`}>Go to export →</Link>
          </div>
        )}

        {queue !== null && totalQ > 0 && (
          <>
            <div className="cu-prog">
              <span className="mono"><b>{reviewed}</b> / {totalQ} reviewed</span>
              <div className="cj-bar"><span style={{ width: `${(reviewed / totalQ) * 100}%` }} /></div>
              <span className="mono"><span className="good">{kept} kept</span> · <span className="bad">{rejected} rerolled</span></span>
            </div>

            {current ? (
              <div className="cu-main">
                <div className="cu-piece">
                  {(() => { const m = mediaFromOutput(current.output);
                    return m?.kind === 'image'
                      ? <img className="cu-img" src={m.url} alt="" />
                      : <span className="cu-img" style={{ background: collTile(current.actumId) }} />; })()}
                  <div className="cu-meta mono">{current.actumId.slice(0, 12)}…</div>
                </div>
                <div className="cu-side">
                  <div className="cu-traits">
                    {(current.attributes ?? []).map((t) => (
                      <div key={t.trait_type} className="cu-trow"><span className="cu-axis">{t.trait_type}</span><span className="cu-tv"><b>{t.value}</b></span></div>
                    ))}
                    {(!current.attributes || current.attributes.length === 0) && <div className="cu-trow mono" style={{ color: 'var(--faint)' }}>no stamped attributes</div>}
                  </div>
                  <div className="cu-actions">
                    <button className="cu-keep" disabled={busy} onClick={() => decide(true)}>✓ Keep <span className="kbd">K</span></button>
                    <button className="cu-reject" disabled={busy} onClick={() => decide(false)}>✕ Reject <span className="kbd">R</span></button>
                  </div>
                  <div className="cu-nav mono">{idx + 1} of {totalQ} in the queue</div>
                </div>
              </div>
            ) : (
              <div className="empty">
                <div className="t">Queue cleared ✓</div>
                <div className="s">{kept} kept, {rejected} rerolled. Rerolled pieces regenerate and return here.</div>
                <Link className="btn accent" to={`/collections/${id}/export`}>Go to export →</Link>
              </div>
            )}
          </>
        )}

        <div className="cu-foot">
          <span className="mono"><span className="hemi2 dashed" /> Progress is saved · nothing is published until you export</span>
          <div className="right" style={{ display: 'flex', gap: 'var(--s3)' }}>
            <Link className="btn ghost" to={`/collections/${id}/run`}>← run</Link>
            <Link className="btn accent" to={`/collections/${id}/export`}>Export →</Link>
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
