import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type ModelCard, type CatalogSort } from '../lib/api';
import { useProject, useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';
import { HoldingToggle } from '../lib/HoldingToggle';
import { publishNote, publishOutcome } from '../lib/editio';

// The models page, in two surfaces:
//   1. the SHELF (train-shelf-spec.md) — the caller's own trained + imported models, from
//      GET /v1/me/models. Cards show real provenance (base model, trigger, license, listing
//      state). No earnings are shown, and the reason is a READ gap, not a missing feature:
//      `ledger/hooks/modelRoyalty.ts` does split a share of every run's spend across a published
//      model's rights holders, but nothing serves an earner their accrued total, so there is
//      nothing to render. The shelf reflects only what the backend will actually answer for.
//   2. the CATALOG — everything the platform publicly carries, from GET /v1/models, browsable
//      and sortable, collapsed by default and fetched only once expanded (the catalog grows;
//      an unconditional fetch on every visit is waste). Catalog cards are read-only.

// Deterministic tile gradient from the model id — distinct-looking cards without
// inventing per-model artwork the backend doesn't have.
function tileBg(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 40) % 360;
  return `linear-gradient(135deg, hsl(${a} 38% 22%), hsl(${b} 44% 15%))`;
}

const COMMERCIAL_LABEL: Record<NonNullable<ModelCard['commercialUse']>, string> = {
  yes: 'commercial ok',
  no: 'non-commercial',
  conditional: 'conditional',
  unknown: 'license unknown',
};

// "Use in a flow" (noema-062) used to hand the model's own Intella id straight to the
// flow-run screen — but no flow document exists for an imported model, so it always 404'd
// (`import-<hash>` was never a real flow id). Per the operator's redefinition, the button
// now navigates to the SIMPLEST existing text-to-image card for the model's base family
// (`m.basis`, aka `familia`), with the model's trigger word pre-included in the prompt via
// a query param Card.tsx reads on load. Table sourced from src/crystal/seeds/essentiae.ts —
// every familia value `classifyBaseModel` (src/crystal/modelLicense.ts) can actually
// produce, mapped to its canonical plain-text2img essentia id.
export const BASE_CARD_ID_BY_FAMILIA: Record<string, string> = {
  flux2: 'klein',
  flux: 'flux-schnell',
  sdxl: 'sdxl',
  sd15: 'sd1-5',
  chroma: 'chroma',
  krea2: 'krea-turbo',
  zimage: 'z-image-turbo',
};

// Resolve the "Use in a flow" link target for a model card. Falls back to the plain
// flux-schnell card (no prompt/loraName params) when the model's `basis` doesn't match a
// known familia — keeps the button functional without ever sending the user back into the
// dead `import-<hash>` flow-id 404.
export function resolveUseInFlowTarget(m: Pick<ModelCard, 'basis' | 'trigger' | 'nomen'>): string {
  const baseCardId = (m.basis && BASE_CARD_ID_BY_FAMILIA[m.basis]) || 'flux-schnell';
  if (!m.basis || !BASE_CARD_ID_BY_FAMILIA[m.basis]) return `/card?id=${baseCardId}`;
  const q = new URLSearchParams();
  if (m.trigger) q.set('prompt', m.trigger);
  if (m.nomen) q.set('loraName', m.nomen);
  const qs = q.toString();
  return qs ? `/card?id=${baseCardId}&${qs}` : `/card?id=${baseCardId}`;
}

// Sentinel for the "no base family recorded" facet bucket. `basis` is optional on a ModelCard
// (it is emitted only when the model carries a `familia`), so an explicit bucket keeps those
// entries reachable instead of vanishing whenever a basis filter is active.
export const BASIS_UNSPECIFIED = '~unspecified';

// Facet options are derived from the RESULT SET, never hardcoded — coverage of `basis` changes
// as the catalog does, in both directions, so a fixed family list would go wrong either way.
export function catalogGenera(models: ModelCard[]): string[] {
  return Array.from(new Set(models.map((m) => m.genus).filter(Boolean))).sort();
}

export function catalogBases(models: ModelCard[]): string[] {
  const named = Array.from(new Set(models.map((m) => m.basis).filter((b): b is string => !!b))).sort();
  return models.some((m) => !m.basis) ? [...named, BASIS_UNSPECIFIED] : named;
}

