import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Collection, type FlowSummary } from '../lib/api';
import { COLL_STATUS_LABEL, collGlyph, collTile } from '../lib/collections';
import { useProject, useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';
import { HoldingToggle } from '../lib/HoldingToggle';

// Collections (editio) — the BUILD-rail surface listing the user's collections. Each is a hub
// (traits → run → curation → export). A collection is a batch-gen over a Tractus grid; creating
// one LAUNCHES generation of `total` pieces, so create is a deliberate, confirmed action.

// The create form: name + base flow + supply + one axis of variation (options woven into a port).
function CreateForm({ onCreated }: { onCreated: (c: Collection) => void }) {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [nomen, setNomen] = useState('');
  const [modusId, setModusId] = useState('');
  const [total, setTotal] = useState(50);
  const [porta, setPorta] = useState('prompt');
  const [options, setOptions] = useState('');
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listFlows().then((r) => { setFlows(r.flows); if (r.flows[0]) setModusId(r.flows[0].id); }).catch(() => {}); }, []);

  const values = options.split(',').map((s) => s.trim()).filter(Boolean);
  const ready = !!modusId && total > 0 && values.length >= 2 && !busy;

  async function submit(draft: boolean) {
    if (!ready) return;
    if (!draft && !confirm(`Start generating ${total} pieces? This runs on real compute and spends credits.`)) return;
    setBusy(true); setErr(null);
    try {
      const { collection } = await api.createCollection({
        modusId, total, nomen: nomen.trim() || undefined, reviewEnabled: review, draft,
        tractus: [{ porta: porta.trim() || 'prompt', label: porta.trim() || 'prompt', valores: values.map((v) => ({ value: v, label: v })) }],
      });
      onCreated(collection);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setBusy(false);
    }
  }

  return (
    <div className="coll-create">
      <div className="cc-row">
        <label className="cc-field"><span>Name</span>
          <input className="cer-input" placeholder="untitled collection" value={nomen} onChange={(e) => setNomen(e.target.value)} /></label>
        <label className="cc-field"><span>Base flow</span>
          <select className="cer-input" value={modusId} onChange={(e) => setModusId(e.target.value)}>
            {flows.length === 0 && <option value="">loading…</option>}
            {flows.map((f) => <option key={f.id} value={f.id}>{f.nomen ?? f.id}</option>)}
          </select></label>
        <label className="cc-field cc-narrow"><span>Supply</span>
          <input className="cer-input" type="number" min={1} value={total} onChange={(e) => setTotal(Math.max(1, Number(e.target.value) || 1))} /></label>
      </div>
      <div className="cc-row">
        <label className="cc-field cc-narrow"><span>Vary this input</span>
          <input className="cer-input" value={porta} onChange={(e) => setPorta(e.target.value)} /></label>
        <label className="cc-field"><span>Options <em>(comma-separated — the axis of variation)</em></span>
          <input className="cer-input" placeholder="a frost knight, an ember mage, an arcane oracle" value={options} onChange={(e) => setOptions(e.target.value)} /></label>
      </div>
      <div className="cc-foot">
        <label className="cc-check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Review each piece before it counts</label>
        <span className="cc-note">{values.length >= 2 ? `${values.length} variations across ${total} pieces` : 'add at least two options'}</span>
        <button className="btn ghost" disabled={!ready} onClick={() => submit(true)} title="Author traits + rules before spending">Save as draft</button>
        <button className="btn" disabled={!ready} onClick={() => submit(false)}>{busy ? 'Starting…' : <>Start collection <Ic name="arrow-right" /></>}</button>
      </div>
      {err && <div className="cc-err">{err}</div>}
    </div>
  );
}

function Card({ c, projectId }: { c: Collection; projectId: string }) {
  const active = c.status === 'pending' || c.status === 'running';
  const draft = c.status === 'draft';
  return (
    <div className="collcard">
      <div className="coll-mosaic" style={{ background: collTile(c.id) }}>
        <span className="coll-status mono"><span className={`hemi2 ${collGlyph()}`} /> {COLL_STATUS_LABEL[c.status]}</span>
      </div>
      <div className="coll-body">
        <div className="coll-title"><b>{c.nomen || 'Untitled collection'}</b></div>
        <div className="coll-theme mono">{c.modusId}</div>
        <div className="coll-stats mono">{c.completed.toLocaleString()} / {c.total.toLocaleString()} pieces{c.rejected ? ` · ${c.rejected} rejected` : ''}{c.failed ? ` · ${c.failed} failed` : ''}</div>
        <div className="coll-actions">
          <Link className="btn ghost" to={`/collections/${c.id}`}>Open hub</Link>
          {draft
            ? <Link className="btn accent" to={`/collections/${c.id}/garden`}>Author draft →</Link>
            : active
            ? <Link className="btn accent" to={`/collections/${c.id}/run`}>View run →</Link>
            : <Link className="btn accent" to={`/collections/${c.id}/export`}>Export &amp; publish →</Link>}
          <HoldingToggle kind="collection" assetId={c.id} projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

export function Collections() {
  const nav = useNavigate();
  const { project: active, fileAsset } = useProject();
  const [items, setItems] = useState<Collection[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [params] = useSearchParams();
  const scope = useProjectScope(params.get('project'));
  const target = (scope ?? active).id;

  useEffect(() => {
    let live = true;
    api.listCollections().then((r) => { if (live) setItems(r.collections); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  // When scoped to a project, show only its filed collections (Provincia.res.collectionIds).
  const shown = scope && items ? items.filter((c) => scope.collectionIds.includes(c.id)) : items;

  return (
    <AppShell title="Collections">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <h1>Collections</h1>
            <div className="sub">Author a collection from your flows — vary an input across a supply, curate, then choose where it goes. Local until you publish.</div>
          </div>
          <div className="right"><button className="btn" onClick={() => setCreating((v) => !v)}><Ic name={creating ? 'x' : 'plus'} /> {creating ? 'Cancel' : 'new collection'}</button></div>
        </div>

        {scope && <ScopeBanner project={scope} noun="collections" />}

        {creating && <CreateForm onCreated={(c) => {
          // Creation-time filing (Decision 3): a new collection lands in the active project.
          fileAsset(active.id, 'collection', c.id);
          nav(c.status === 'draft' ? `/collections/${c.id}/garden` : `/collections/${c.id}`);
        }} />}

        {err && <div className="warn">Couldn’t load collections: {err}</div>}

        {shown === null && !err && (
          <div className="collgrid">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="collcard skel" />)}</div>
        )}

        {shown !== null && shown.length === 0 && !creating && (
          <div className="empty">
            <div className="t">{scope ? `No collections filed into ${scope.name} yet` : 'No collections yet'}</div>
            <div className="s">Start one — pick a flow, vary an input across a supply, and generate the set.</div>
            <button className="btn" onClick={() => setCreating(true)}><Ic name="plus" /> new collection</button>
          </div>
        )}

        {shown !== null && shown.length > 0 && (
          <div className="collgrid">{shown.map((c) => <Card key={c.id} c={c} projectId={target} />)}</div>
        )}
      </div></div>
    </AppShell>
  );
}
