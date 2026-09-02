import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { READINESS, MODALITY_TOKEN, custodyGlyph, CUSTODY_LABEL, type Readiness } from '../lib/datasets';
import { api, type Dataset, type DatasetModality, type Vestigium } from '../lib/api';
import { useProject, useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';
import { HoldingToggle } from '../lib/HoldingToggle';
import { liveRecords } from '../lib/muse';

const MODALITIES: DatasetModality[] = ['image', 'video', 'audio', '3d'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Upload a file to R2 via the signed-PUT path, return its permanent public URL
// (same two-step contract Profile.tsx uses for avatar/banner/background uploads).
async function uploadAsset(file: File): Promise<string> {
  const { signedUrl, permanentUrl } = await api.signUpload({ filename: file.name, contentType: file.type });
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return permanentUrl;
}

// Datasets library (train-datasets-library-spec.md, render noema-train-datasets-library.png) —
// the entry to the training stack: a recognizable shelf of raw material with each set's own
// facts + a readiness line that names the next action. No downstream counts (datasets are
// inputs, not scoreboards). Imagery is earned here (personal assets, unlike the Registry).

/** Coarse "time ago" for `Dataset.mutatum` — mirrors the mock's `updated` field's grain. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

// The backend doesn't persist a `readiness` enum (Q1's rich shape is custody/modality/
// captionsets/versions only) — derive the same three states from live data instead.
function readinessOf(d: Dataset): Readiness {
  // Over the working set: a set whose every image has been archived is thin again.
  if (liveRecords(d.media).length === 0) return 'thin';
  if (d.captionsets.length === 0) return 'needs-captioning';
  return 'ready';
}

const TILE_FALLBACK = ['#2b3a5e', '#324063', '#2f5d56', '#33406b'];

export function Datasets() {
  const [params] = useSearchParams();
  const { project: active } = useProject();
  const scope = useProjectScope(params.get('project'));
  // File actions target the scoped project (on a ?project= surface) else the active one.
  const target = (scope ?? active).id;
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);

  const refetch = () => api.listDatasetsFull().then(({ datasets: d }) => setDatasets(d)).catch(() => setDatasets([]));

  useEffect(() => {
    let live = true;
    api.listDatasetsFull()
      .then(({ datasets: d }) => { if (live) setDatasets(d); })
      .catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);

  // The public catalog (GET /v1/data/datasets/public) — collapsed until asked for, mirroring
  // Shelf.tsx's "your shelf" + "browse the catalog" split: this list above is YOUR OWN
  // datasets, this one is everything the platform publishes for anyone to start Muse-ing on.
  const [catOpen, setCatOpen] = useState(false);
  const [catalog, setCatalog] = useState<Dataset[] | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);

  useEffect(() => {
    if (!catOpen || catalog !== null) return;
    let live = true;
    api.listPublicDatasets()
      .then(({ datasets: d }) => { if (live) setCatalog(d); })
      .catch((e) => { if (live) setCatErr(msg(e)); });
    return () => { live = false; };
  }, [catOpen, catalog]);

  // An archived set is simply not here. The list route already excludes it server-side; this
  // filter is what holds when a record on this screen is archived after it was fetched, so the
  // shelf never keeps a card for a set that has left it (noema-267).
  const all = liveRecords(datasets ?? []);
  // When scoped to a project, show only its filed datasets (Provincia.datasetIds).
  const list = scope ? all.filter((d) => scope.datasetIds.includes(d.id)) : all;

  // ── New-dataset creation (both v1 ingestion paths — Q2/apiContract.ts
  // CreateDatasetRequestSchema: source 'upload' | 'generation', exactly one shape). ──
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'upload' | 'generation'>('upload');
  const [name, setName] = useState('');
  const [modality, setModality] = useState<DatasetModality>('image');
  const [files, setFiles] = useState<File[]>([]);
  const [vestigia, setVestigia] = useState<Vestigium[] | null>(null);
  const [pickedActa, setPickedActa] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openModal = () => {
    setOpen(true); setSource('upload'); setName(''); setModality('image');
    setFiles([]); setPickedActa(new Set()); setErr(null);
    if (vestigia === null) api.listVestigia(100).then((r) => setVestigia(r.vestigia)).catch(() => setVestigia([]));
  };
  const closeModal = () => { if (!busy) setOpen(false); };

  const toggleActum = (actumId: string) => setPickedActa((cur) => {
    const next = new Set(cur);
    if (next.has(actumId)) next.delete(actumId); else next.add(actumId);
    return next;
  });

  async function submitCreate() {
    if (!name.trim()) { setErr('name the dataset first'); return; }
    setBusy(true); setErr(null);
    try {
      if (source === 'upload') {
        if (files.length === 0) throw new Error('drop at least one file');
        const mediaUrls = await Promise.all(files.map(uploadAsset));
        await api.createDataset({ source: 'upload', name: name.trim(), modality, mediaUrls });
      } else {
        const actumIds = Array.from(pickedActa);
        if (actumIds.length === 0) throw new Error('pick at least one generation');
        await api.createDataset({ source: 'generation', name: name.trim(), modality, actumIds });
      }
      await refetch();
      setOpen(false);
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  }

  // Generation-seed picker: the caller's own traces that resolved to a completed Actum
  // (Vestigium.actumId), scoped to the chosen modality's genus.
  const eligibleActa = (vestigia ?? []).filter((v) => v.actumId && v.genus === modality);

  return (
    <AppShell title="Datasets">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <h1>Datasets</h1>
            <div className="sub">Your raw material — the core every model is trained from. Reusable, versioned, captioned many ways.</div>
          </div>
          <div className="right"><button className="btn" onClick={openModal}><Ic name="plus" /> new dataset</button></div>
        </div>

        {scope && <ScopeBanner project={scope} noun="datasets" />}

        <div className="dsgrid">
          {list.map((d) => {
            const readiness = readinessOf(d);
            const r = READINESS[readiness];
            const version = d.versions[d.versions.length - 1]?.v ?? '—';
            const media = liveRecords(d.media);
            const hasMedia = media.length > 0;
            const tiles = hasMedia ? media.slice(0, 4).map((m) => m.url) : TILE_FALLBACK;
            return (
              <Link key={d.id} className="dscard" to={`/datasets/${d.id}`}>
                <div className="ds-mosaic">
                  {tiles.map((t, i) => (
                    <span key={i} style={hasMedia ? { backgroundImage: `url(${t})`, backgroundSize: 'cover' } : { background: t }} />
                  ))}
                </div>
                <div className="ds-body">
                  <div className="ds-title">
                    <b>{d.name}</b>
                    <span className="ds-badge" style={{ color: MODALITY_TOKEN[d.modality] }}><span className="dot" style={{ background: MODALITY_TOKEN[d.modality] }} /> {d.modality}</span>
                    <span className={`hemi2 ${custodyGlyph(d.custody)} ds-cust`} title={CUSTODY_LABEL[d.custody]} />
                  </div>
                  <div className="ds-stats mono">{media.length} {d.modality === 'video' ? 'clips' : 'images'} · {d.captionsets.length} captionsets · {version}</div>
                  <div className="ds-meta mono">updated {relativeTime(d.mutatum)} · <span className={`hemi2 ${custodyGlyph(d.custody)}`} /> {CUSTODY_LABEL[d.custody]}</div>
                  <div className="ds-ready">
                    <span className="ds-state"><span className={`rdot ${r.dot}`} /> {r.label}</span>
                    <span className="ds-action">{r.action}</span>
                  </div>
                  <div className="ds-file"><HoldingToggle kind="dataset" assetId={d.id} projectId={target} /></div>
                </div>
              </Link>
            );
          })}
          <button className="dscard new" onClick={openModal}>
            <Ic name="plus" />
            <div className="t">new dataset</div>
            <div className="s mono">drop media · or seed from a generation</div>
          </button>
        </div>

        {/* ── The public catalog ───────────────────────────────────────────────
            Datasets NOEMA (or another member) has published — no set-up needed to try one.
            Each card goes straight into a Muse session, not the detail page: the fastest path
            onto the fun part, with nothing here that isn't yours to click. */}
        <div className="pagehead" style={{ marginTop: 'var(--s6)' }}>
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>no set of your own yet?</div>
            <h2>Browse the catalog</h2>
            <div className="sub">Published boards, ready to Muse on right now.</div>
          </div>
          <button className="btn ghost" onClick={() => setCatOpen((v) => !v)} aria-expanded={catOpen}>
            <Ic name={catOpen ? 'eye-off' : 'search'} /> {catOpen ? 'hide catalog' : 'browse catalog'}
          </button>
        </div>

        {catOpen && (
          <>
            {catErr && <div className="warn">Couldn’t load the catalog — {catErr}</div>}
            {!catalog && !catErr && <div className="empty"><div className="t">Loading the catalog…</div></div>}
            {catalog && catalog.length === 0 && <div className="empty"><div className="t">Nothing published yet.</div></div>}

            {catalog && catalog.length > 0 && (
              <div className="dsgrid">
                {catalog.map((d) => {
                  const media = liveRecords(d.media);
                  const hasMedia = media.length > 0;
                  const tiles = hasMedia ? media.slice(0, 4).map((m) => m.url) : TILE_FALLBACK;
                  return (
                    <Link key={d.id} className="dscard" to={`/datasets/${d.id}/muse`}>
                      <div className="ds-mosaic">
                        {tiles.map((t, i) => (
                          <span key={i} style={hasMedia ? { backgroundImage: `url(${t})`, backgroundSize: 'cover' } : { background: t }} />
                        ))}
                      </div>
                      <div className="ds-body">
                        <div className="ds-title">
                          <b>{d.name}</b>
                          <span className="ds-badge" style={{ color: MODALITY_TOKEN[d.modality] }}><span className="dot" style={{ background: MODALITY_TOKEN[d.modality] }} /> {d.modality}</span>
                        </div>
                        <div className="ds-stats mono">{media.length} {d.modality === 'video' ? 'clips' : 'images'}</div>
                        <div className="ds-ready">
                          <span className="ds-action">muse on this →</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {open && (
          <div className="modal-scrim" onClick={closeModal}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--panel)', border: '1px solid var(--hair)', borderRadius: 14,
                padding: 20, width: 'min(520px, 100%)', maxHeight: '86vh', overflowY: 'auto',
              }}
            >

              <input
                className="train-data" style={{ resize: 'none', marginBottom: 10 }}
                placeholder="dataset name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
              />

              <div className="seg custody-seg" style={{ marginBottom: 10 }}>
                {MODALITIES.map((m) => (
                  <button key={m} className={modality === m ? 'on' : ''} disabled={busy} onClick={() => setModality(m)}>{m}</button>
                ))}
              </div>

              <div className="seg custody-seg" style={{ marginBottom: 14 }}>
                <button className={source === 'upload' ? 'on' : ''} disabled={busy} onClick={() => setSource('upload')}>drop media</button>
                <button className={source === 'generation' ? 'on' : ''} disabled={busy} onClick={() => setSource('generation')}>from a generation</button>
              </div>

              {source === 'upload' ? (
                <div>
                  <input
                    type="file" multiple accept="image/*,video/*,audio/*" disabled={busy}
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                  {files.length > 0 && <div className="sub mono" style={{ marginTop: 8 }}>{files.length} file{files.length === 1 ? '' : 's'} selected</div>}
                </div>
              ) : (
                <div>
                  {vestigia === null ? (
                    <div className="sub mono">loading your generations…</div>
                  ) : eligibleActa.length === 0 ? (
                    <div className="sub mono">no completed {modality} generations to seed from yet.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                      {eligibleActa.map((v) => (
                        <button
                          key={v.id} disabled={busy}
                          onClick={() => toggleActum(v.actumId as string)}
                          title={v.promptum}
                          style={{
                            aspectRatio: '1', borderRadius: 8, border: pickedActa.has(v.actumId as string) ? '2px solid var(--accent)' : '1px solid var(--hair)',
                            background: v.imagoUrl ? `url(${v.imagoUrl}) center/cover` : 'var(--bg)', padding: 0, cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {pickedActa.size > 0 && <div className="sub mono" style={{ marginTop: 8 }}>{pickedActa.size} selected</div>}
                </div>
              )}

              {err && <div className="sub" style={{ color: 'var(--danger, #d66f6f)', marginTop: 10 }}>{err}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn ghost" disabled={busy} onClick={closeModal}>cancel</button>
                <button className="btn accent" disabled={busy} onClick={submitCreate}>{busy ? 'creating…' : 'create'}</button>
              </div>
            </div>
          </div>
        )}
      </div></div>
    </AppShell>
  );
}
