import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Collection, type RarityReport } from '../lib/api';
import { COLL_STATUS_LABEL, spliceMechanismLine } from '../lib/collections';

// Canonic run — the live view of a collection's batch generation. A collection fires the
// moment it's created, so this SHOWS the run (progress + realized-vs-target rarity) and offers
// the lifecycle controls (cancel while active, extend when done). Stays LOCAL until export.
const CELLS = 60;
const SEG = ['var(--accent)', 'var(--good)', 'var(--slate)', 'var(--gold)', 'var(--grey)'];
const mix = (v: string) => `color-mix(in srgb, ${v} 62%, transparent)`;

export const STALL_MESSAGE = 'nothing is running — this run appears stalled';
export const STALL_HINT = 'Pause, then Resume, retries dispatch';

export function inFlightLine(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'piece' : 'pieces'} in flight · a machine is provisioning — first piece typically lands in a few minutes`;
}

export function pendingReviewLine(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'piece' : 'pieces'} awaiting review`;
}

export type RunLivenessState = 'stalled' | 'inflight' | 'normal';

// Classifies the run screen's between-poll banner from the collection's own payload — pure,
// no DOM. Three invisible-until-now states (noema-358): 'inflight' (dispatched, nothing
// settled yet — pod still provisioning), 'stalled' (actively running, but dispatch produced
// NOTHING — the noema-357 case, otherwise indistinguishable from 'inflight'), and 'normal'
// (settling has started, or the run isn't active). pendingReview is independent of state —
// it can be nonzero in any of them.
export function runLiveness(c: {
  status: string;
  paused?: boolean;
  completed: number;
  failed: number;
  rejected: number;
  inFlight?: number;
  pendingReview?: number;
}): { state: RunLivenessState; inFlight: number; pendingReview: number } {
  const inFlight = c.inFlight ?? 0;
  const pendingReview = c.pendingReview ?? 0;
  const settled = c.completed + c.failed + c.rejected;
  const active = (c.status === 'pending' || c.status === 'running') && !c.paused;
  let state: RunLivenessState = 'normal';
  if (active && settled === 0) {
    if (c.status === 'running' && inFlight === 0 && pendingReview === 0) state = 'stalled';
    else if (inFlight > 0) state = 'inflight';
  }
  return { state, inFlight, pendingReview };
}

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
    // The collection and the rarity table are fetched INDEPENDENTLY, not as one `Promise.all`.
    // Only the collection gates the screen — the rarity block has its own empty state ("Rarity
    // fills in as pieces settle") and is decoration until pieces land. Awaiting both together
    // meant a slow or never-answering rarity read held the whole screen on "Loading…" with no
    // error and no way out, which is the one state this screen must not be able to reach: the
    // rarity read walks every actum in the collection one at a time, so it is precisely the
    // request that gets slow as a run grows.
    async function poll() {
      try {
        const { collection } = await api.getCollection(id!);
        if (!live) return;
        // A 200 carrying no collection would otherwise leave `c` null forever — the same
        // "Loading… and nothing else" dead end, reached by a different door. Say so instead.
        if (!collection) throw new Error('this run could not be read');
        setC(collection);
        if (collection.status === 'pending' || collection.status === 'running') {
          timer = setTimeout(poll, 2500);
        }
        // Rarity trails the collection: it refreshes the table when it answers and is dropped
        // when it does not. Never awaited, so it cannot delay this tick or the next.
        api.getCollectionRarity(id!).then((r) => { if (live && r?.rarity) setRarity(r.rarity); }).catch(() => {});
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
  const live = runLiveness(c);
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
          <div className="cr-hero"><b>{c.completed.toLocaleString()}</b> <span>/ {c.total.toLocaleString()} pieces{active && live.state !== 'stalled' ? ' · generating' : ''}</span></div>
          {live.state === 'stalled' && (
            <div className="warn" style={{ gridColumn: '1 / -1' }}>{STALL_MESSAGE} — {STALL_HINT}.</div>
          )}
          {live.state === 'inflight' && (
            <div className="hint mono" style={{ gridColumn: '1 / -1' }}>{inFlightLine(live.inFlight)}</div>
          )}
          {live.pendingReview > 0 && (
            <div className="hint mono" style={{ gridColumn: '1 / -1' }}>
              {pendingReviewLine(live.pendingReview)} · <Link to={`/collections/${id}/curation`}>review now</Link>
            </div>
          )}
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

        {/* The run screen is where the trait→piece mechanism actually executes, and it had no
            plain-language account of it at all. Derived from the collection's own axes and base
            prompt, so it describes THIS run rather than collections in general. */}
        <div className="cr-splice">{spliceMechanismLine(c.tractus, c.basePrompt)}</div>

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
