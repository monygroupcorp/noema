import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';
import { useSession } from '../state/session';
import type { Editio, FeedItem } from '../lib/editio';
import { mediaFromOutput, textFromOutput } from '../lib/media';
import { ReviewQueueSection } from './Review';
import './feed.css';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Relative "3m ago" without pulling a date library.
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// The feed is anonymous by design — the API never attaches a publisher identity to a public
// post. So the byline is intentional-anon, not a placeholder: a masked glyph + "anonymous".
function Byline() {
  return <span className="ft-by" title="Published anonymously"><Ic name="venetian-mask" /> anonymous</span>;
}

function Media({ item }: { item: FeedItem }) {
  const media = mediaFromOutput(item.output);
  const text = textFromOutput(item.output);
  return (
    <>
      {media?.kind === 'image' && <img src={media.url} alt="" loading="lazy" />}
      {media?.kind === 'video' && <video src={media.url} muted loop playsInline preload="metadata" />}
      {media?.kind === 'audio' && (
        <div className="ft-fallback"><Ic name="sparkles" /><audio src={media.url} controls /></div>
      )}
      {media?.kind === '3d' && <div className="ft-fallback"><Ic name="box" /><span>3D model</span></div>}
      {!media && (
        <div className="ft-fallback ft-text">{text ? <p>{text}</p> : <Ic name="image" />}</div>
      )}
    </>
  );
}

function Tile({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  return (
    <button type="button" className="feed-tile tap" onClick={onOpen}>
      <div className="ft-media"><Media item={item} /></div>
      <div className="ft-foot">
        <Byline />
        <span className="ft-when">{ago(item.createdAt)}</span>
      </div>
    </button>
  );
}

// Enlarged view + permalink. The permalink is this feed page with `?item=<id>`, which
// re-opens the lightbox on load, so a tile is shareable without a dedicated route.
function Lightbox({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyLink() {
    const url = `${window.location.origin}/feed?item=${encodeURIComponent(item.editionId)}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked — the URL is already in the address bar */ }
  }

  return (
    <div className="fx-back" onClick={onClose}>
      <button className="fx-close" onClick={onClose} aria-label="Close"><Ic name="x" /></button>
      <div className="fx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx-media"><Media item={item} /></div>
        <div className="fx-foot">
          <span className="fx-meta"><Byline /> · {ago(item.createdAt)}</span>
          <button className="btn ghost" onClick={copyLink}>
            <Ic name="rss" /> {copied ? 'Link copied ✓' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Feed() {
  const { session, ready } = useSession();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Editio[]>([]);
  const [pendingErr, setPendingErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const activeId = params.get('item');

  useEffect(() => {
    let live = true;
    api.feed({ visibility: 'feed', limit: 60 })
      .then((r) => { if (live) setItems(r.feed); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  // "Yours, in review" — a caller's own held publications, surfaced above the public grid only
  // when there's something pending. Invisible for anonymous visitors and callers with none held.
  useEffect(() => {
    if (!ready || !session) return;
    let live = true;
    Promise.all([api.getMe().catch(() => null), api.listReviewQueue()])
      .then(([, q]) => { if (live) setPending(q.editions.filter((e) => e.reviewOutcome === 'pending')); })
      .catch((e) => { if (live) setPendingErr(msg(e)); });
    return () => { live = false; };
  }, [ready, session]);

  const open = (id: string) => setParams((p) => { p.set('item', id); return p; }, { replace: false });
  const close = () => setParams((p) => { p.delete('item'); return p; }, { replace: false });
  const active = activeId ? items?.find((it) => it.editionId === activeId) : undefined;

  return (
    <AppShell title="Feed">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <h1>Feed</h1>
            <div className="sub">What people are making and choosing to share. Publish your own from any result.</div>
          </div>
          <Link className="btn" to="/card"><Ic name="plus" /> Make something</Link>
        </div>

        {pendingErr && <div className="warn">{pendingErr}</div>}
        {pending.length > 0 && <ReviewQueueSection editions={pending} onError={setPendingErr} />}

        {err && <div className="warn">Couldn’t load the feed: {err}</div>}

        {items === null && !err && (
          <div className="feed-grid">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="feed-tile skel" />)}
          </div>
        )}

        {items !== null && items.length === 0 && (
          <div className="empty">
            <div className="t">Nothing published yet</div>
            <div className="s">Be the first — make something and hit “Publish to feed” on the result.</div>
            <Link className="btn" to="/card"><Ic name="plus" /> Make something</Link>
          </div>
        )}

        {items !== null && items.length > 0 && (
          <div className="feed-grid">
            {items.map((it) => <Tile key={it.editionId} item={it} onOpen={() => open(it.editionId)} />)}
          </div>
        )}
      </div></div>

      {active && <Lightbox item={active} onClose={close} />}
    </AppShell>
  );
}
