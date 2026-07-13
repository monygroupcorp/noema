import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api, getActivePurse, setActivePurse, type FlowDescription } from '../lib/api';
import { mediaFromOutput } from '../lib/media';
import { isPinned, togglePin } from '../lib/pins';
import { usePromptAssist, useAssistField } from '../state/promptAssist';
import { fieldExample } from '../lib/promptExamples';
import { humanizeKey } from '../lib/labels';
import { STAGE_LABELS, measure, useRunStream } from '../lib/runStream';

type Aditus = Record<string, unknown>;

function cleanAditus(a: Aditus): Aditus {
  const out: Aditus = {};
  for (const [k, v] of Object.entries(a)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out;
}

// ── The work axis: where this run executes / what we can see of it ──────────────
// Same three postures as the canvas visibility meter and the Compute dial.
// (Distinct from funding's identity axis — `noema sees:` is WHO, this is WHAT.)
type Compute = 'remote' | 'tee' | 'local';

const COMPUTE_OPTS: { id: Compute; label: string }[] = [
  { id: 'remote', label: 'remote · we see' },
  { id: 'tee', label: 'TEE · sealed' },
  { id: 'local', label: 'local · off' },
];

// Honest subline stating the consequence in words (one per posture).
const COMPUTE_SUB: Record<Compute, string> = {
  remote: 'est · remote · we see the work',
  tee: 'premium · enclave · we see nothing',
  local: 'your GPU · nothing leaves',
};

// The hemisphere glyph — shared grammar with the canvas/funding meters:
// remote = lit (filled half-disc + ring, accent); tee = ring only (slate);
// local = dashed ring (grey).
function Hemisphere({ vis }: { vis: Compute }) {
  const remote = vis === 'remote';
  const stroke = vis === 'remote' ? 'var(--accent)' : vis === 'tee' ? 'var(--slate)' : 'var(--grey)';
  return (
    <svg className="seg-hemi" viewBox="0 0 24 24" aria-hidden="true">
      {remote && <path d="M12,2 A10 10 0 0 0 12,22 Z" fill="var(--accent)" />}
      <circle cx="12" cy="12" r="10" fill="none" stroke={stroke} strokeWidth="1.4"
        strokeDasharray={vis === 'local' ? '2.4 2.4' : undefined} />
    </svg>
  );
}

export function Card() {
  const { ident } = useIdentity();
  const [params] = useSearchParams();
  const id = params.get('id') || 'flux-schnell';
  // A leased warm studio to run on (from /studio's "Run here") — rides the dispatch as-is.
  const studioId = params.get('studio') || undefined;

  const [flow, setFlow] = useState<FlowDescription | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [aditus, setAditus] = useState<Aditus>({});
  const [quote, setQuote] = useState<{ impetus?: string; error?: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  // The run being watched — set once createRun succeeds; the actual live status
  // (phases, elapsed, terminal honesty) rides `useRunStream`, not local polling.
  const [runId, setRunId] = useState<string | undefined>();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchErr, setDispatchErr] = useState<string | undefined>();
  const runStream = useRunStream(runId);
  const [pinned, setPinned] = useState(false);
  // Publish-to-feed state for the current result.
  const [pub, setPub] = useState<{ s: 'idle' | 'busy' | 'done' | 'err'; msg?: string }>({ s: 'idle' });
  // Selected compute posture — drives the quote, the subline, and the result frost.
  // Default to remote (the standard, lowest-credit posture).
  const [compute, setCompute] = useState<Compute>('remote');
  // The active anonymous purse (Vault "use this purse") this run will spend from, if any.
  // createRun() sends it as x-bursa-token; here we only surface it + offer a clear affordance.
  const [activePurse, setActivePurseState] = useState<string | null>(getActivePurse());
  useEffect(() => { setPinned(isPinned(id)); }, [id]);

  // Prompt augmentation: register prompt fields with the Concierge on focus,
  // and release the assist target when this card unmounts.
  const { clear } = usePromptAssist();
  const assist = useAssistField();
  useEffect(() => () => clear(), [clear]);

  // Per-flow saved input defaults (affines). Loaded over the schema defaults, saved on demand.
  const [affSave, setAffSave] = useState<{ s: 'idle' | 'busy' | 'done' | 'err'; msg?: string }>({ s: 'idle' });

  // fetch the real flow schema + seed the form from defaults, then overlay saved affines
  useEffect(() => {
    let live = true;
    setFlow(null); setLoadErr(null); setRunId(undefined); setDispatching(false); setDispatchErr(undefined); setQuote(null); setAffSave({ s: 'idle' });
    api.getFlow(id).then((f) => {
      if (!live) return;
      setFlow(f);
      const init: Aditus = {};
      for (const [k, p] of Object.entries(f.input?.properties ?? {})) {
        if (p.default !== undefined) init[k] = p.default;
        else if (k === 'prompt') init[k] = 'a low-poly n64-style dragon perched on a neon temple, dusk';
        else init[k] = '';
      }
      // Overlay the caller's saved defaults for this flow (best-effort — anon-capable).
      api.getAffines(id)
        .then((r) => { if (live) setAditus({ ...init, ...(r.affines ?? {}) }); })
        .catch(() => { if (live) setAditus(init); });
    }).catch((e) => { if (live) setLoadErr(String(e)); });
    return () => { live = false; };
  }, [id]);

  async function saveDefaults() {
    setAffSave({ s: 'busy' });
    try {
      await api.setAffines(id, cleanAditus(aditus));
      setAffSave({ s: 'done' });
    } catch (e) {
      setAffSave({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  // live quote (debounced) once required fields are present
  const required = useMemo(() => flow?.input?.required ?? [], [flow]);
  useEffect(() => {
    if (!flow) return;
    const ready = required.every((k) => aditus[k] !== '' && aditus[k] !== undefined);
    if (!ready) { setQuote(null); return; }
    const t = setTimeout(() => {
      setQuoting(true);
      api.quote({ modusId: id, aditus: cleanAditus(aditus) })
        .then((r) => setQuote({ impetus: r.impetus }))
        .catch((e) => setQuote({ error: String(e) }))
        .finally(() => setQuoting(false));
    }, 400);
    return () => clearTimeout(t);
  }, [flow, aditus, required, id]);

  function set(k: string, v: unknown) { setAditus((a) => ({ ...a, [k]: v })); }

  async function publishToFeed(actumId: string) {
    setPub({ s: 'busy' });
    try {
      await api.publish({ artifact: { kind: 'actum', id: actumId }, destination: 'feed', visibility: 'feed', custody: 'ours' });
      setPub({ s: 'done' });
    } catch (e) {
      setPub({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  async function doRun() {
    setPub({ s: 'idle' });
    setDispatchErr(undefined);
    setRunId(undefined);
    setDispatching(true);
    try {
      // TODO(backend): RunRequest has no locality/compute field yet. When the
      // dispatch API gains one, pass `compute` here so remote/TEE/local actually
      // route differently. For now the posture is presentational (quote + frost).
      const { run: r } = await api.createRun({ modusId: id, aditus: cleanAditus(aditus), ...(studioId ? { studioId } : {}) });
      // Live status (phases, elapsed, terminal honesty) streams via useRunStream(runId).
      setRunId(r.id);
    } catch (e) {
      setDispatchErr(String(e));
    } finally {
      setDispatching(false);
    }
  }

  // Credit model (credits only — never a $/hr market rate). The live quote's
  // impetus is the upper-bound base credit estimate for a remote run.
  const baseCredits = quote?.impetus ? Math.round(Number(quote.impetus)) : null;
  // TEE carries a modest enclave premium over remote (~35%); local is genuinely free.
  const teePremium = baseCredits != null ? Math.ceil(baseCredits * 0.35) : 0;
  const creditText =
    compute === 'local' ? '0 credits'
    : quoting ? '…'
    : quote?.error ? 'quote failed'
    : baseCredits == null ? '—'
    : compute === 'tee' ? `~${baseCredits + teePremium} credits`
    : `~${baseCredits} credits`;
  // Subline: honest consequence; for remote/TEE fall back to a fill-fields hint
  // when the quote can't be formed yet.
  const subline =
    compute === 'local' ? COMPUTE_SUB.local
    : quote?.error ? 'fill required fields'
    : COMPUTE_SUB[compute];
  const name = (flow?.nomen || id).split('—')[0].trim();

  // Live run status, derived (SSE with polling fallback — see useRunStream).
  const runStatus =
    dispatchErr ? 'failed'
    : dispatching ? 'dispatching…'
    : !runId ? undefined
    : runStream.terminal === 'complete' ? 'complete'
    : runStream.terminal === 'failed' ? 'failed'
    : 'running';
  const runElapsedLabel = runId && !runStream.terminal ? ` · ${runStream.elapsedSec}s elapsed` : '';
  const media = mediaFromOutput(runStream.exitus);

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Flow</div>
        <div className="meta-line"><span>id</span><span className="v mono">{id}</span></div>
        <div className="meta-line"><span>version</span><span className="v mono">{flow?.versio ?? '—'}</span></div>
        <div className="meta-line"><span>base model</span><span className="v mono">{String((flow as { fundamentumId?: unknown })?.fundamentumId ?? '—')}</span></div>
        <div className="meta-line"><span>category</span><span className="v mono">{String((flow as { categoria?: unknown })?.categoria ?? '—')}</span></div>
        {studioId && <div className="meta-line"><span>studio</span><span className="v mono">{studioId.slice(0, 8)} · warm</span></div>}
      </div>
      <div className="csec">
        <div className="ctitle">Account</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb={<>Catalogue <span className="sep">/</span> {id}</>} context={context}>
      <div className="cardscroll"><div className="card">
        {loadErr && <div className="warn">Couldn’t load this flow from staging — {loadErr}</div>}
        {!flow && !loadErr && <div className="empty"><div className="t">Loading flow…</div></div>}

        {flow && <>
          <div className="flow-head">
            <span className="fav" />
            <div>
              <h1>{name} <span className="verbtag">{String((flow as { categoria?: unknown }).categoria ?? 'flow')}</span></h1>
              <div className="desc">{(flow.nomen || '').includes('—') ? flow.nomen.split('—').slice(1).join('—').trim() : 'Live flow from staging.'}</div>
              <div className="ports">
                {Object.entries(flow.input?.properties ?? {}).slice(0, 4).map(([k, p]) => <span key={k} className="p">{p.title || humanizeKey(k)}</span>)}
                {' → '}
                {Object.entries(flow.output?.properties ?? {}).map(([k, p]) => <span key={k} className="p">{p.title || humanizeKey(k)}</span>)}
              </div>
            </div>
            <span className="ver mono">v{flow.versio}</span>
            <button
              className={`pin${pinned ? ' on' : ''}`}
              onClick={() => setPinned(togglePin({ id, name }))}
              title={pinned ? 'Unpin from rail' : 'Pin to rail'}
              aria-pressed={pinned}
            >
              <Ic name="star" />
            </button>
          </div>

          {/* auto-generated from the live input JSON-Schema */}
          {Object.entries(flow.input?.properties ?? {}).map(([k, p]) => {
            const req = required.includes(k);
            const isUri = p.format === 'uri';
            const isNum = p.type === 'integer' || p.type === 'number';
            // Free-text string → eligible for Concierge augmentation. Multi-line ones
            // (prompt/lyrics/story/…) render as a textarea; the rest as a text input.
            const isText = p.type === 'string' && !isUri;
            const isLong = isText && /prompt|lyric|story|description|caption|text|message|content/i.test(k);
            // Wired onto every free-text field so the Concierge slides open on focus.
            const assistProps = isText
              ? assist({
                  flowId: id,
                  flowName: name,
                  fieldKey: k,
                  fieldLabel: p.title || k,
                  example: fieldExample(id, k, p.description),
                  hint: p.description,
                  apply: (t: string) => set(k, t),
                })
              : {};
            return (
              <div className="field" key={k}>
                <label>
                  {p.title || humanizeKey(k)} {req ? <span className="req">required</span> : <span className="opt">optional</span>}
                  <span className="ty">{isUri ? `${p.type} · uri` : p.type}</span>
                </label>
                {isUri ? (
                  <input className="inp" value={String(aditus[k] ?? '')} placeholder={p.description || 'paste a URL'} onChange={(e) => set(k, e.target.value)} />
                ) : isNum ? (
                  <input className="inp mono" type="number" value={aditus[k] === '' || aditus[k] === undefined ? '' : Number(aditus[k])} placeholder={p.description} onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
                ) : isLong ? (
                  <textarea className="ta2" value={String(aditus[k] ?? '')} placeholder={p.description} onChange={(e) => set(k, e.target.value)} {...assistProps} />
                ) : (
                  <input className="inp" value={String(aditus[k] ?? '')} placeholder={p.description} onChange={(e) => set(k, e.target.value)} {...assistProps} />
                )}
              </div>
            );
          })}

          {runStatus && (
            <div className="result show">
              <h2><span className="ttdot" /> {runStatus === 'complete' ? 'output' : 'run'}</h2>

              {runStatus === 'failed' && (
                <div className="warn">
                  {dispatchErr ?? runStream.error ?? 'run failed'}
                  {runId && <> — charged {runStream.charged ?? '0'} credits.</>}
                  {' '}
                  <button className="btn-ghost" onClick={doRun}>Retry</button>
                </div>
              )}

              {runId && runStatus !== 'failed' && (
                <div className="stepline">
                  {STAGE_LABELS.map((label, i) => {
                    const st = runStatus === 'complete' ? 'done' : i < runStream.stageIdx ? 'done' : i === runStream.stageIdx ? 'active' : 'pending';
                    return (
                      <div key={i} className={`step ${st}`}>
                        <span className="pip">{st === 'done' && <Ic name="check" />}</span>
                        <div className="st-main">
                          <div className="t">{label}</div>
                          <div className="s">{st === 'active' ? measure(runStream.progressus) : ''}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="out">
                {/* Frost graft: the result answers the posture, reusing the
                    canvas sealing language (clean / frost / desaturate). */}
                <div className={`rimg vis-${compute}${runStream.exitus ? ' done' : ''}`}>
                  {media?.kind === 'image' && <img src={media.url} alt="" />}
                  {media?.kind === 'video' && <video src={media.url} controls muted loop playsInline />}
                  {media?.kind === 'audio' && <audio src={media.url} controls />}
                  {!runStream.exitus && (
                    <><div className="ph" /><div className="stage"><span className="dots"><span /><span /><span /></span> {runStatus}{runElapsedLabel}</div></>
                  )}
                  {compute === 'tee' && (
                    <div className="seal-mark"><Hemisphere vis="tee" /><span>sealed</span></div>
                  )}
                  {compute === 'local' && (
                    <div className="seal-mark"><Hemisphere vis="local" /><span>on your machine</span></div>
                  )}
                </div>
                <div className="exitus">
                  <div className="er"><span>run</span><span className="v">{runId ?? '—'}</span></div>
                  <div className="er"><span>status</span><span className="v">{runStatus}{runElapsedLabel}</span></div>
                  {runId && <div className="er"><span>detail</span><span className="v"><Link to={`/run?id=${runId}`}>open run view →</Link></span></div>}
                  {compute === 'tee' && <div className="er"><span>sealed</span><span className="v" style={{ color: 'var(--slate)' }}>we see nothing but the meter</span></div>}
                  {runStream.exitus && Object.entries(runStream.exitus).map(([k, v]) => (
                    <div className="er" key={k}><span>{k}</span><span className="v" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(v)}</span></div>
                  ))}
                  {/* Publish-to-feed — only when the result carries shareable media. */}
                  {runId && mediaFromOutput(runStream.exitus) && (
                    <div className="pub-row">
                      {pub.s === 'done' ? (
                        <span className="pub-done"><Ic name="check" /> In review — track it in <Link to="/review">your review queue</Link>; it appears in the <Link to="/feed">feed</Link> once approved.</span>
                      ) : (
                        <>
                          <button className="btn ghost" disabled={pub.s === 'busy'} onClick={() => publishToFeed(runId!)}>
                            <Ic name="rss" /> {pub.s === 'busy' ? 'Publishing…' : 'Publish to feed'}
                          </button>
                          {pub.s === 'err' && <span className="pub-err">{pub.msg}</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="runbar"><div className="inner">
            {/* Console run bar — segmented compute control (work axis) + run row. */}
            <div className="seg-compute" role="radiogroup" aria-label="compute posture">
              {COMPUTE_OPTS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={compute === o.id}
                  className={`seg-opt${compute === o.id ? ' on' : ''}`}
                  onClick={() => setCompute(o.id)}
                >
                  <Hemisphere vis={o.id} />
                  <span className="mono">{o.label}</span>
                </button>
              ))}
            </div>
            {compute === 'tee' && (
              <Link to="/tee" className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--accent-soft)' }}>
                <Ic name="eye-off" /> set up / view sealed session ▸
              </Link>
            )}
            {activePurse && (
              <div className="meta-line" style={{ marginTop: 'var(--s2)', fontSize: 'var(--fs-xs)' }}>
                <span className="mono"><Ic name="wallet" /> paying with purse {activePurse.slice(0, 6)}…{activePurse.slice(-4)}</span>
                <button
                  className="btn-ghost"
                  onClick={() => { setActivePurse(null); setActivePurseState(null); }}
                  title="Stop paying from this purse"
                >
                  <Ic name="x" /> use balance
                </button>
              </div>
            )}
            <div className="run-row">
              <div className="quote">
                <span className="q mono">{creditText}</span>
                <span className="qh">{subline}</span>
              </div>
              <button
                className="btn ghost"
                onClick={saveDefaults}
                disabled={affSave.s === 'busy'}
                title="Remember these inputs as your defaults for this flow"
              >
                <Ic name="star" /> {affSave.s === 'done' ? 'saved' : affSave.s === 'busy' ? 'saving…' : 'save defaults'}
              </button>
              <button className="btn-run" onClick={doRun} disabled={!quote?.impetus}>Run <span className="kbd">⌘⏎</span></button>
            </div>
            {affSave.s === 'err' && <div className="pub-err">{affSave.msg}</div>}
          </div></div>
        </>}
      </div></div>
    </AppShell>
  );
}
