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

/** How much of a beat's own window is spent arriving and leaving. Generous on purpose: a short
 *  cross between two statements that sit on opposite sides of the page reads as a jump-cut. */
const EDGE = 0.3;

/** Ease the cross. A linear opacity ramp reads as a hard dissolve; this settles. */
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

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
        const enter = i === 0 ? 1 : ease(clamp01((d + EDGE) / EDGE));
        // leaving: every beat but the last steps back as the next one takes over.
        const leave = i === beats.length - 1 ? 0 : ease(clamp01((d - (1 - EDGE)) / EDGE));
        const on = Math.min(enter, 1 - leave);
        // each statement arrives from, and leaves toward, the side it sits on, so the swing
        // across the page is a movement rather than two things blinking in different places.
        const dir = b.align === 'right' ? 1 : -1;
        const x = (1 - enter) * 30 * dir - leave * 30 * dir;
        const style = {
          opacity: on,
          transform: `translate3d(${x.toFixed(1)}px, ${((1 - enter) * 8 - leave * 8).toFixed(1)}px, 0)`,
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
