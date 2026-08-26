import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { custodyGlyph } from '../lib/datasets';
import { api, type Dataset } from '../lib/api';
import { captionsToTrainingImages } from '../lib/captionsets';
import {
  BASE_MODELS,
  buildTrainingAffinesPayload,
  hydrateTrainingAffines,
  launchTraining,
  TRAINING_MODUS_ID,
} from '../lib/training';

// Derive a training (train-derive-spec.md, render noema-train-derive.png) — the recipe:
// pick captionset (the lesson) + base + trigger + steps → fire. One dataset, many models.
//
// Everything here is live: the dataset and its captionsets come from
// `GET /v1/data/datasets/full`, and "Begin training" is a real `modus.aitoolkit-training` run
// through `launchTraining`, which lands on the run monitor with that run's id.
//
// `autocaption` is FALSE on this path by construction: the point of the screen is that the user
// chooses which caption pass the model learns from, and the trainer's own captioner would
// overwrite exactly that choice.
//
// `baseModel`/`trigger`/`steps` persist across visits as the caller's per-modus affines
// (noema-330): hydrated on mount, written back debounced on change. `chosenSet` stays
// session-local — it is dataset-contextual (which captionset is newest), not a preference.

const AFFINES_SAVE_DEBOUNCE_MS = 1500;

