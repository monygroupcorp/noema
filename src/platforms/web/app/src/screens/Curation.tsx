import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { COLLECTIONS } from '../lib/collections';

// Curation (editio-curation-spec.md, render noema-editio-curation.png) — approve the supply into
// mint. Every piece is the human's call; AI only FLAGS & ORDERS, never auto-decides. Private &
// reversible — nothing leaves your machine until you mint.
type PieceState = 'kept' | 'rejected' | 'pending';
const TRAITS = [
  { axis: 'Headwear', title: 'Wizard hat', rarity: '17%' },
  { axis: 'Background', title: 'Storm', rarity: '25%' },
  { axis: 'Robe', title: 'Cathedral cape', rarity: '8%' },
  { axis: 'Aura', title: 'Rare gold', rarity: '8%' },
];

export function Curation() {
  const { id } = useParams();
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  const [reviewed, setReviewed] = useState(412);
  const [kept, setKept] = useState(398);
  const [rejected, setRejected] = useState(14);
  const decide = (keep: boolean) => { setReviewed((n) => n + 1); keep ? setKept((n) => n + 1) : setRejected((n) => n + 1); };
  const strip: PieceState[] = ['kept', 'rejected', 'kept', 'kept', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'];

  const crumb = <span className="ph-crumb"><Link to={`/collections/${id}`}>{c.name}</Link> <span className="sep">/</span> <b>curation</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Curate the supply</h1><div className="sub mono">every piece is your call · AI only flags &amp; orders</div></div>
          <div className="right"><span className="badge">private · not minted</span></div>
        </div>

        <div className="cu-prog">
          <span className="mono"><b>{reviewed}</b> / 1,944 reviewed</span>
          <div className="cj-bar"><span style={{ width: `${(reviewed / 1944) * 100}%` }} /></div>
          <span className="mono"><span className="good">{kept} kept</span> · <span className="bad">{rejected} rejected</span></span>
        </div>

        <div className="cu-main">
          <div className="cu-piece">
            <span className="cu-img" style={{ background: 'radial-gradient(120% 100% at 40% 30%, #3b4f78, #1b2740)' }} />
            <div className="cu-meta mono">#0413 · seed 0x4af…</div>
            <div className="cu-flag mono">✦ AI flag: low contrast — likely fine, your call</div>
          </div>
          <div className="cu-side">
            <div className="noema-kicker">traits on this piece</div>
            <div className="cu-traits">
              {TRAITS.map((t) => (
                <div key={t.axis} className="cu-trow"><span className="cu-axis">{t.axis}</span><span className="cu-tv"><b>{t.title}</b><span className="cu-rar mono">{t.rarity}</span></span></div>
              ))}
            </div>
            <div className="cu-actions">
              <button className="cu-keep" onClick={() => decide(true)}>✓ Keep <span className="kbd">K</span></button>
              <button className="cu-reject" onClick={() => decide(false)}>✕ Reject <span className="kbd">R</span></button>
            </div>
            <div className="cu-nav mono"><button className="lnk">← prev</button><button className="lnk">skip →</button></div>
          </div>
        </div>

        <div className="cu-supply">
          <div className="cu-supply-head"><span className="noema-kicker">supply · all 1,944</span><span className="mono cu-order">✦ ordered: AI-flagged first</span></div>
          <div className="cu-strip">
            {strip.map((s, i) => <span key={i} className={`cu-chip ${s}`}>{s === 'kept' ? '✓' : s === 'rejected' ? '✕' : '?'}</span>)}
            <span className="cu-more mono">+1,932</span>
          </div>
        </div>

        <div className="cu-foot">
          <span className="mono"><span className="hemi2 dashed" /> Reviewed locally · nothing leaves your machine until you mint</span>
          <Link className="btn accent" to={`/collections/${id}/export`}>rarity finalizes when you lock supply →</Link>
        </div>
      </div></div>
    </AppShell>
  );
}
