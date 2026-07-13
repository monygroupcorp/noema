import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { mediaFromOutput, textFromOutput } from '../lib/media';
import { STAGE_LABELS, measure, useRunStream } from '../lib/runStream';
import { Lightbox } from '../components/Lightbox';

type StepState = 'done' | 'active' | 'pending';

export function Run() {
  const { ident } = useIdentity();
  const [params] = useSearchParams();
  const id = params.get('id');
  const [lightbox, setLightbox] = useState(false);

  const {
    stageIdx, progressus, terminal, exitus, error, modusId,
    costUsd, executionMs, charged, elapsedSec: elapsed,
  } = useRunStream(id ?? undefined);
  const cost = { costUsd, executionMs };

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

        {terminal === 'failed' && (
          <div className="warn">
            {error ?? 'run failed'} — charged {charged ?? '0'} credits.{' '}
            {modusId && <Link to={`/card?id=${modusId}`}>Retry</Link>}
          </div>
        )}

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
              {media?.kind === 'image' && (
                <img
                  src={media.url}
                  alt=""
                  className="rimg-clickable"
                  onClick={() => setLightbox(true)}
                />
              )}
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
                {/* Work is auto-saved to Space on completion — this is a truthful link, not
                    a save action (product ruling 2026-07-13: the space is the full history). */}
                <Link className="btn-ghost" to="/space"><Ic name="sparkles" /> View in Space</Link>
                <Link className="btn-ghost" to="/canvas"><Ic name="workflow" /> Send to Canvas</Link>
                <Link className="btn-ghost" to="/catalog"><Ic name="rotate-cw" /> New run</Link>
              </div>
            </div>
          </div>
        </div>

      </div></div>
      {lightbox && media?.kind === 'image' && (
        <Lightbox src={media.url} onClose={() => setLightbox(false)} />
      )}
    </AppShell>
  );
}
