import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { COLLECTIONS, STATUS_LABEL, type CollStatus } from '../lib/collections';

// Collections (editio) — the BUILD-rail surface listing the user's collections. Each is a hub
// (traits → rules → run → curation → export). Local-first; publishing to NOESIS is a choice at
// the export crossing, never a funnel. The hemisphere stays dashed (private) until export.
const statusGlyph: Record<CollStatus, string> = { draft: 'dashed', locked: 'dashed', minted: 'lit' };

export function Collections() {
  return (
    <AppShell title="Collections">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>your collections · {COLLECTIONS.length}</div>
            <h1>Collections</h1>
            <div className="sub">Author an NFT collection from your models — define traits, run the supply, curate, then choose where it goes. Local until you publish.</div>
          </div>
          <div className="right"><button className="btn"><Ic name="plus" /> new collection</button></div>
        </div>

        <div className="collgrid">
          {COLLECTIONS.map((c) => (
            <div key={c.id} className="collcard">
              <div className="coll-mosaic" style={{ background: c.tile }}>
                <span className="coll-status mono"><span className={`hemi2 ${statusGlyph[c.status]}`} /> {STATUS_LABEL[c.status]}</span>
              </div>
              <div className="coll-body">
                <div className="coll-title"><b>{c.name}</b></div>
                <div className="coll-theme mono">{c.theme}</div>
                <div className="coll-stats mono">{c.supply.toLocaleString()} / {c.target.toLocaleString()} pieces · {c.traits} traits · {c.rarityDelta}</div>
                <div className="coll-actions">
                  <Link className="btn ghost" to={`/collections/${c.id}`}>Open hub</Link>
                  {c.status === 'minted'
                    ? <Link className="btn ghost" to="/collections"><span className="noesis-tag">on noesis ↗</span></Link>
                    : <Link className="btn accent" to={`/collections/${c.id}/export`}>Export &amp; publish →</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div></div>
    </AppShell>
  );
}
