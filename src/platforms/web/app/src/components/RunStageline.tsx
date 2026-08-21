import { STAGE_LABELS, measure, useRunStream, type RunStreamState } from '../lib/runStream';

// The run readout every watching surface shares: the five canonic stages, with the runner's own
// phase detail on the active one. This is the SAME vocabulary and the same `stepline` markup the
// dispatch page and the run-detail view render — extracted here, not reinvented, so a surface that
// wants to show a run's phases never grows a second timeline with a second set of words.
//
// Two entry points, because the two callers differ in what they already hold:
//   • `Stageline` is presentational — for a screen that already subscribes (it needs the terminal
//     state for its own reasons) and just wants the readout drawn from the state it has.
//   • `RunStageline` subscribes itself — for a surface that only holds a run id.
//
// A failed run renders no stageline (the caller says what went wrong instead) — mirroring the
// dispatch page, where a half-lit progress bar under an error reads as work still in flight.

// Narrowed to what the readout actually draws, so a surface that already holds a run's
// live phase — a Muse tile's piece, say — can render this same timeline from the
// subscription it already has, without opening a second stream to satisfy a type.
export function Stageline({ stream }: { stream: Pick<RunStreamState, 'stageIdx' | 'progressus' | 'terminal'> }) {
  if (stream.terminal === 'failed') return null;
  const complete = stream.terminal === 'complete';
  return (
    <div className="stepline">
      {STAGE_LABELS.map((label, i) => {
        const st = complete || i < stream.stageIdx ? 'done' : i === stream.stageIdx ? 'active' : 'pending';
        return (
          <div key={i} className={`step ${st}`}>
            <span className="pip">{st === 'done' ? '✓' : ''}</span>
            <div className="st-main">
              <div className="t">{label}</div>
              <div className="s">{st === 'active' ? measure(stream.progressus) : ''}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The same readout for a caller that holds only a run id. */
export function RunStageline({ runId }: { runId: string }) {
  const stream = useRunStream(runId);
  return <Stageline stream={stream} />;
}
