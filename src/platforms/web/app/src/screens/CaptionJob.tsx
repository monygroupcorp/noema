import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Dataset } from '../lib/api';
import { captionRunRequest } from '../lib/captionsets';
import { captionRunParam, uncaptionedCount, withCaptionRunParam } from '../lib/muse';
import { useRunStream } from '../lib/runStream';
import { Stageline } from '../components/RunStageline';

// Caption job (train-caption-job-spec.md, render noema-train-caption-job.png) — captioning is
// a compute offering you fire and watch fill: the pass runs on our compute, and every caption it
// lands is editable in place. Custody (the hemisphere) governs THIS job — the captioner reads
// your images, so where it runs is honest.
//
// The screen is live end to end: the dataset comes from `GET /v1/data/datasets/full`, the job is
// a normal metered run of `modus.dataset-caption` started through `launchCaptionJob`, and each
// edit is a `PATCH …/captionsets/:captionsetId/captions/:mediaId`. A caption pass writes its
// captionset back onto the dataset, so the dataset is re-read when the run goes terminal.
//
// noema-279 — A PASS EXTENDS THE CAPTIONSET IT WAS GIVEN. The captionset shown is the one the
// pass writes into, and the pass captions only the images that captionset does not already
// cover: adding two images to a set of thirty is a two-image pass, not a thirty-image one. A new
// captionset is what you want when a different captioner is going to produce it, and there is
// one, so minting is the explicit choice rather than the default — the control below is opt-in
// and is also the hand-authored route (an empty pass to write captions into yourself).
//
// The pass is WATCHED, not just awaited: it rides `useRunStream`, the same subscription every
// other run-watching surface uses, and draws the same stage readout. A caption pass spends its
// first minutes acquiring a pod and preparing it before a single caption can exist, and then
// reads every image one at a time — so the phases and the per-image count are the screen, not a
// status word standing in for them.
//
// noema-321 — the run id rides `?run=`. A launch writes it (replace, so back doesn't step
// through run states); a mount reads it back, so navigating away and returning re-attaches the
// watch instead of losing it. A `?run=` that 404s or belongs to someone else is validated once
// on mount and cleared rather than left to wedge the screen — `useRunStream`'s poll fallback
// treats a persistent 404 as "still pending", not as an error, so that check happens here.

