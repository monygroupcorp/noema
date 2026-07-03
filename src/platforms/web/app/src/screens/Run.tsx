import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api, type Run as RunT } from '../lib/api';
import { mediaFromOutput, textFromOutput } from '../lib/media';

type StepState = 'done' | 'active' | 'pending';

// ── Live run observation over SSE (GET /v1/runs/:id/stream) ───────────────────
// The server emits `data:`-only frames (no event: field) in four shapes: an initial
// `snapshot`, then a stream of `progress` (carrying a Progressus), and a terminal
// `complete` / `failed`. The terminal events carry NO exitus — we fetch the run for
// its outputs on completion, mirroring the backend's own agent relay.
type Phasis =
  | 'queued' | 'provisioning' | 'pulling' | 'attesting' | 'downloading'
  | 'installing' | 'loading' | 'warming' | 'executing' | 'uploading'
  | 'finalizing' | 'cancelling' | 'done' | 'failed';

interface Progressus {
  phase: Phasis;
  target?: string;
  message?: string;
  progress?: { done: number; total?: number; unit: string };
  etaMs?: number;
}

interface RunEvent {
  kind: 'snapshot' | 'progress' | 'complete' | 'failed';
  terminal?: boolean;
  run?: RunT;
  progressus?: Progressus;
  status?: 'complete' | 'failed';
  costUsd?: number;
  executionMs?: number;
}

// The five stages the timeline shows, in lifecycle order. Every Phasis maps into
// exactly one of these (kept coarse — the fine phase rides in the active sub-line).
const STAGE_LABELS = ['admitted', 'provisioned pod', 'generating', 'upload → R2', 'settle ledger'];

function phaseToStage(phase: Phasis): number {
  switch (phase) {
    case 'queued': return 0;
    case 'provisioning': case 'pulling': case 'attesting':
    case 'downloading': case 'installing': case 'loading': case 'warming': return 1;
    case 'executing': return 2;
    case 'uploading': return 3;
    case 'finalizing': case 'cancelling': return 4;
    case 'done': case 'failed': return 5;
    default: return 1;
  }
}

// The sub-line for the active stage: prefer the runner's human message, else its
// typed progress measurement, else the raw phase name.
function measure(p?: Progressus): string {
  if (!p) return '…';
  if (p.message) return p.message;
  if (p.progress) {
    const { done, total, unit } = p.progress;
    return total ? `${done} / ${total} ${unit}` : `${done} ${unit}`;
  }
  return p.target ? `${p.phase} · ${p.target}` : p.phase;
}

