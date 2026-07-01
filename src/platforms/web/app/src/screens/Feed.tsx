import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';
import type { FeedItem } from '../lib/editio';
import { mediaFromOutput, textFromOutput } from '../lib/media';
import './feed.css';

// Relative "3m ago" without pulling a date library.
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Tile({ item }: { item: FeedItem }) {
  const media = mediaFromOutput(item.output);
  const text = textFromOutput(item.output);
  return (
    <figure className="feed-tile">
      <div className="ft-media">
        {media?.kind === 'image' && <img src={media.url} alt="" loading="lazy" />}
        {media?.kind === 'video' && <video src={media.url} muted loop playsInline preload="metadata" />}
        {media?.kind === 'audio' && (
          <div className="ft-fallback"><Ic name="sparkles" /><audio src={media.url} controls /></div>
        )}
        {media?.kind === '3d' && <div className="ft-fallback"><Ic name="box" /><span>3D model</span></div>}
        {!media && (
          <div className="ft-fallback ft-text">{text ? <p>{text}</p> : <Ic name="image" />}</div>
        )}
      </div>
      <figcaption className="ft-foot">
        <span className="ft-by">anonymous</span>
        <span className="ft-when">{ago(item.createdAt)}</span>
      </figcaption>
    </figure>
  );
}

export function Feed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.feed({ visibility: 'feed', limit: 60 })
      .then((r) => { if (live) setItems(r.feed); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  return (
    <AppShell title="Feed">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>public feed · newest first</div>
            <h1>Feed</h1>
            <div className="sub">What people are making and choosing to share. Publish your own from any result.</div>
          </div>
          <Link className="btn" to="/card"><Ic name="plus" /> Make something</Link>
        </div>

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
            {items.map((it) => <Tile key={it.editionId} item={it} />)}
          </div>
        )}
      </div></div>
    </AppShell>
  );
}
