import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Collection, type RarityReport } from '../lib/api';
import { COLL_STATUS_LABEL } from '../lib/collections';

// Canonic run — the live view of a collection's batch generation. A collection fires the
// moment it's created, so this SHOWS the run (progress + realized-vs-target rarity) and offers
// the lifecycle controls (cancel while active, extend when done). Stays LOCAL until export.
const CELLS = 60;
const SEG = ['var(--accent)', 'var(--good)', 'var(--slate)', 'var(--gold)', 'var(--grey)'];
const mix = (v: string) => `color-mix(in srgb, ${v} 62%, transparent)`;

export function CanonicRun() {
  const { id } = useParams();
  const [c, setC] = useState<Collection | null>(null);
  const [rarity, setRarity] = useState<RarityReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [extendN, setExtendN] = useState(50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const [col, rar] = await Promise.all([
          api.getCollection(id!),
          api.getCollectionRarity(id!).catch(() => null),
        ]);
        if (!live) return;
        setC(col.collection);
        if (rar?.rarity) setRarity(rar.rarity);
        if ((col.collection.status === 'pending' || col.collection.status === 'running') && live) {
          timer = setTimeout(poll, 2500);
        }
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : String(e));
      }
    }
    poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [id, reload]);

  async function control(fn: () => Promise<{ collection: Collection }>): Promise<boolean> {
    setBusy(true);
    try { const { collection } = await fn(); setC(collection); setReload((r) => r + 1); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }

  if (err) return <AppShell title="Canonic run"><div className="page"><div className="pw wide"><div className="warn">{err}</div></div></div></AppShell>;
  if (!c) return <AppShell title="Canonic run"><div className="page"><div className="pw wide"><div className="empty"><div className="t">Loading…</div></div></div></div></AppShell>;

  const active = c.status === 'pending' || c.status === 'running';
  const paused = !!c.paused;
  const done = c.status === 'complete';
  const settled = c.completed + c.failed + c.rejected;
  const pct = c.total ? Math.min(100, (c.completed / c.total) * 100) : 0;
  const lit = Math.round((pct / 100) * CELLS);
  const name = c.nomen || 'collection';
  const crumb = <span className="ph-crumb"><Link to={`/collections/${id}`}>{name}</Link> <span className="sep">/</span> <b>canonic run</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Canonic run</h1><div className="sub mono">{c.modusId} · {c.total.toLocaleString()} pieces · {COLL_STATUS_LABEL[c.status]}</div></div>
          <div className="right"><span className="badge">private · not minted</span></div>
        </div>

        <div className="cj-run cr-run">
          <div className="cr-hero"><b>{c.completed.toLocaleString()}</b> <span>/ {c.total.toLocaleString()} pieces{active ? ' · generating' : ''}</span></div>
          <div className="cr-progress">
            <div className="cj-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="cr-prow mono">
              <span>{active ? <>generating <b className="accent">{c.completed.toLocaleString()}</b> / {c.total.toLocaleString()}</> : <>{COLL_STATUS_LABEL[c.status]} · <b className="accent">{c.completed.toLocaleString()}</b> pieces</>}{c.rejected ? ` · ${c.rejected} rejected` : ''}{c.failed ? ` · ${c.failed} failed` : ''}</span>
              <span>{Math.round(pct)}% · {settled.toLocaleString()} / {c.total.toLocaleString()} settled</span>
            </div>
          </div>
          <div className="cr-controls">
            {active && !paused && <button className="btn ghost" disabled={busy} onClick={() => control(() => api.pauseCollection(id!))}>Pause</button>}
            {active && paused && <button className="btn ghost" disabled={busy} onClick={() => control(() => api.resumeCollection(id!))}>Resume</button>}
            {active && <button className="btn ghost" disabled={busy} onClick={() => control(() => api.cancelCollection(id!))}>Cancel run</button>}
            {done && (
              <>
                <input className="cr-extend-n" type="number" min={1} value={extendN} onChange={(e) => setExtendN(Math.max(1, Number(e.target.value) || 1))} />
                <button className="btn ghost" disabled={busy} onClick={() => control(() => api.extendCollection(id!, extendN))}>Extend +{extendN}</button>
              </>
            )}
          </div>
        </div>

        <div className="cr-grid">
          {Array.from({ length: CELLS }, (_, i) => (
            <span key={i} className={`cr-cell${i < lit ? ' filled' : ''}${active && i === lit ? ' frontier' : ''}`}
              style={i < lit ? { background: `radial-gradient(120% 100% at 50% 30%, ${SEG[i % SEG.length]}, #14171c)` } : undefined} />
          ))}
        </div>

        <div className="cr-dist">
          <div className="cr-dist-head">
            {rarity && <span className="cr-ok mono">{rarity.totalPieces.toLocaleString()} pieces measured</span>}</div>
          {!rarity && <div className="empty"><div className="s">Rarity fills in as pieces settle.</div></div>}
          {rarity?.axes.map((ax) => (
            <div key={ax.trait_type} className="cr-axis">
              <div className="cr-axis-l"><span>{ax.trait_type}</span><span className="mono">realized %</span></div>
              <div className="cr-bar">
                {ax.valores.map((v, i) => {
                  const w = Math.round(v.realizedRarity * 100);
                  const delta = Math.round((v.realizedRarity - v.targetRarity) * 100);
                  return w > 0 ? (
                    <span key={v.value} className="cr-seg mono" style={{ width: `${w}%`, background: mix(SEG[i % SEG.length]) }}
                      title={`${v.value} · realized ${w}% · target ${Math.round(v.targetRarity * 100)}% (${delta >= 0 ? '+' : ''}${delta}%)`}>
                      {v.value} · {w}%
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="garden-foot">
          <Link className="btn ghost" to={`/collections/${id}`}>← hub</Link>
          <Link className="btn accent" to={`/collections/${id}/curation`}>Next · curation →</Link>
        </div>
      </div></div>
    </AppShell>
  );
}
