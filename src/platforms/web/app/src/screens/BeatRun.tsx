import { useRef, type CSSProperties } from 'react';
import { useStageProgress } from './ScrollStage';
import './beat-run.css';

export interface Beat {
  id: string;
  n: string;
  title: string;
  text: string;
  align: 'left' | 'right';
}

/** How much of a beat's own window is spent arriving and leaving. */
const EDGE = 0.16;

/**
 * A run of statements held in one lock, advancing with the scroll.
 *
 * Three statements used to be three separate locks, which cost three whole screens to say three
 * sentences and read as padding however good the sentences were. Held together they read as one
 * argument developing, and the page gets two and a half screens back.
 *
 * The first beat is fully present the moment the block locks and the last one stays to the end,
 * so there is never a blank held screen — the failure the earlier per-beat fade walked into.
 */
export function BeatRun({ beats }: { beats: Beat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useStageProgress(ref);
  const f = p * beats.length;

  return (
    <div className="beats" ref={ref}>
      {beats.map((b, i) => {
        const d = f - i;
        // Arriving: every beat but the first fades up over the same stretch the one before it
        // fades down, so they cross. Queued rather than crossed, there is a moment where the
        // outgoing beat has gone and the incoming one has barely started, and the held screen
        // dims to almost nothing.
        const enter = i === 0 ? 1 : Math.min(1, Math.max(0, (d + EDGE) / EDGE));
        // leaving: every beat but the last steps back as the next one takes over.
        const leave = i === beats.length - 1 ? 0 : Math.min(1, Math.max(0, (d - (1 - EDGE)) / EDGE));
        const on = Math.min(enter, 1 - leave);
        const style = {
          opacity: on,
          transform: `translateY(${((1 - enter) * 14 - leave * 14).toFixed(2)}px)`,
          pointerEvents: on > 0.5 ? 'auto' : 'none',
        } as CSSProperties;
        return (
          <div key={b.id} className={`beat beat-${b.align}`} style={style} aria-hidden={on < 0.5}>
            <span className="beat-n mono">{b.n}</span>
            <h2>{b.title}</h2>
            <p>{b.text}</p>
          </div>
        );
      })}
    </div>
  );
}