export function CaptionJob() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search, setSearchParams] = useSearchParams();
  const [dataset, setDataset] = useState<Dataset | null | undefined>(undefined);   // undefined = loading
  const [name, setName] = useState('');
  const [runId, setRunId] = useState<string | null>(() => captionRunParam(search));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [activeSet, setActiveSet] = useState<string | null>(null);
  // Opt out of extending: mint a fresh captionset over the whole set instead. Off by default —
  // the ruling is that extending is what a caption pass does.
  const [freshSet, setFreshSet] = useState(false);
  const [editing, setEditing] = useState<{ mediaId: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const seeded = useRef(false);
  const mountRunChecked = useRef(false);

  const load = useCallback(async () => {
    if (!id) return null;
    const d = await api.getDatasetFull(id).catch(() => null);
    setDataset(d);
    return d;
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Seed the shown captionset from the record the first time it resolves. A `?captionset=` the
  // caller arrived with wins when the dataset actually carries it — that is the pass the dataset
  // screen had selected, and it is the one this pass would extend. Otherwise the newest.
  useEffect(() => {
    if (dataset && !seeded.current && dataset.captionsets.length > 0) {
      seeded.current = true;
      const asked = search.get('captionset');
      const named = asked && dataset.captionsets.some((cs) => cs.id === asked) ? asked : null;
      setActiveSet(named ?? dataset.captionsets[dataset.captionsets.length - 1].id);
    }
  }, [dataset, search]);

  // A `?run=` carried in on mount gets ONE validating fetch — a run this caller can no longer
  // see (stale, or someone else's; ownership is server-side) must clear rather than sit forever
  // in "starting the pass". Only the id present at mount is checked; a run started from THIS
  // screen via `start()` is already known good and never re-checked.
  useEffect(() => {
    if (mountRunChecked.current) return;
    mountRunChecked.current = true;
    const carried = runId;
    if (!carried) return;
    let live = true;
    api.getRun(carried).catch(() => {
      if (!live) return;
      setRunId(null);
      setSearchParams((prev) => withCaptionRunParam(prev, null), { replace: true });
      setMsg({ ok: false, text: 'that caption pass is gone or not yours' });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch the caption run. The pass writes its captionset onto the DATASET, so the result arrives
  // through a re-read of the record rather than through the run's own outputs.
  const stream = useRunStream(runId ?? undefined);
  const terminal = stream.terminal;

  useEffect(() => {
    if (!runId || terminal === null) return;
    if (terminal === 'failed') {
      setMsg({ ok: false, text: `caption job failed: ${stream.error ?? 'no reason reported'}` });
      return;
    }
    let live = true;
    void (async () => {
      const d = await load();
      if (!live) return;
      const written = typeof stream.exitus?.captionsetId === 'string' ? (stream.exitus.captionsetId as string) : null;
      if (written) setActiveSet(written);
      else if (d && d.captionsets.length > 0) setActiveSet(d.captionsets[d.captionsets.length - 1].id);
      setMsg({ ok: true, text: 'caption pass finished — review and edit below' });
    })();
    return () => { live = false; };
  }, [runId, terminal, stream.error, stream.exitus, load]);

  const start = async () => {
    if (!dataset || starting) return;
    if (dataset.media.length === 0) { setMsg({ ok: false, text: 'this dataset has no media to caption yet' }); return; }

    // What this pass would actually do, and what it would cost. Extending quotes the images the
    // shown pass does not cover; minting quotes the whole set. The server refuses an empty
    // extending pass before it reserves anything — this is the same fact, shown before the ask.
    const target = freshSet ? null : (dataset.captionsets.find((cs) => cs.id === activeSet)?.id ?? null);
    const n = target ? uncaptionedCount(dataset, target) : dataset.media.length;
    if (n === 0) {
      setMsg({ ok: false, text: 'every image in this captionset is already captioned — nothing for a pass to do' });
      return;
    }
    const what = target
      ? `Caption the ${n} uncaptioned ${n === 1 ? 'image' : 'images'} and add them to this captionset?`
      : `Caption all ${n} ${n === 1 ? 'image' : 'images'} into a new captionset?`;
    if (!window.confirm(`${what}\n\nThis launches real GPU compute.`)) return;

    setStarting(true); setMsg(null);
    try {
      const { run } = await api.createRun(captionRunRequest({ datasetId: dataset.id, name, captionsetId: target }));
      setRunId(run.id);
      setSearchParams((prev) => withCaptionRunParam(prev, run.id), { replace: true });
      setMsg({ ok: true, text: `caption job started · run ${run.id.slice(0, 8)}` });
    } catch (e) {
      setMsg({ ok: false, text: `couldn't start: ${String((e as Error).message).slice(0, 160)}` });
    } finally { setStarting(false); }
  };

  const saveCaption = async () => {
    if (!dataset || !editing || !activeSet || saving) return;
    const text = editing.text.trim();
    if (text === '') { setMsg({ ok: false, text: 'a caption cannot be empty' }); return; }
    setSaving(true);
    try {
      const { dataset: updated } = await api.setCaption(dataset.id, activeSet, editing.mediaId, text);
      setDataset(updated);
      setEditing(null);
    } catch (e) {
      setMsg({ ok: false, text: `couldn't save: ${String((e as Error).message).slice(0, 160)}` });
    } finally { setSaving(false); }
  };

  if (dataset === undefined) {
    return <AppShell title="Caption job"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!dataset) {
    return (
      <AppShell title="Caption job">
        <div className="page"><div className="pw wide"><div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div></div></div>
      </AppShell>
    );
  }

  const d = dataset;
  const running = runId !== null && terminal === null;
  // What the pod itself reports it has captioned, while it is captioning — the pass is one forward
  // pass per image, so this is the only number that moves during the longest phase of the run.
  const pass = stream.progressus?.progress;
  const set = d.captionsets.find((cs) => cs.id === activeSet) ?? null;
  // The captionset a pass would extend: the one shown, when there is one. With none, every pass
  // is a fresh-set pass whether or not the opt-out is on.
  const extendTarget = set ? set.id : null;
  const extending = extendTarget !== null && !freshSet;
  const pending = extending ? uncaptionedCount(d, extendTarget) : d.media.length;
  const captions = set?.captions ?? {};
  const captioned = d.media.filter((m) => typeof captions[m.id] === 'string' && captions[m.id].trim() !== '').length;

  const crumb = <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <Link to={`/datasets/${d.id}`}>{d.name}</Link> <span className="sep">/</span> <b>captions</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Captioning · {d.media.length} {d.modality === 'video' ? 'clips' : 'images'}</h1></div>
        </div>

        {/* setup bar */}
        <div className="cj-setup">
          <span className="cj-seg"><span className="cj-l">method</span> <b>Natural language</b> · every image is read by the captioner</span>
          <span className="cj-seg">
            <span className="cj-l">name</span>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="captionset name (optional)" disabled={running} />
          </span>
          <span className="cj-seg"><span className="cj-l">runs in</span> <span className="hemi2 lit" /> <b>our compute</b></span>
          <button className="btn accent cj-adjust" onClick={() => void start()} disabled={running || starting || pending === 0}>
            {running ? 'captioning…' : starting ? 'starting…'
              : extending ? `Caption ${pending} uncaptioned ${pending === 1 ? 'image' : 'images'} →`
              : `Caption all ${pending} ${pending === 1 ? 'image' : 'images'} →`}
          </button>
        </div>

        {/* run panel — the pass as the pod reports it, for a job started from this screen */}
        {runId && (
          <div className="cj-run">
            <div className="cj-count">
              {pass && pass.total
                ? <><b>{pass.done}</b> / {pass.total} captioned</>
                : <b>{terminal === 'complete' ? 'captioned' : terminal === 'failed' ? 'failed' : 'starting the pass'}</b>}
            </div>
            <div className="cj-bar">
              <span style={{ width: terminal === 'complete' ? '100%' : pass && pass.total ? `${Math.round((pass.done / pass.total) * 100)}%` : '0%' }} />
            </div>
            <div className="cj-flight mono">run {runId.slice(0, 8)} · {stream.elapsedSec}s elapsed</div>
            <Stageline stream={stream} />
          </div>
        )}

        {/* Where the pass lands. Extending is the default and the fresh-set path is the opt-out:
            a second captionset is worth having when a different captioner will produce it, and
            there is one captioner — or when you mean to write the captions yourself. */}
        <div className="cj-seam mono">
          {d.captionsets.length === 0
            ? `no captionset on this dataset yet — this pass captions all ${d.media.length} ${d.media.length === 1 ? 'image' : 'images'} and makes one.`
            : extending
              ? `this pass adds to “${set?.name}” — ${pending === 0 ? 'it already covers every image' : `${pending} uncaptioned ${pending === 1 ? 'image' : 'images'}, and only ${pending === 1 ? 'that one is' : 'those are'} read`}.`
              : `this pass makes a NEW captionset over all ${d.media.length} ${d.media.length === 1 ? 'image' : 'images'} — every image is read and billed again.`}
          {d.captionsets.length > 0 && (
            <label className="cj-l" style={{ marginLeft: '0.75rem' }}>
              <input type="checkbox" checked={freshSet} disabled={running}
                onChange={(e) => setFreshSet(e.target.checked)} /> start a new captionset instead
            </label>
          )}
        </div>

        {msg && (
          <div className="cj-seam mono" style={{ color: msg.ok ? 'var(--accent-soft)' : 'var(--red-500, #e5746a)' }}>{msg.text}</div>
        )}

        {/* honesty seam — the claim to be showing the work is only made where the work is shown */}
        <div className="cj-seam mono">
          <span className="hemi2 lit" /> {running
            ? 'captioning on our compute — the stages above are the pod\u2019s own reports.'
            : 'captioning runs on our compute, and is metered like any other run.'}
        </div>

        {/* captionset picker — one dataset can carry several passes */}
        {d.captionsets.length > 0 && (
          <div className="cj-setup">
            {d.captionsets.map((cs) => (
              <button key={cs.id} className={`cj-seg${cs.id === activeSet ? ' on' : ''}`}
                onClick={() => { setActiveSet(cs.id); setEditing(null); }}>
                <span className="cj-l">{cs.method}</span> <b>{cs.name}</b> · {cs.coverage}
              </button>
            ))}
          </div>
        )}

        {/* the captions themselves, or an honest empty state */}
        {!set ? (
          <p className="ds-panel-note">
            {running
              ? 'the caption pass is running — captions land here when it finishes.'
              : 'no captionset on this dataset yet. Run a caption job to make one — a model learns from the caption layer, not from the images alone.'}
          </p>
        ) : (
          <>
            <div className="cj-grid">
              {d.media.map((m) => {
                const caption = captions[m.id];
                const has = typeof caption === 'string' && caption.trim() !== '';
                const isEditing = editing?.mediaId === m.id;
                return (
                  <figure key={m.id} className={`cj-cell${has ? '' : ' pending'}${isEditing ? ' editing' : ''}`}>
                    <span className="cj-tile" style={{ backgroundImage: `url(${m.url})`, backgroundSize: 'cover' }} />
                    <figcaption className="mono">
                      {isEditing ? (
                        <>
                          <input
                            className="inp" autoFocus value={editing.text}
                            onChange={(e) => setEditing({ mediaId: m.id, text: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveCaption(); if (e.key === 'Escape') setEditing(null); }}
                          />
                          <span className="cj-edithint">{saving ? 'saving…' : '↵ save · esc cancel'}</span>
                        </>
                      ) : has ? (
                        <span onClick={() => setEditing({ mediaId: m.id, text: caption })}>{caption}</span>
                      ) : (
                        <span className="cj-pending" onClick={() => setEditing({ mediaId: m.id, text: '' })}>
                          no caption in this set — click to write one
                        </span>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>

            <div className="cj-foot">
              <div className="cj-tally mono">{captioned} of {d.media.length} captioned in “{set.name}” · click any caption to edit it</div>
              <div className="cj-actions">
                <Link className="btn ghost" to={`/datasets/${d.id}`}>Back to dataset</Link>
                <button className="btn accent" onClick={() => navigate(`/datasets/${d.id}/derive`)} disabled={captioned === 0}>Train from this →</button>
              </div>
            </div>
          </>
        )}
      </div></div>
    </AppShell>
  );
}
