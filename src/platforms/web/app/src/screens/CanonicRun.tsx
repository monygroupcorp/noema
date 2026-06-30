import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { COLLECTIONS } from '../lib/collections';

// Canonic run (editio-canonic-run-spec.md, render noema-editio-canonic-run.png) — "here we go":
// fire the modus N times, watch a grid live-fill, realized-vs-target rarity below. Stays LOCAL
// (private · not minted) — the seam crosses to public only at export. Shares the run grammar.
const TINTS = ['#2b3a5e', '#3a2f5e', '#2c4a44', '#34343a', '#5e3a2b', '#2f4a5e', '#2c5d54'];
const DIST = [
  { axis: 'Headwear', segs: [{ k: 'bare', v: 52, c: 'var(--grey)' }, { k: 'hood', v: 23, c: 'var(--good)' }, { k: 'hat', v: 17, c: 'var(--accent)' }, { k: 'halo', v: 8, c: 'var(--gold)' }] },
  { axis: 'Background', segs: [{ k: 'void', v: 40, c: 'var(--grey)' }, { k: 'dawn', v: 35, c: 'var(--accent)' }, { k: 'storm', v: 25, c: 'var(--slate)' }] },
  { axis: 'Aura', segs: [{ k: 'verdant', v: 38, c: 'var(--good)' }, { k: 'azure', v: 34, c: 'var(--accent)' }, { k: 'none', v: 28, c: 'var(--grey)' }] },
];

export function CanonicRun() {
  const { id } = useParams();
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  const total = 1944;
  const [done, setDone] = useState(662);
  useEffect(() => { const t = setInterval(() => setDone((d) => (d >= total ? d : Math.min(total, d + 7))), 500); return () => clearInterval(t); }, []);
  const crumb = <span className="ph-crumb"><Link to={`/collections/${id}`}>{c.name}</Link> <span className="sep">/</span> <b>canonic run</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Fire the canonic run</h1><div className="sub mono">modus · 6 steps · 4 axes locked · seed 0x4af…</div></div>
          <div className="right"><span className="badge">private · not minted</span></div>
        </div>

        <div className="cj-run cr-run">
          <div className="cr-hero"><b>{total.toLocaleString()}</b> <span>pieces to generate</span></div>
          <button className="btn accent cr-fire">◆ Fire run</button>
          <div className="cr-progress">
            <div className="cj-bar"><span style={{ width: `${(done / total) * 100}%` }} /></div>
            <div className="cr-prow mono"><span>generating <b className="accent">{done.toLocaleString()}</b> / {total.toLocaleString()} · 4 in flight</span><span>~18 min remaining</span></div>
          </div>
        </div>

        <div className="cr-grid">
          {Array.from({ length: 48 }, (_, i) => (
            <span key={i} className={`cr-cell${i >= 44 ? ' frontier' : ''}`} style={{ background: `radial-gradient(120% 100% at 50% 30%, ${TINTS[i % TINTS.length]}, #14171c)` }} />
          ))}
        </div>

        <div className="cr-dist">
          <div className="cr-dist-head"><span className="noema-kicker">rarity · realized distribution</span><span className="cr-ok mono">◆ all axes within ±1.2% of target</span></div>
          {DIST.map((d) => (
            <div key={d.axis} className="cr-axis">
              <div className="cr-axis-l"><span>{d.axis}</span><span className="mono">realized %</span></div>
              <div className="cr-bar">
                {d.segs.map((s) => <span key={s.k} className="cr-seg mono" style={{ width: `${s.v}%`, background: color(s.c) }}>{s.k} · {s.v}</span>)}
              </div>
            </div>
          ))}
        </div>

        <div className="garden-foot">
          <Link className="btn ghost" to={`/collections/${id}/rules`}>← rules</Link>
          <Link className="btn accent" to={`/collections/${id}/curation`}>Next · curation →</Link>
        </div>
      </div></div>
    </AppShell>
  );
}
function color(v: string) { return `color-mix(in srgb, ${v} 60%, transparent)`; }