// Client-side facet narrowing over the fetched catalog page. 'all' clears an axis.
export function applyCatalogFilters(models: ModelCard[], genus: string, basis: string): ModelCard[] {
  return models.filter(
    (m) =>
      (genus === 'all' || m.genus === genus) &&
      (basis === 'all' || (basis === BASIS_UNSPECIFIED ? !m.basis : m.basis === basis))
  );
}

const SORT_LABELS: { key: CatalogSort; label: string }[] = [
  { key: 'newest', label: 'newest' },
  { key: 'name', label: 'name' },
];

export function Shelf() {
  const { project: active, fileAsset } = useProject();
  const [models, setModels] = useState<ModelCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Import-by-URL panel state (POST /v1/models/import).
  const [showImport, setShowImport] = useState(false);
  const [url, setUrl] = useState('');
  const [genus, setGenus] = useState<'lora' | 'model'>('lora');
  const [imp, setImp] = useState<{ s: 'idle' | 'busy' | 'err'; msg?: string }>({ s: 'idle' });

  // Platform admins get a per-model license reclassify control (PUT /v1/models/:id/license).
  const [admin, setAdmin] = useState(false);
  const [licBusy, setLicBusy] = useState<string | null>(null);

  // Publish (POST /v1/editiones) — makes a private model listed + royalty-eligible. Per-model
  // state since several cards can be mid-publish at once. A publish settles asynchronously
  // (PublicationWorker; HF weight upload can take a while), so 'pending' is a real, honest
  // terminal state here, not a placeholder for 'done' — we poll briefly and stop rather than
  // claim success before the edition actually lands. 'held' is a DISTINCT state from 'pending':
  // the moderation gate escalated this publish to a human reviewer (reviewOutcome:'pending')
  // rather than leaving it genuinely still-settling — conflating the two left the button stuck
  // on a bare "publishing…" forever, indistinguishable from a hang (publish-review-visibility
  // spec, Gap A).
  // 'refused' is likewise distinct from 'err': the gate declined this model, which is terminal
  // and carries a reason, whereas 'err' is an adapter/network failure worth retrying. Offering
  // "publish failed — retry" for a refusal sends the publisher round a loop that cannot ever
  // succeed and never tells them why (moderation-reject-reason spec, §3(a) author surface).
  // `note` carries the server's author-safe reason for a 'held' or 'refused' item.
  type PubState = { s: 'busy' | 'pending' | 'held' | 'refused' | 'err'; note?: string };
  const [pubState, setPubState] = useState<Record<string, PubState>>({});

  // The global catalog surface (GET /v1/models) — collapsed until asked for.
  const [catOpen, setCatOpen] = useState(false);
  const [catalog, setCatalog] = useState<ModelCard[] | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [catSort, setCatSort] = useState<CatalogSort>('newest');
  const [catGenus, setCatGenus] = useState('all');
  const [catBasis, setCatBasis] = useState('all');

  useEffect(() => {
    let live = true;
    api.listMyModels()
      .then((r) => { if (live) setModels(r.models); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    api.getMe().then((me) => { if (live) setAdmin(!!me.admin); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Lazy catalog load: nothing is fetched until the section is first expanded, then again
  // whenever the sort changes — the ordering is applied server-side, before any limit slice.
  useEffect(() => {
    if (!catOpen) return;
    let live = true;
    setCatErr(null);
    api.listModels({ sort: catSort })
      .then((r) => { if (live) setCatalog(r.models); })
      .catch((e) => { if (live) setCatErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [catOpen, catSort]);

  async function reclassify(id: string) {
    setLicBusy(id);
    try {
      const { model } = await api.setModelLicense(id, { reclassify: true });
      setModels((cur) => (cur ?? []).map((m) => (m.intellaId === id ? model : m)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLicBusy(null); }
  }

  // Publish a private model — HuggingFace is the only registry with a real uploader wired
  // (civitai has no public write API; ModelPublishAdapter projects a handle only there).
  // 'unlisted' (not 'private') is what actually flips the model to listed: the access
  // reconciler (CrystalApi._reconcile) only sets access:'public' when visibility !== 'private'.
  async function publishModel(id: string) {
    setPubState((s) => ({ ...s, [id]: { s: 'busy' } }));
    try {
      const { edition } = await api.publish({
        artifact: { kind: 'intella', id },
        destination: 'huggingface',
        visibility: 'unlisted',
        custody: 'ours',
      });
      if (edition.status === 'published') {
        setModels((cur) => (cur ?? []).map((m) => (m.intellaId === id ? { ...m, access: 'public' } : m)));
        setPubState((s) => { const n = { ...s }; delete n[id]; return n; });
        return;
      }
      // A permissive/synchronous gate can refuse before the first poll ever runs.
      if (publishOutcome(edition) === 'refused') {
        setPubState((s) => ({ ...s, [id]: { s: 'refused', note: publishNote(edition) } }));
        return;
      }
      setPubState((s) => ({ ...s, [id]: { s: 'pending' } }));
      // Brief bounded poll — the worker settles this async (HF weight upload can take a
      // while). Stop and leave it as an honest 'pending' rather than hang indefinitely;
      // the badge catches up on the model's next natural load either way.
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { edition: polled } = await api.getEdition(edition.id);
        const outcome = publishOutcome(polled);
        if (outcome === 'live') {
          setModels((cur) => (cur ?? []).map((m) => (m.intellaId === id ? { ...m, access: 'public' } : m)));
          setPubState((s) => { const n = { ...s }; delete n[id]; return n; });
          return;
        }
        // Terminal refusal — say so, with the reason, and take the retry away.
        if (outcome === 'refused') {
          setPubState((s) => ({ ...s, [id]: { s: 'refused', note: publishNote(polled) } }));
          return;
        }
        if (outcome === 'failed') {
          setPubState((s) => ({ ...s, [id]: { s: 'err' } }));
          return;
        }
        // A HELD item stays status:'pending' through every poll — reviewOutcome is the
        // separate axis that says why. Without this branch the loop just exhausts silently:
        // the button is left reading "publishing…" forever, with no way to tell a HOLD
        // apart from a hang. Stop polling — an admin approval settles it, it never resolves
        // on its own.
        if (outcome === 'held') {
          setPubState((s) => ({ ...s, [id]: { s: 'held', note: publishNote(polled) } }));
          return;
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPubState((s) => ({ ...s, [id]: { s: 'err' } }));
    }
  }

  async function doImport() {
    if (!url.trim()) return;
    setImp({ s: 'busy' });
    try {
      const { model } = await api.importModel({ url: url.trim(), genus });
      setModels((cur) => [model, ...(cur ?? [])]);
      // Creation-time filing (Decision 3): a freshly imported model lands in the active project.
      fileAsset(active.id, 'model', model.intellaId);
      setUrl(''); setImp({ s: 'idle' }); setShowImport(false);
    } catch (e) {
      setImp({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  const [params] = useSearchParams();
  const scope = useProjectScope(params.get('project'));
  const target = (scope ?? active).id;
  // When scoped to a project, show only its filed models (Provincia.modelIds). The scope is a
  // property of YOUR shelf — it never narrows the global catalog below.
  const shown = scope && models ? models.filter((m) => scope.modelIds.includes(m.intellaId)) : models;
  const count = shown?.length ?? 0;

  const genusOptions = useMemo(() => catalogGenera(catalog ?? []), [catalog]);
  const basisOptions = useMemo(() => catalogBases(catalog ?? []), [catalog]);
  // A selected facet that the current result set no longer offers falls back to 'all' rather
  // than rendering an empty list. Fewer than two distinct bases = no basis control at all.
  const genusSel = genusOptions.includes(catGenus) ? catGenus : 'all';
  const basisSel = basisOptions.includes(catBasis) ? catBasis : 'all';
  const showBasisFilter = basisOptions.length >= 2;
  const catShown = useMemo(
    () => applyCatalogFilters(catalog ?? [], genusSel, showBasisFilter ? basisSel : 'all'),
    [catalog, genusSel, basisSel, showBasisFilter]
  );

  return (
    <AppShell title="Models">
      <div className="page"><div className="pw wide">
        <div className="pagehead shelf-head">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>
              {models ? `your models · ${count}` : 'loading…'}
              {catOpen && catalog && <> · public catalog · {catalog.length}</>}
            </div>
            <h1>Model shelf</h1>
            <div className="sub">What you’ve taught NOEMA — run them, turn them into collections, and publish them.</div>
          </div>
          <div className="shelf-right">
            <button className="btn ghost" onClick={() => setShowImport((v) => !v)}><Ic name="download" /> import by URL</button>
            <Link className="btn" to="/datasets"><Ic name="plus" /> new training</Link>
          </div>
        </div>

        {showImport && (
          <div className="noema-frame" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="sub">Import a model or LoRA by URL — a Civitai page, a HuggingFace repo, or a direct <span className="mono">.safetensors</span>. It lands here as private, usable in your flows at once.</div>
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <input
                className="inp mono"
                style={{ flex: '1 1 320px' }}
                placeholder="https://civitai.com/models/… · https://huggingface.co/… · https://…/weights.safetensors"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <select className="inp mono" style={{ maxWidth: 120 }} value={genus} onChange={(e) => setGenus(e.target.value as 'lora' | 'model')}>
                <option value="lora">lora</option>
                <option value="model">model</option>
              </select>
              <button className="btn accent" onClick={doImport} disabled={imp.s === 'busy' || !url.trim()}>
                {imp.s === 'busy' ? 'Importing…' : 'Import'}
              </button>
            </div>
            {imp.s === 'err' && <div className="warn">{imp.msg}</div>}
          </div>
        )}

        {/* The scope narrows YOUR shelf only — the catalog section below stays unscoped, so the
            noun says so rather than reading as though the whole page were filtered. */}
        {scope && <ScopeBanner project={scope} noun="your models" />}

        {err && <div className="warn">Couldn’t load your models — {err}</div>}
        {!models && !err && <div className="empty"><div className="t">Loading your models…</div></div>}
        {shown && shown.length === 0 && (
          <div className="empty">
            <div className="t">{scope ? `No models filed into ${scope.name} yet` : 'No models yet'}</div>
            <div className="s">Train a LoRA from a <Link to="/datasets">dataset</Link>, or import one by URL — it lands here.</div>
          </div>
        )}

        {shown && shown.length > 0 && (
          <div className="shelfgrid">
            {shown.map((m) => {
              const listed = m.access === 'public';
              const pub = pubState[m.intellaId];
              return (
                <div key={m.intellaId} className="modelcard">
                  <div className="mc-sample" style={{ background: tileBg(m.intellaId) }}>
                    {m.basis && <span className="mc-ver mono">{m.basis}</span>}
                    <span className={`mc-listed ${listed ? 'on' : 'priv'}`}>
                      {listed ? <><span className="rdot good" /> listed</> : <><Ic name="eye-off" /> private</>}
                    </span>
                  </div>
                  <div className="mc-body">
                    <div className="mc-title"><b>{m.nomen}</b><span className={`mc-kind ${m.genus}`}>{m.genus}</span></div>
                    <div className="mc-meta mono">
                      {m.basis ?? 'model'}
                      {m.trigger && <> · trigger <span className="accent">{m.trigger}</span></>}
                    </div>
                    {(m.license || m.commercialUse) && (
                      <div className="mc-meta mono">
                        {m.license && <span>{m.license}</span>}
                        {m.commercialUse && <> · {COMMERCIAL_LABEL[m.commercialUse]}</>}
                      </div>
                    )}
                    {m.description && <div className="mc-meta">{m.description}</div>}
                    <div className="mc-actions">
                      <Link className="btn ghost" to={resolveUseInFlowTarget(m)}>Use in a flow</Link>
                      <Link className="btn accent" to="/collections"><Ic name="hexagon" /> Collection</Link>
                      <HoldingToggle kind="model" assetId={m.intellaId} projectId={target} />
                      {!listed && pub?.s !== 'pending' && pub?.s !== 'held' && pub?.s !== 'refused' && (
                        <button
                          className="btn ghost"
                          onClick={() => publishModel(m.intellaId)}
                          disabled={pub?.s === 'busy'}
                          title="List this model publicly and make it eligible for royalty when others use it"
                        >
                          {pub?.s === 'busy' ? 'publishing…' : pub?.s === 'err' ? 'publish failed — retry' : 'Publish'}
                        </button>
                      )}
                      {!listed && pub?.s === 'pending' && (
                        <span className="mc-meta mono" title="Still settling — this can take a few minutes for weight upload">publishing…</span>
                      )}
                      {!listed && pub?.s === 'held' && (
                        <span className="mc-meta mono" title="A moderator needs to clear this before it can go live">
                          held for review · {pub.note}
                          {admin && <> · <Link to="/admin/review">see admin/review</Link></>}
                        </span>
                      )}
                      {/* Terminal: no retry button, and the reason instead of a bare failure. */}
                      {!listed && pub?.s === 'refused' && (
                        <span className="pub-err mono">not published · {pub.note}</span>
                      )}
                      {admin && (
                        <button className="btn ghost" onClick={() => reclassify(m.intellaId)} disabled={licBusy === m.intellaId} title="Admin: re-derive license from the base model">
                          {licBusy === m.intellaId ? 'reclassifying…' : 'reclassify license'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── The global catalog ─────────────────────────────────────────────────
            Everything the platform publicly carries — platform-seeded models and models
            users have published. Read-only here: no reclassify, no filing, no import. */}
        <div className="pagehead" style={{ marginTop: 'var(--s6)' }}>
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>the whole platform</div>
            <h2>Browse the catalog</h2>
            <div className="sub">Every model NOEMA publicly carries — seeded and user-published alike.</div>
          </div>
          <button className="btn ghost" onClick={() => setCatOpen((v) => !v)} aria-expanded={catOpen}>
            <Ic name={catOpen ? 'eye-off' : 'search'} /> {catOpen ? 'hide catalog' : 'browse catalog'}
          </button>
        </div>

        {catOpen && (
          <>
            <div className="cat-toolbar">
              <div className="cat-filters">
                <button className={`cat-chip${genusSel === 'all' ? ' on' : ''}`} onClick={() => setCatGenus('all')}>All</button>
                {genusOptions.map((g) => (
                  <button key={g} className={`cat-chip${genusSel === g ? ' on' : ''}`} onClick={() => setCatGenus(g)}>{g}</button>
                ))}
              </div>
              <div className="cat-sort">
                sort{' '}
                {SORT_LABELS.map((s) => (
                  <button key={s.key} className={`cat-chip${catSort === s.key ? ' on' : ''}`} onClick={() => setCatSort(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {showBasisFilter && (
              <div className="cat-toolbar cat-verbs">
                <div className="cat-filters">
                  <button className={`cat-chip${basisSel === 'all' ? ' on' : ''}`} onClick={() => setCatBasis('all')}>All bases</button>
                  {basisOptions.map((b) => (
                    <button key={b} className={`cat-chip${basisSel === b ? ' on' : ''}`} onClick={() => setCatBasis(b)}>
                      {b === BASIS_UNSPECIFIED ? 'unspecified' : b}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {catErr && <div className="warn">Couldn’t load the catalog — {catErr}</div>}
            {!catalog && !catErr && <div className="empty"><div className="t">Loading the catalog…</div></div>}
            {catalog && catShown.length === 0 && <div className="empty"><div className="t">No models match.</div></div>}

            {catShown.length > 0 && (
              <div className="shelfgrid">
                {catShown.map((m) => (
                  <div key={m.intellaId} className="modelcard">
                    <div className="mc-sample" style={{ background: tileBg(m.intellaId) }}>
                      {m.basis && <span className="mc-ver mono">{m.basis}</span>}
                    </div>
                    <div className="mc-body">
                      <div className="mc-title"><b>{m.nomen}</b><span className={`mc-kind ${m.genus}`}>{m.genus}</span></div>
                      <div className="mc-meta mono">
                        {m.basis ?? 'model'}
                        {m.trigger && <> · trigger <span className="accent">{m.trigger}</span></>}
                      </div>
                      {m.description && <div className="mc-meta">{m.description}</div>}
                      <div className="mc-actions">
                        <Link className="btn ghost" to={resolveUseInFlowTarget(m)}>Use in a flow</Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {catalog && catShown.length > 0 && (
              <div className="foot">showing {catShown.length.toLocaleString()} of {catalog.length.toLocaleString()}</div>
            )}
          </>
        )}
      </div></div>
    </AppShell>
  );
}
