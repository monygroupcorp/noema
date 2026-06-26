import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api, type FlowDescription, type Run } from '../lib/api';
import { isPinned, togglePin } from '../lib/pins';
import { usePromptAssist, useAssistField } from '../state/promptAssist';
import { fieldExample } from '../lib/promptExamples';

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

  const [flow, setFlow] = useState<FlowDescription | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [aditus, setAditus] = useState<Aditus>({});
  const [quote, setQuote] = useState<{ impetus?: string; error?: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [run, setRun] = useState<{ status: string; id?: string; error?: string; exitus?: Record<string, unknown> } | null>(null);
  const [pinned, setPinned] = useState(false);
  // Selected compute posture — drives the quote, the subline, and the result frost.
  // Default to remote (the standard, lowest-credit posture).
  const [compute, setCompute] = useState<Compute>('remote');
  useEffect(() => { setPinned(isPinned(id)); }, [id]);

  // Prompt augmentation: register prompt fields with the Concierge on focus,
  // and release the assist target when this card unmounts.
  const { clear } = usePromptAssist();
  const assist = useAssistField();
  useEffect(() => () => clear(), [clear]);

  // fetch the real flow schema + seed the form from defaults
  useEffect(() => {
    let live = true;
    setFlow(null); setLoadErr(null); setRun(null); setQuote(null);
    api.getFlow(id).then((f) => {
      if (!live) return;
      setFlow(f);
      const init: Aditus = {};
      for (const [k, p] of Object.entries(f.input?.properties ?? {})) {
        if (p.default !== undefined) init[k] = p.default;
        else if (k === 'prompt') init[k] = 'a low-poly n64-style dragon perched on a neon temple, dusk';
        else init[k] = '';
      }
      setAditus(init);
    }).catch((e) => { if (live) setLoadErr(String(e)); });
    return () => { live = false; };
  }, [id]);

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

  async function doRun() {
    setRun({ status: 'dispatching…' });
    try {
      // TODO(backend): RunRequest has no locality/compute field yet. When the
      // dispatch API gains one, pass `compute` here so remote/TEE/local actually
      // route differently. For now the posture is presentational (quote + frost).
      const { run: r } = await api.createRun({ modusId: id, aditus: cleanAditus(aditus) });
      setRun({ status: r.status, id: r.id, exitus: r.exitus });
      // light polling for terminal status (SSE streaming is the next bite)
      poll(r.id, 0);
    } catch (e) {
      setRun({ status: 'failed', error: String(e) });
    }
  }
  function poll(runId: string, n: number) {
    if (n > 40) return;
    setTimeout(() => {
      api.getRun(runId).then(({ run: r }) => {
        setRun({ status: r.status, id: r.id, exitus: r.exitus, error: r.failure?.message });
        if (r.status !== 'complete' && r.status !== 'failed') poll(runId, n + 1);
      }).catch(() => {});
    }, 1500);
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

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Flow</div>
        <div className="meta-line"><span>id</span><span className="v mono">{id}</span></div>
        <div className="meta-line"><span>version</span><span className="v mono">{flow?.versio ?? '—'}</span></div>
        <div className="meta-line"><span>base model</span><span className="v mono">{String((flow as { fundamentumId?: unknown })?.fundamentumId ?? '—')}</span></div>
        <div className="meta-line"><span>category</span><span className="v mono">{String((flow as { categoria?: unknown })?.categoria ?? '—')}</span></div>
      </div>
      <div className="csec">
        <div className="ctitle">Account</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb={<>catalog <span className="sep">/</span> {id}</>} context={context}>
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
                {Object.keys(flow.input?.properties ?? {}).slice(0, 4).map((k) => <span key={k} className="p">{k}</span>)}
                {' → '}
                {Object.keys(flow.output?.properties ?? {}).map((k) => <span key={k} className="p">{k}</span>)}
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
                  {p.title || k} {req ? <span className="req">required</span> : <span className="opt">optional</span>}
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

          {run && (
            <div className="result show">
              <h2><span className="ttdot" /> {run.status === 'complete' ? 'output' : 'run'}</h2>
              <div className="out">
                {/* Frost graft: the result answers the posture, reusing the
                    canvas sealing language (clean / frost / desaturate). */}
                <div className={`rimg vis-${compute}${run.exitus ? ' done' : ''}`}>
                  {!run.exitus && <><div className="ph" /><div className="stage"><span className="dots"><span /><span /><span /></span> {run.status}</div></>}
                  {compute === 'tee' && (
                    <div className="seal-mark"><Hemisphere vis="tee" /><span>sealed</span></div>
                  )}
                  {compute === 'local' && (
                    <div className="seal-mark"><Hemisphere vis="local" /><span>on your machine</span></div>
                  )}
                </div>
                <div className="exitus">
                  <div className="er"><span>run</span><span className="v">{run.id ?? '—'}</span></div>
                  <div className="er"><span>status</span><span className="v">{run.status}</span></div>
                  {compute === 'tee' && <div className="er"><span>sealed</span><span className="v" style={{ color: 'var(--slate)' }}>we see nothing but the meter</span></div>}
                  {run.error && <div className="er"><span>error</span><span className="v" style={{ color: 'var(--text)' }}>{run.error}</span></div>}
                  {run.exitus && Object.entries(run.exitus).map(([k, v]) => (
                    <div className="er" key={k}><span>{k}</span><span className="v" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(v)}</span></div>
                  ))}
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
            <div className="run-row">
              <div className="quote">
                <span className="q mono">{creditText}</span>
                <span className="qh">{subline}</span>
              </div>
              <button className="btn-run" onClick={doRun} disabled={!quote?.impetus}>Run <span className="kbd">⌘⏎</span></button>
            </div>
          </div></div>
        </>}
      </div></div>
    </AppShell>
  );
}
