import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { MODELS, LIFETIME_ROYALTIES } from '../lib/models';
import { custodyGlyph, CUSTODY_LABEL } from '../lib/datasets';

// Model shelf (train-shelf-spec.md, render noema-train-shelf.png) — the trained models: sample
// cards → provenance + royalty detail; run · collection · earn. The shelf earns its imagery
// (personal craft, opposite the Registry). Royalties (gold) are economic provenance shown
// honestly beside lineage; listing is opt-in (private is default-safe).
export function Shelf() {
  return (
    <AppShell title="Models">
      <div className="page"><div className="pw wide">
        <div className="pagehead shelf-head">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>your models · {MODELS.length} trained</div>
            <h1>Model shelf</h1>
            <div className="sub">What you’ve taught NOEMA — run them, turn them into collections, and earn when others run them.</div>
          </div>
          <div className="shelf-right">
            <div className="noema-frame royalty-band">
              <div className="rb-l noema-kicker">lifetime royalties</div>
              <div className="rb-n gold"><span className="gem">◈</span> {LIFETIME_ROYALTIES.total.toLocaleString()} cr <span className="rb-delta">+{LIFETIME_ROYALTIES.last30.toLocaleString()} ↑30d</span></div>
            </div>
            <Link className="btn" to="/datasets"><Ic name="plus" /> new training</Link>
          </div>
        </div>

        <div className="shelfgrid">
          {MODELS.map((m) => (
            <div key={m.id} className="modelcard">
              <div className="mc-sample" style={{ background: m.tile }}>
                <span className="mc-ver mono">{m.version}</span>
                <span className={`mc-listed ${m.listed ? 'on' : 'priv'}`}>{m.listed ? <><span className="rdot good" /> listed</> : <><Ic name="eye-off" /> private</>}</span>
              </div>
              <div className="mc-body">
                <div className="mc-title"><b>{m.name}</b><span className={`mc-kind ${m.kind}`}>{m.kind}</span></div>
                <div className="mc-meta mono">{m.base} · {m.rank} · trigger <span className="accent">{m.trigger}</span></div>
                <div className="mc-royalty">
                  <span className="mono">{m.runs.toLocaleString()} runs · royalties</span>
                  <span className="gold mono">{m.royalties != null ? <><span className="gem">◈</span> {m.royalties.toLocaleString()} cr</> : '— private'}</span>
                </div>
                <div className="mc-lineage mono">{m.lineage.dataset} · {m.lineage.version} · {m.lineage.captionset} · <span className={`hemi2 ${custodyGlyph(m.lineage.custody)}`} /> {CUSTODY_LABEL[m.lineage.custody]}</div>
                <div className="mc-actions">
                  <Link className="btn ghost" to={`/card?id=${m.id}`}>Use in modus</Link>
                  <Link className="btn accent" to="/collections"><Ic name="hexagon" /> Collection</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div></div>
    </AppShell>
  );
}
