import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Collection } from '../lib/api';
import { COLL_STATUS_LABEL, collGlyph, collTile } from '../lib/collections';

// Collection hub — one collection's home (the editio spine: garden → rules → run → curation →
// export). Reads the real Collectio; the child authoring screens (garden/rules/curation/export)
// are still local until their endpoints exist. Local-first; the hemisphere stays dashed until export.

export function EditioHub() {
  const { id } = useParams();
  const [c, setC] = useState<Collection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Cross-link into the other publish system: post the whole collection to the moderated feed
  // (UX handoff 2, D6). Mirrors Card's per-result publish, but with a `collectio` artifact ref.
  const [pub, setPub] = useState<{ s: 'idle' | 'busy' | 'done' | 'err'; msg?: string }>({ s: 'idle' });

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.getCollection(id).then((r) => { if (live) setC(r.collection); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  async function postToFeed(collId: string) {
    setPub({ s: 'busy' });
    try {
      await api.publish({ artifact: { kind: 'collectio', id: collId }, destination: 'feed', visibility: 'feed', custody: 'ours' });
      setPub({ s: 'done' });
    } catch (e) {
      setPub({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  if (err) {
    return <AppShell title="Collection"><div className="page"><div className="pw wide"><div className="warn">Couldn’t load this collection: {err}</div></div></div></AppShell>;
  }
  if (!c) {
    return <AppShell title="Collection"><div className="page"><div className="pw wide"><div className="empty"><div className="t">Loading…</div></div></div></div></AppShell>;
  }

  const name = c.nomen || 'Untitled collection';
  const done = c.status === 'complete';
  const STEPS = [
    { n: 1, to: `/collections/${c.id}/garden`, ico: 'sparkles', t: 'Traits garden', s: 'axes of variation' },
    { n: 2, to: `/collections/${c.id}/rules`, ico: 'workflow', t: 'Trait rules', s: 'exclusions & cohesion' },
    { n: 3, to: `/collections/${c.id}/run`, ico: 'box', t: 'Canonic run', s: `${c.completed.toLocaleString()} / ${c.total.toLocaleString()} pieces` },
    { n: 4, to: `/collections/${c.id}/curation`, ico: 'check', t: 'Curation', s: 'approve into supply' },
    { n: 5, to: `/collections/${c.id}/export`, ico: 'send', t: 'Export & publish', s: 'download · hosting · noesis' },
  ];

  const crumb = <span className="ph-crumb"><Link to="/collections">collections</Link> <span className="sep">/</span> <b>{name}</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="ph-head">
          <div>
            <div className="ph-kick">collection · <span className={`hemi2 ${collGlyph()}`} /> {COLL_STATUS_LABEL[c.status]}</div>
            <h1 className="ph-name">{name}</h1>
            <p className="ph-desc">{c.modusId} · {c.completed.toLocaleString()} / {c.total.toLocaleString()} pieces{c.rejected ? ` · ${c.rejected} rejected` : ''}{c.failed ? ` · ${c.failed} failed` : ''}</p>
          </div>
          <div className="ph-people">
            <span className="ph-avatars"><span className="av" style={{ background: collTile(c.id) }} /><span className="av" /></span>
            <button className="btn"><Ic name="circle-user" /> share ▸</button>
          </div>
        </div>

        <div className="ed-flow">
          {STEPS.map((s, i) => (
            <Link key={s.n} className={`ed-step${done && s.n < 5 ? ' done' : ''}`} to={s.to}>
              <span className="ed-step-n mono">{s.n}</span>
              <span className="ed-step-ico"><Ic name={s.ico} /></span>
              <span className="ed-step-main"><b>{s.t}</b><span className="ed-step-s mono">{s.s}</span></span>
              {i < STEPS.length - 1 && <span className="ed-step-arrow">→</span>}
            </Link>
          ))}
        </div>

        {/* Cross-link to the feed — the collection author's path into the single-result publish system. */}
        <div className="pub-row" style={{ margin: 'var(--s4) 0' }}>
          {pub.s === 'done' ? (
            <span className="pub-done"><Ic name="check" /> In review — it appears in the <Link to="/feed">feed</Link> once approved.</span>
          ) : (
            <>
              <button className="btn ghost" disabled={pub.s === 'busy'} onClick={() => postToFeed(c.id)}>
                <Ic name="rss" /> {pub.s === 'busy' ? 'Posting…' : 'Post collection to feed'}
              </button>
              <span className="sub" style={{ marginLeft: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
                Shares this collection to the public feed (moderated) — separate from Export’s archive · hosting · noesis.
              </span>
              {pub.s === 'err' && <span className="pub-err" style={{ marginLeft: 'var(--s3)' }}>{pub.msg}</span>}
            </>
          )}
        </div>

        <div className="ph-band">
          <div className="ph-about">
            <div className="ph-l">about this collection</div>
            <p>A collection is a <b>hub</b> — pure, persistent, multiplayer. Generation + curation are <b>local and reversible</b>; only export/mint crosses to public &amp; permanent. That asymmetry is the spine.</p>
            <div className="ph-meta mono">flow {c.modusId} · provenance {c.provenanceHash.slice(0, 18)}… · local until you publish</div>
          </div>
          <div className="ph-activity">
            <div className="ph-l">activity</div>
            <div className="ph-ev"><span className="av" style={{ background: collTile(c.id) }} /><span className="ev-t"><b>you</b> started the canonic supply <span className="mono ev-meta"><span className="hemi2 dashed" /> local{c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString()}` : ''}</span></span></div>
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