export function Run() {
  const { ident } = useIdentity();
  const [params] = useSearchParams();
  const id = params.get('id');

  const [stageIdx, setStageIdx] = useState(0);
  const [progressus, setProgressus] = useState<Progressus | undefined>();
  const [terminal, setTerminal] = useState<'complete' | 'failed' | null>(null);
  const [exitus, setExitus] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [cost, setCost] = useState<{ costUsd?: number; executionMs?: number }>({});
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(Date.now());

  // Elapsed clock — ticks once a second until the run reaches a terminal state.
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [terminal]);

  // Subscribe to the live run event stream.
  useEffect(() => {
    if (!id) return;
    let live = true;
    startedAt.current = Date.now();
    const es = api.streamRun(id);

    es.onmessage = (e) => {
      if (!live) return;
      let msg: RunEvent;
      try { msg = JSON.parse(e.data) as RunEvent; } catch { return; }

      if (msg.kind === 'snapshot') {
        const r = msg.run;
        if (!r) return;
        if (r.status === 'complete') {
          setStageIdx(5); setTerminal('complete'); setExitus(r.exitus ?? null);
        } else if (r.status === 'failed') {
          setTerminal('failed'); setError(r.failure?.message);
        }
        return;
      }
      if (msg.kind === 'progress' && msg.progressus) {
        setProgressus(msg.progressus);
        setStageIdx(phaseToStage(msg.progressus.phase));
        return;
      }
      if (msg.kind === 'complete') {
        setStageIdx(5); setTerminal('complete');
        setCost({ costUsd: msg.costUsd, executionMs: msg.executionMs });
        // Terminal events carry no outputs — fetch the run for its exitus.
        api.getRun(id).then(({ run }) => { if (live) setExitus(run.exitus ?? null); }).catch(() => {});
        es.close();
        return;
      }
      if (msg.kind === 'failed') {
        setTerminal('failed');
        api.getRun(id).then(({ run }) => { if (live) setError(run.failure?.message); }).catch(() => {});
        es.close();
        return;
      }
    };
    // The browser auto-reconnects on transient errors; once we hit a terminal event
    // we close the stream ourselves, so an onerror after that is benign.

    return () => { live = false; es.close(); };
  }, [id]);

  function stepState(i: number): StepState {
    if (terminal === 'complete') return 'done';
    if (i < stageIdx) return 'done';
    if (i === stageIdx) return 'active';
    return 'pending';
  }

  const status =
    terminal === 'complete' ? `complete · ${elapsed}s total`
    : terminal === 'failed' ? 'failed'
    : `running · ${elapsed}s elapsed`;
  const badgeText = terminal === 'failed' ? 'failed' : terminal === 'complete' ? 'complete' : 'running';
  const badgeDone = terminal !== null;

  const media = mediaFromOutput(exitus);
  const text = textFromOutput(exitus);
  const imgDone = terminal === 'complete';

  const context = (
    <div className="csec">
      <div className="ctitle">Session</div>
      <div className="meta-line"><span>run</span><span className="v mono">{id ?? '—'}</span></div>
      <div className="meta-line"><span>status</span><span className="v mono">{terminal ?? 'running'}</span></div>
      {cost.executionMs != null && (
        <div className="meta-line"><span>this run</span><span className="v mono">{(cost.executionMs / 1000).toFixed(1)}s</span></div>
      )}
      {cost.costUsd != null && (
        <div className="meta-line"><span>spent</span><span className="v mono">${cost.costUsd.toFixed(3)}</span></div>
      )}
      <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
    </div>
  );

  if (!id) {
    return (
      <AppShell crumb={<>runs</>} context={context}>
        <div className="page"><div className="pw narrow">
          <div className="empty">
            <div className="t">No run selected</div>
            <div className="s">Start one from the <Link to="/catalog">catalog</Link> — a dispatched run lands here to watch it stream.</div>
          </div>
        </div></div>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={<>runs <span className="sep">/</span> <span className="mono">{id}</span></>}
      context={context}
    >
      <div className="page"><div className="pw narrow">

        <div className="pagehead">
          <div>
            <h1>run</h1>
            <div className={`sub mono`}>{status}</div>
          </div>
          <div className="right">
            <span className={`badge${badgeDone && terminal === 'complete' ? '' : ' accent'}`}>{badgeText}</span>
          </div>
        </div>

        {terminal === 'failed' && error && <div className="warn">{error}</div>}

        <div className="sectionhead">Stages</div>
        <div className="stepline">
          {STAGE_LABELS.map((label, i) => {
            const st = stepState(i);
            return (
              <div key={i} className={`step ${st}`}>
                <span className="pip">
                  {st === 'done' && <Ic name="check" />}
                </span>
                <div className="st-main">
                  <div className="t">{label}</div>
                  <div className="s">{st === 'active' ? measure(progressus) : ''}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sectionhead"><span className="ttdot" /> Result</div>
        <div className="result show">
          <div className="out">
            <div className={`rimg${imgDone ? ' done' : ''}`}>
              {media?.kind === 'image' && <img src={media.url} alt="" />}
              {media?.kind === 'video' && <video src={media.url} controls muted loop playsInline />}
              {media?.kind === 'audio' && <audio src={media.url} controls />}
              {!imgDone && (
                <>
                  <div className="ph" />
                  <div className="stage">
                    <span className="dots"><span /><span /><span /></span>
                    {' '}{measure(progressus)}
                  </div>
                </>
              )}
            </div>
            <div className="exitus">
              <div className="er"><span>run</span><span className="v">{id}</span></div>
              <div className="er"><span>status</span><span className="v">{terminal ?? 'running'}</span></div>
              {text && <div className="er"><span>text</span><span className="v" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span></div>}
              {exitus && Object.entries(exitus).map(([k, v]) => (
                <div className="er" key={k}><span>{k}</span><span className="v" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(v)}</span></div>
              ))}
              <div className="acts">
                <Link className="btn-ghost" to="/space"><Ic name="sparkles" /> Save to Space</Link>
                <Link className="btn-ghost" to="/canvas"><Ic name="workflow" /> Send to Canvas</Link>
                <Link className="btn-ghost" to="/catalog"><Ic name="rotate-cw" /> New run</Link>
              </div>
            </div>
          </div>
        </div>

      </div></div>
    </AppShell>
  );
}
