import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Collection, type FlowSummary, type Tractus, type TractusValor } from '../lib/api';
import { guardedClick, useDirtyGuard } from '../lib/dirtyGuard';
import { axisSplice, SPLICE_WHEN } from '../lib/collections';

// Traits garden (editio-garden-spec.md) — author the axes of variation. Each axis is a
// Tractus (an input port to vary), each card a TractusValor (value + label + weight). Wired
// to the live draft: edits are local until Save → PATCH /collectiones/:id/tractus (re-derives
// provenance). Once fired, the grid and the supply are read-only, but the BASE FLOW stays
// editable — a flow change is forward-only, so pieces already generated keep the flow they were
// made under and the next dispatch expands the new one. Fire = spend + run.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const combos = (axes: Tractus[]) => axes.reduce((n, a) => n * Math.max(1, a.valores.length), 1);

export function TraitsGarden() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<Collection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [axes, setAxes] = useState<Tractus[]>([]);
  const [active, setActive] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<false | 'save' | 'fire'>(false);
  // A collection is now created by name alone, so a draft can arrive here with no base flow
  // and no supply. Both are part of the draft-authoring write and are saved alongside the grid.
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [modusId, setModusId] = useState('');
  const [total, setTotal] = useState(0);

  useDirtyGuard(dirty);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.getCollection(id).then((r) => {
      if (!live) return;
      setC(r.collection);
      setAxes(r.collection.tractus ?? []);
      setModusId(r.collection.modusId);
      setTotal(r.collection.total);
    }).catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => { api.listFlows().then((r) => setFlows(r.flows)).catch(() => {}); }, []);

  if (err) return <AppShell title="Traits"><div className="page"><div className="pw wide"><div className="warn">Couldn’t load: {err}</div></div></div></AppShell>;
  if (!c) return <AppShell title="Traits"><div className="page"><div className="pw wide"><div className="empty"><div className="t">Loading…</div></div></div></div></AppShell>;

  const editable = c.status === 'draft';
  const cat = axes[active];

  function mutate(next: Tractus[]) { setAxes(next); setDirty(true); }
  const patchAxis = (i: number, p: Partial<Tractus>) => mutate(axes.map((a, k) => (k === i ? { ...a, ...p } : a)));
  const patchValor = (i: number, j: number, p: Partial<TractusValor>) =>
    mutate(axes.map((a, k) => (k === i ? { ...a, valores: a.valores.map((v, m) => (m === j ? { ...v, ...p } : v)) } : a)));
  function addAxis() { const next = [...axes, { porta: 'prompt', label: `Axis ${axes.length + 1}`, valores: [] as TractusValor[] }]; mutate(next); setActive(next.length - 1); }
  function removeAxis(i: number) { const next = axes.filter((_, k) => k !== i); mutate(next); setActive(Math.max(0, Math.min(active, next.length - 1))); }
  const addValor = (i: number) => mutate(axes.map((a, k) => (k === i ? { ...a, valores: [...a.valores, { value: '', label: '' }] } : a)));
  const removeValor = (i: number, j: number) => mutate(axes.map((a, k) => (k === i ? { ...a, valores: a.valores.filter((_, m) => m !== j) } : a)));

  async function save() {
    if (!id || busy) return;
    setErr(null);
    // Drop empty values; every value needs a non-empty `value`.
    const clean = axes.map((a) => ({ ...a, valores: a.valores.filter((v) => String(v.value).trim() !== '') }));
    // Traits and supply are frozen once fired, and the wire cannot say "sent but unchanged" —
    // so on a fired collection we send the flow alone and omit those fields entirely.
    const patch = {
      ...(editable ? { tractus: clean } : {}),
      ...(editable && total !== c!.total ? { numerus: total } : {}),
      ...(modusId && modusId !== c!.modusId ? { modusId } : {}),
    };
    // Nothing the server would accept — clear the flag rather than send an empty patch.
    if (Object.keys(patch).length === 0) { setDirty(false); return; }
    setBusy('save');
    try {
      const { collection } = await api.patchCollectionDraft(id, patch);
      setC(collection); setAxes(collection.tractus ?? clean);
      setModusId(collection.modusId); setTotal(collection.total); setDirty(false);
    }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  async function fire() {
    if (!id || busy) return;
    if (dirty && !confirm('Save your edits before firing? Unsaved trait changes will be lost.')) return;
    if (!confirm(`Fire this collection — generate ${c!.total} pieces on real compute? This freezes the traits and spends credits.`)) return;
    setBusy('fire'); setErr(null);
    try { await api.fireCollection(id); nav(`/collections/${id}/run`); }
    catch (e) { setErr(msg(e)); setBusy(false); }
  }

  const crumb = <span className="ph-crumb"><Link to="/collections" onClick={guardedClick}>collections</Link> <span className="sep">/</span> <Link to={`/collections/${id}`} onClick={guardedClick}>{c.nomen || 'collection'}</Link> <span className="sep">/</span> <b>traits</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="garden-head">
          <div><h1>{c.nomen || 'Untitled collection'}</h1></div>
          <div className="garden-nudge">
            <span className="gn-count mono">{axes.length} {axes.length === 1 ? 'axis' : 'axes'} · <b className="accent">{combos(axes).toLocaleString()}</b> combinations · {c.total} pieces</span>
            {!editable && <span className="gn-ai"><span className="hemi2 lit" /> This collection is fired — traits are locked.</span>}
          </div>
        </div>

        {/* Base flow + supply — the two run-config fields the create form no longer asks for.
            Saved by the same write as the grid. Supply freezes on fire; the flow does not. */}
        <div className="coll-create" style={{ marginBottom: 12 }}>
          <div className="cc-row">
            <label className="cc-field"><span>Base flow</span>
              <select className="cer-input" value={modusId} onChange={(e) => { setModusId(e.target.value); setDirty(true); }}>
                <option value="">choose a flow…</option>
                {flows.map((f) => <option key={f.id} value={f.id}>{f.nomen ?? f.id}</option>)}
              </select></label>
            {editable && (
              <label className="cc-field cc-narrow"><span>Supply</span>
                <input className="cer-input" type="number" min={0} value={total}
                  onChange={(e) => { setTotal(Math.max(0, Number(e.target.value) || 0)); setDirty(true); }} /></label>
            )}
          </div>
          {!editable && (
            <div className="gt-sub mono" style={{ marginTop: 6 }}>
              A new flow applies to pieces made after you save — pieces already generated stay as they are.
            </div>
          )}
        </div>

        {err && <div className="warn" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="garden">
          {/* axes */}
          <aside className="garden-cats">
            <div className="gc-l">axes {editable && <button className="gc-add" onClick={addAxis}>+</button>}</div>
            {axes.map((a, i) => (
              <button key={i} className={`gc-item${active === i ? ' on' : ''}`} onClick={() => setActive(i)}>
                <span className="gc-dot" style={{ background: 'var(--accent)' }} /> {a.label || a.porta}<span className="gc-n mono">{a.valores.length}</span>
              </button>
            ))}
            {axes.length === 0 && <div className="gt-sub mono" style={{ padding: '8px 0' }}>no axes yet</div>}
            {editable && <button className="gc-new" onClick={addAxis}>+ new axis</button>}
          </aside>

          {/* value cards for the active axis */}
          <div className="garden-traits">
            {cat ? (
              <>
                <div className="gt-head">
                  <span className="gt-title">
                    {editable
                      ? <input className="cer-input" value={cat.label ?? ''} placeholder="axis label" onChange={(e) => patchAxis(active, { label: e.target.value })} style={{ maxWidth: 200 }} />
                      : <b>{cat.label || cat.porta}</b>}
                    <span className="gt-badge">shows on nft</span>
                  </span>
                  {editable && <button className="btn ghost sm" onClick={() => removeAxis(active)}><Ic name="trash-2" /> remove axis</button>}
                </div>
                <div className="gt-sub mono">
                  varies input port <b>{editable ? <input className="cer-input" value={cat.porta} onChange={(e) => patchAxis(active, { porta: e.target.value })} style={{ maxWidth: 140, display: 'inline-block' }} /> : cat.porta}</b>
                </div>
                {/* What this axis actually does to a piece — derived from the assembly path
                    (TraitMixer + CollectioCursor), not described from memory, so the routes a
                    value can take stay distinguishable as the author edits the grid. */}
                <div className="gt-splice">
                  <div className="gt-splice-what">{axisSplice(cat, c.basePrompt).line}</div>
                  <div className="gt-splice-when">{SPLICE_WHEN}</div>
                </div>
                <div className="gt-grid">
                  {cat.valores.map((v, j) => (
                    <div key={j} className="traitcard">
                      <div className="tc-title">
                        {editable
                          ? <input className="cer-input" value={v.label ?? ''} placeholder="label" onChange={(e) => patchValor(active, j, { label: e.target.value })} />
                          : <b>{v.label || String(v.value)}</b>}
                      </div>
                      <div className="tc-feeds">
                        <span className="tc-feeds-l mono">value</span>
                        {editable
                          ? <input className="cer-input" value={String(v.value)} placeholder="prompt fragment / value" onChange={(e) => patchValor(active, j, { value: e.target.value })} />
                          : <span className="tc-value mono">{String(v.value)}</span>}
                      </div>
                      <div className="tc-feeds">
                        <span className="tc-feeds-l mono">weight</span>
                        {editable
                          ? <input className="cer-input" type="number" step="0.1" min="0" value={v.rarity ?? ''} placeholder="0.5" onChange={(e) => patchValor(active, j, { rarity: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ maxWidth: 90 }} />
                          : <span className="tc-value mono">{v.rarity ?? '0.5'}</span>}
                      </div>
                      {editable && <button className="tc-del" onClick={() => removeValor(active, j)} title="remove value"><Ic name="x" /></button>}
                    </div>
                  ))}
                  {editable && <button className="traitcard add" onClick={() => addValor(active)}><Ic name="plus" /><span>add value</span></button>}
                </div>
              </>
            ) : (
              <div className="empty"><div className="t">No axes</div><div className="s">{editable ? 'Add an axis to start authoring the grid.' : 'This collection has no trait axes.'}</div></div>
            )}
          </div>
        </div>

        <div className="garden-foot">
          <Link className="btn ghost" to={`/collections/${id}`} onClick={guardedClick}>← hub</Link>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Also the flow-change save on a fired collection — the only field still writable there. */}
            <button className="btn" disabled={!dirty || busy !== false} onClick={save}>
              {busy === 'save' ? 'Saving…' : dirty ? (editable ? 'Save traits' : 'Save flow') : 'Saved'}
            </button>
            <Link className="btn ghost" to={`/collections/${id}/rules`} onClick={guardedClick}>Rules →</Link>
            {editable && <button className="btn accent" disabled={busy !== false || combos(axes) === 0} onClick={fire}>{busy === 'fire' ? 'Firing…' : 'Fire collection →'}</button>}
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