export function Derive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [chosenSet, setChosenSet] = useState<string | null>(null);
  const [baseModel, setBaseModel] = useState(BASE_MODELS[0].id);
  const [trigger, setTrigger] = useState('');
  const [steps, setSteps] = useState(1000);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The caller's last-known affines record, kept so a write-through merges onto it rather
  // than clobbering keys another surface may have stored under this modus (setAffines
  // replaces the whole map). Populated once hydrate resolves.
  const affinesRef = useRef<Record<string, unknown> | null>(null);
  const [affinesHydrated, setAffinesHydrated] = useState(false);
  const skipNextAffinesSave = useRef(true);
  const affinesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    api.listDatasetsFull().then(({ datasets: ds }) => { if (live) setDatasets(ds); }).catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);

  // Hydrate the training form from the caller's stored affines once, on mount.
  useEffect(() => {
    let live = true;
    api.getAffines(TRAINING_MODUS_ID).then(({ affines }) => {
      if (!live) return;
      affinesRef.current = affines;
      const values = hydrateTrainingAffines(affines);
      setBaseModel(values.baseModel);
      setSteps(values.steps);
      setTrigger(values.trigger);
    }).catch(() => { /* no stored preference (or unreachable) — form keeps today's defaults */ })
      .finally(() => { if (live) setAffinesHydrated(true); });
    return () => { live = false; };
  }, []);

  // Write-through, debounced: any change to baseModel/steps/trigger after hydrate persists as
  // the caller's next-time default. Never blocks the launch button; a failed save is silent
  // and simply retried on the next change rather than surfaced as an error. Gated on
  // `affinesHydrated` so the setState calls hydrate itself makes don't immediately re-save.
  useEffect(() => {
    if (!affinesHydrated) return;
    if (skipNextAffinesSave.current) { skipNextAffinesSave.current = false; return; }
    if (affinesSaveTimer.current) clearTimeout(affinesSaveTimer.current);
    affinesSaveTimer.current = setTimeout(() => {
      const payload = buildTrainingAffinesPayload(affinesRef.current, { baseModel, steps, trigger });
      api.setAffines(TRAINING_MODUS_ID, payload)
        .then(({ affines }) => { affinesRef.current = affines; })
        .catch(() => { /* silent — the next change retries */ });
    }, AFFINES_SAVE_DEBOUNCE_MS);
    return () => { if (affinesSaveTimer.current) clearTimeout(affinesSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseModel, steps, trigger, affinesHydrated]);

  const d = (datasets ?? []).find((x) => x.id === id);

  // Seed the chosen captionset once the record resolves (newest pass); the choice is the
  // user's from then on — this picker is the screen's whole thesis.
  useEffect(() => {
    if (d && chosenSet === null && d.captionsets.length > 0) setChosenSet(d.captionsets[d.captionsets.length - 1].id);
  }, [d, chosenSet]);

  const images = useMemo(
    () => (d && chosenSet ? captionsToTrainingImages(d, chosenSet) : []),
    [d, chosenSet],
  );

  if (datasets === null) {
    return <AppShell title="Derive"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Derive">
        <div className="page"><div className="pw wide"><div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div></div></div>
      </AppShell>
    );
  }
  const version = d.versions[d.versions.length - 1]?.v ?? '—';
  const cap = d.captionsets.find((cs) => cs.id === chosenSet) ?? null;
  const dropped = d.media.length - images.length;
  const canFire = images.length > 0 && trigger.trim() !== '' && steps > 0 && !launching;

  const begin = async () => {
    if (!canFire || !cap) return;
    const word = trigger.trim();
    const droppedNote = dropped > 0
      ? `\n${dropped} of ${d.media.length} have no caption in “${cap.name}” and are left out.`
      : '';
    if (!window.confirm(`Train a LoRA on ${images.length} captioned ${images.length === 1 ? 'image' : 'images'} (trigger "${word}", ${steps} steps)?${droppedNote}\n\nThis launches real GPU compute.`)) return;
    setLaunching(true); setError(null);
    try {
      // autocaption stays false: the chosen captionset IS the lesson.
      const run = await launchTraining({ images, triggerWord: word, baseModel, steps, autocaption: false });
      navigate(`/train/run/${run.id}`);
    } catch (e) {
      setError(`couldn't start training: ${String((e as Error).message).slice(0, 160)}`);
      setLaunching(false);
    }
  };

  const crumb = <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <Link to={`/datasets/${d.id}`}>{d.name}</Link> <span className="sep">/</span> <b>train</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1 className="dv-name">{d.name} · LoRA</h1></div>
        </div>

        {/* source */}
        <div className="dv-source">
          <div className="dv-srow">
            <span className="dv-sl">dataset</span>
            <span className="dv-sv"><b>{d.name}</b> <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span> · {version} · {d.media.length} {d.modality === 'video' ? 'clips' : 'images'}</span>
          </div>
          <div className="dv-srow">
            <span className="dv-sl">captionset</span>
            {d.captionsets.length === 0 ? (
              <span className="dv-sv">
                no captionset on this dataset yet — <Link className="lnk" to={`/datasets/${d.id}/caption`}>run a caption job</Link> first.
              </span>
            ) : (
              <span className="dv-sv">
                <span className={`hemi2 ${custodyGlyph(d.custody)}`} />{' '}
                <select className="inp" value={chosenSet ?? ''} onChange={(e) => setChosenSet(e.target.value)}>
                  {d.captionsets.map((cs) => (
                    <option key={cs.id} value={cs.id}>{cs.name} · {cs.method} · {cs.coverage}</option>
                  ))}
                </select>
              </span>
            )}
          </div>
        </div>
        <p className="dv-note">↳ the captionset you pick changes what the model learns — same images, different lessons. derive again anytime; one dataset, many models.</p>

        {/* base + method */}
        <div className="dv-two">
          <div className="dv-panel">
            <div className="dv-pick">
              <div style={{ flex: 1 }}>
                <div className="dv-ps mono">base model</div>
                <select className="inp" value={baseModel} onChange={(e) => setBaseModel(e.target.value)}>
                  {BASE_MODELS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="dv-panel">
            <div className="dv-pick"><div><b>LoRA</b><div className="dv-ps mono">lightweight adapter</div></div></div>
            <div className="dv-params">
              <label className="dv-ps mono" style={{ display: 'block' }}>trigger word
                <input className="inp" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="the word that summons this subject" />
              </label>
              <label className="dv-ps mono" style={{ display: 'block', marginTop: 'var(--s2)' }}>steps
                <input className="inp" type="number" min={1} value={steps} onChange={(e) => setSteps(Math.max(1, Number(e.target.value) || 0))} />
              </label>
            </div>
          </div>
        </div>

        {/* what will actually be sent */}
        <p className="dv-note mono">
          {cap ? (
            <>training on <b>{images.length}</b> of {d.media.length} images — {dropped === 0
              ? <>every image has a caption in “{cap.name}”.</>
              : <>{dropped} {dropped === 1 ? 'has' : 'have'} no caption in “{cap.name}” and {dropped === 1 ? 'is' : 'are'} left out, so the trainer never captions over your choice.</>}</>
          ) : <>pick a captionset to see what will be sent.</>}
        </p>
        {error && <p className="dv-note mono" style={{ color: 'var(--red-500, #e5746a)' }}>{error}</p>}

        {/* footer */}
        <div className="dv-foot">
          <div className="dv-est mono">↳ lands on your model shelf when it finishes</div>
          <button className="btn accent lg" onClick={() => void begin()} disabled={!canFire}>
            {launching ? 'starting…' : 'Begin training →'}
          </button>
        </div>
      </div></div>
    </AppShell>
  );
}
