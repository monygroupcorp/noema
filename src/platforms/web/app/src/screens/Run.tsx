import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { mediaFromOutput, textFromOutput } from '../lib/media';
import { STAGE_LABELS, measure, useRunStream } from '../lib/runStream';
import { Lightbox } from '../components/Lightbox';
import { api, type SettledRun } from '../lib/api';
import { flowSummaries } from '../lib/flows';
import { toUI } from './Catalog';

type StepState = 'done' | 'active' | 'pending';

// A flow row on the /run landing — the catalogue's own projection of a FlowSummary, so the two
// screens name a flow the same way.
type StartRow = ReturnType<typeof toUI>;

// How many flows the landing lists before pointing at the catalogue for the rest. The run
// surface shows what can be started here (REFERENCES.md REF-15); narrowing the whole library is
// the catalogue's job, so the list is short and ends in a door to it.
export const START_MAX = 10;
export function startList(flows: readonly StartRow[]): { shown: StartRow[]; more: number } {
  return { shown: flows.slice(0, START_MAX), more: Math.max(0, flows.length - START_MAX) };
}
// The section's header states its shape before its rows (DESIGN.md D-55): how many flows are
// listed here out of how many the catalogue holds, the way /projects and the feed count theirs.
// Until the flows have loaded there is no count to state, and the header is the plain title.
export function startShape(shown: number, total: number): string {
  if (total === 0) return 'Start a run';
  if (shown < total) return `Start a run · ${shown} of ${total} flows`;
  return `Start a run · ${total} ${total === 1 ? 'flow' : 'flows'}`;
}

export function Run() {
  const { ident } = useIdentity();
  const [params] = useSearchParams();
  const id = params.get('id');
  const [lightbox, setLightbox] = useState(false);

  // With no run open, the screen is a landing: the visitor's last runs, each a door back into
  // its stream, and the flows they can start one from — the same list the catalogue reads
  // (DESIGN.md D-60: an empty state gives the action that fills it, not a dashed box). Both
  // reads are skipped while a run is open; a failed read leaves the band it feeds absent.
  const [recent, setRecent] = useState<SettledRun[] | null>(null);
  const [flows, setFlows] = useState<StartRow[] | null>(null);
  useEffect(() => {
    if (id) return;
    let live = true;
    api.listRuns({ limit: 8 }).then((p) => { if (live) setRecent(p.runs); }).catch(() => { if (live) setRecent([]); });
    flowSummaries().then((list) => { if (live) setFlows(list.map(toUI)); }).catch(() => { if (live) setFlows([]); });
    return () => { live = false; };
  }, [id]);

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
      <div className="meta-line"><span>status</span><span className="v mono">{id ? terminal ?? 'running' : 'none open'}</span></div>
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
    const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
    const start = startList(flows ?? []);
    return (
      <AppShell crumb={<>Runs</>} context={context}>
        <div className="page"><div className="pw narrow">
          <div className="pagehead">
            <div><h1>Runs</h1><div className="sub">A dispatched run streams here, stage by stage, until its result lands.</div></div>
          </div>

          {recent && recent.length > 0 && (
            <>
              <div className="sectionhead">Your last runs</div>
              <div className="list">
                {recent.map((r) => (
                  <Link className="lrow" to={`/run?id=${r.id}`} key={r.id}>
                    <div className="li-main">
                      <div className="t">{r.modusLabel}</div>
                      <div className="s">{fmtDate(r.settledAt)}</div>
                    </div>
                    <div className="li-right">{Number(r.cost).toLocaleString()} cr · ${r.costUsd.toFixed(2)}</div>
                  </Link>
                ))}
              </div>
            </>
          )}

          <div className="sectionhead">{startShape(start.shown.length, flows?.length ?? 0)}</div>
          {flows === null ? (
            <div className="empty"><div className="t">Loading the flows you can start…</div></div>
          ) : flows.length === 0 ? (
            <div className="empty"><div className="t">Couldn’t reach the catalogue — <Link to="/catalog">open it ▸</Link></div></div>
          ) : (
            <>
              <div className="list">
                {start.shown.map((f) => (
                  <Link className="lrow" to={`/card?id=${encodeURIComponent(f.id)}`} key={f.id}>
                    <div className="li-main">
                      <div className="t">{f.name}</div>
                      <div className="s">{f.verb} · {f.media}</div>
                    </div>
                    <div className="li-right">run ▸</div>
                  </Link>
                ))}
              </div>
              <div className="sub" style={{ marginTop: 'var(--s3)' }}>
                <Link to="/catalog">{start.more > 0 ? `All ${flows.length} in the catalogue ▸` : 'Browse the catalogue ▸'}</Link>
              </div>
            </>
          )}
        </div></div>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={<>Runs <span className="sep">/</span> <span className="mono">{id}</span></>}
      context={context}
    >
      <div className="page"><div className="pw narrow">

        <div className="pagehead">
          <div>
            <h1>Run</h1>
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
