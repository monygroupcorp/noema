import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Collection, type Tractus, type TractusValor } from '../lib/api';
import { guardedClick, useDirtyGuard } from '../lib/dirtyGuard';
import { axisSplice } from '../lib/collections';

// Product of per-axis value counts — how many pieces the canonic run would generate.
const combos = (axes: Tractus[]) => axes.reduce((n, a) => n * Math.max(1, a.valores.length), 1);

// Trait rules (editio-rules-spec.md) — the exclusion + cohesion primitives, wired to the live
// draft. Each value carries `excludes` (labels in OTHER axes it blocks — hard exclusion) and
// `tags` (motif labels for group-level mutual exclusion). Edited here and saved via
// PATCH /collectiones/:id/tractus (same write as the garden). Frozen once fired.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const label = (v: TractusValor) => v.label || String(v.value);

export function TraitRules() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<Collection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [axes, setAxes] = useState<Tractus[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [firing, setFiring] = useState(false);

  useDirtyGuard(dirty);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.getCollection(id).then((r) => { if (live) { setC(r.collection); setAxes(r.collection.tractus ?? []); } })
      .catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, [id]);

  if (err) return <AppShell title="Rules"><div className="page"><div className="pw wide"><div className="warn">Couldn’t load: {err}</div></div></div></AppShell>;
  if (!c) return <AppShell title="Rules"><div className="page"><div className="pw wide"><div className="empty"><div className="t">Loading…</div></div></div></div></AppShell>;

  const editable = c.status === 'draft';
  const patchValor = (i: number, j: number, p: Partial<TractusValor>) => {
    setAxes(axes.map((a, k) => (k === i ? { ...a, valores: a.valores.map((v, m) => (m === j ? { ...v, ...p } : v)) } : a)));
    setDirty(true);
  };

  async function save() {
    if (!id || busy) return;
    setBusy(true); setErr(null);
    try { const { collection } = await api.patchCollectionTractus(id, axes); setC(collection); setAxes(collection.tractus ?? axes); setDirty(false); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  // Forward seam: fire straight from the rules step. Firing freezes the traits + rules and
  // spends credits, so we persist any unsaved rule edits first, then confirm, then dispatch.
  async function fire() {
    if (!id || firing) return;
    const total = combos(axes);
    if (total === 0) return;
    if (!confirm(`Fire this collection — generate ${total} pieces on real compute? This freezes the traits and rules and spends credits.`)) return;
    setFiring(true); setErr(null);
    try {
      if (dirty) { const { collection } = await api.patchCollectionTractus(id, axes); setC(collection); setAxes(collection.tractus ?? axes); setDirty(false); }
      await api.fireCollection(id);
      nav(`/collections/${id}/run`);
    } catch (e) { setErr(msg(e)); setFiring(false); }
  }

  const empty = axes.every((a) => a.valores.length === 0);
  const crumb = <span className="ph-crumb"><Link to={`/collections/${id}`} onClick={guardedClick}>{c.nomen || 'collection'}</Link> <span className="sep">/</span> <b>rules</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Trait rules</h1><div className="sub mono">excludes · motif tags {editable ? '' : '· frozen'}</div></div>
          <div className="right">{editable ? <button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : dirty ? 'Save rules' : 'Saved'}</button> : <span className="badge">locked</span>}</div>
        </div>

        {err && <div className="warn" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="rl-sec"><span className="rl-hint mono"><b>excludes</b> = labels in other axes this value can’t appear with · <b>tags</b> = motif groups that repel each other</span></div>

        {empty ? (
          <div className="empty"><div className="t">No trait values yet</div><div className="s">Add values in the <Link to={`/collections/${id}/garden`} onClick={guardedClick}>traits garden</Link> first, then set their rules here.</div></div>
        ) : axes.map((a, i) => (
          <div key={i} className="rr-axis">
            <div className="rr-axis-h"><b>{a.label || a.porta}</b> <span className="mono rl-hint">{a.valores.length} values</span></div>
            {/* The axis header prints the port; this says what the port does with the value
                a rule lets through — the same derived line the garden shows. */}
            <div className="rr-axis-splice mono">{axisSplice(a, c.basePrompt).line}</div>
            {a.valores.map((v, j) => (
              <div key={j} className="rr-row">
                <span className="rr-name">{label(v)}</span>
                <label className="rr-field"><span className="mono">excludes</span>
                  {editable
                    ? <input className="cer-input" value={(v.excludes ?? []).join(', ')} placeholder="e.g. Ember, Wizard hat" onChange={(e) => patchValor(i, j, { excludes: toList(e.target.value) })} />
                    : <span className="mono">{(v.excludes ?? []).join(', ') || '—'}</span>}
                </label>
                <label className="rr-field"><span className="mono">tags</span>
                  {editable
                    ? <input className="cer-input" value={(v.tags ?? []).join(', ')} placeholder="e.g. frost, cool" onChange={(e) => patchValor(i, j, { tags: toList(e.target.value) })} />
                    : <span className="mono">{(v.tags ?? []).join(', ') || '—'}</span>}
                </label>
              </div>
            ))}
          </div>
        ))}

        <div className="garden-foot">
          <Link className="btn ghost" to={`/collections/${id}/garden`} onClick={guardedClick}>← garden</Link>
          {editable
            ? <button className="btn accent" disabled={firing || empty} onClick={fire}>{firing ? 'Firing…' : 'Fire collection →'}</button>
            : <Link className="btn accent" to={`/collections/${id}/run`} onClick={guardedClick}>Canonic run →</Link>}
        </div>
      </div></div>
    </AppShell>
  );
}
