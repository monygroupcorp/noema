import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, listAllCollections, type Collection, type CreateCollectionRequest, type Tractus } from '../lib/api';
import { COLL_STATUS_LABEL, collGlyph, collTile } from '../lib/collections';
import { useProject, useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';
import { HoldingToggle } from '../lib/HoldingToggle';

// Collections (editio) — the BUILD-rail surface listing the user's collections. Each is a hub
// (traits → run → curation → export). Creating one is a NAMING act, not a generation launch:
// it always creates a draft and spends nothing. The generative config (flow, supply, trait
// grid) starts from a working example and is authored onward on the hub / in the garden.

// ── The starting configuration a new collection is created with ───────────────────────────
// A collection created with no flow, no supply and no axis reads as unfinished rather than as
// something to author. So the create form seeds a MINIMAL WORKING configuration instead: one
// flow, one axis varying the `prompt` port over several complete prompts, and a supply of one
// piece per value. Fire it untouched and it produces pieces that differ.
//
// This is a starting point, never a rail. The seed is ordinary collection config on an ordinary
// draft — the same shape the traits garden writes via `patchCollectionDraft` — so every part of
// it (the flow, the axis, each value, the supply) is renamed, edited or deleted exactly like
// something the author added themselves. Nothing marks a collection, axis or value as seeded,
// and no client state keys off it.

// The canonical atomic text-to-image flow (hosted API, fixed cost, no pod dependency), which
// makes it the one seed that runs for any account without further setup.
export const SEED_MODUS_ID = 'modus.gpt-image';

// Complete, self-contained prompts — each stands alone as the whole `prompt` input, because the
// axis varies that port directly rather than contributing a fragment to an assembled prompt.
export const SEED_TRACTUS: Tractus[] = [
  {
    porta: 'prompt',
    label: 'Prompt',
    valores: [
      { value: 'a lone lighthouse at dusk, cinematic lighting', label: 'Lighthouse' },
      { value: 'a neon city street in the rain, long reflections', label: 'Neon street' },
      { value: 'a quiet forest clearing in morning mist', label: 'Forest clearing' },
      { value: 'an abstract geometric composition, bold flat colour', label: 'Abstract' },
      { value: 'a still life of fruit on a windowsill, warm afternoon light', label: 'Still life' },
    ],
  },
];

/** The create payload: the author's naming act plus the starting configuration above. */
export function buildCreateRequest(input: {
  nomen: string;
  descriptio?: string;
  reviewEnabled: boolean;
}): CreateCollectionRequest {
  const tractus = SEED_TRACTUS.map((a) => ({ ...a, valores: a.valores.map((v) => ({ ...v })) }));
  return {
    nomen: input.nomen,
    ...(input.descriptio ? { descriptio: input.descriptio } : {}),
    reviewEnabled: input.reviewEnabled,
    draft: true,
    modusId: SEED_MODUS_ID,
    tractus,
    // One piece per value on the smallest useful run.
    total: tractus[0].valores.length,
  };
}

// The create form: name + optional description + which project it lives in. Nothing else on the
// form — the flow, supply and trait grid arrive seeded and are authored afterwards in the garden.
function CreateForm({ onCreated }: { onCreated: (c: Collection, projectId: string) => void }) {
  const { project: active, projects } = useProject();
  const [nomen, setNomen] = useState('');
  const [descriptio, setDescriptio] = useState('');
  const [projectId, setProjectId] = useState(active.id);
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = nomen.trim().length > 0 && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      const { collection } = await api.createCollection(buildCreateRequest({
        nomen: nomen.trim(),
        descriptio: descriptio.trim(),
        reviewEnabled: review,
      }));
      onCreated(collection, projectId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setBusy(false);
    }
  }

  return (
    <div className="coll-create">
      <div className="cc-row">
        <label className="cc-field"><span>Name</span>
          <input className="cer-input" placeholder="untitled collection" value={nomen} onChange={(e) => setNomen(e.target.value)} /></label>
        <label className="cc-field"><span>Project</span>
          <select className="cer-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
      </div>
      <div className="cc-row">
        <label className="cc-field"><span>Description <em>(optional)</em></span>
          <input className="cer-input" placeholder="what is this set? (optional)" value={descriptio} onChange={(e) => setDescriptio(e.target.value)} /></label>
      </div>
      <div className="cc-foot">
        {/* Curation preference, not run config — it reads the same with or without a supply
            on screen, and it stays editable on the collection until it is fired. */}
        <label className="cc-check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Review each piece before it counts</label>
        <span className="cc-note">nothing is generated yet — it starts with an example flow and prompt axis, all editable</span>
        <button className="btn" disabled={!ready} onClick={submit}>{busy ? 'Creating…' : <>Create collection <Ic name="arrow-right" /></>}</button>
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
        {c.descriptio && <div className="coll-theme" title={c.descriptio} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descriptio}</div>}
        <div className="coll-theme mono">{c.modusId || 'no flow yet'}</div>
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
    listAllCollections().then((cs) => { if (live) setItems(cs); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
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

        {creating && <CreateForm onCreated={(c, projectId) => {
          // Creation-time filing (Decision 3): a new collection lands in the project the
          // creator picked (defaulting to the active one). Client-side — Provincia owns the
          // asset↔project relationship; there is no server-side filing on create.
          fileAsset(projectId, 'collection', c.id);
          // Always land on the hub: it is where the next step (flow + traits, with the
          // concierge offered) lives.
          nav(`/collections/${c.id}`);
        }} />}

        {err && <div className="warn">Couldn’t load collections: {err}</div>}

        {shown === null && !err && (
          <div className="collgrid">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="collcard skel" />)}</div>
        )}

        {shown !== null && shown.length === 0 && !creating && (
          <div className="empty">
            <div className="t">{scope ? `No collections filed into ${scope.name} yet` : 'No collections yet'}</div>
            <div className="s">Name one — it costs nothing. You pick the flow and the traits afterwards.</div>
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
