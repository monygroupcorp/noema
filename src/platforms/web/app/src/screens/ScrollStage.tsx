import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './scroll-stage.css';

/** Elements currently on screen-watch, and the single rAF that serves all of them. One
 *  listener and one frame for the whole page: a stage costs a `getBoundingClientRect`, not a
 *  scroll handler of its own. */
const stages = new Set<HTMLElement>();
let frame = 0;
let listening = false;

function measure() {
  frame = 0;
  const vh = window.innerHeight || 1;
  for (const el of stages) {
    const r = el.getBoundingClientRect();
    const travel = r.height - vh;
    const p = travel > 0 ? -r.top / travel : 0;
    const pin = el.firstElementChild as HTMLElement | null;
    pin?.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(measure);
}

function watch(el: HTMLElement) {
  stages.add(el);
  if (!listening) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    listening = true;
  }
  schedule();
  return () => {
    stages.delete(el);
    if (stages.size === 0 && listening) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      listening = false;
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

interface ScrollStageProps {
  /** How long the stage holds, in viewport heights of scrolling, after it locks. The stage's
   *  own children read that travel as `--p`, 0 at the moment it locks and 1 as it releases. */
  hold: number;
  children: ReactNode;
  className?: string;
}

/**
 * A stage that locks to the viewport while the reader scrolls through it, then releases them
 * on their way.
 *
 * The page is a sequence of these: a run of images passes in one, a piece of information is
 * held still in the next. Scrolled fast, the images fly by and the beats flash past; scrolled
 * slowly, each one holds for as long as the reader stays with it.
 *
 * The lock is `position: sticky` and nothing else — scroll distance still maps one-to-one to
 * the wheel, there is no snapping, no easing of the page's own motion, and no interception. A
 * reader who wants to be somewhere else gets there at exactly the speed they asked for.
 *
 * Under `prefers-reduced-motion: reduce` the stage does not lock at all. It collapses to its
 * natural height and its contents sit in normal flow, which is why every stage has to be a
 * complete composition at `--p: 0`.
 */
export function ScrollStage({ hold, children, className }: ScrollStageProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let stop: (() => void) | undefined;
    const apply = () => {
      stop?.();
      stop = undefined;
      const pin = el.firstElementChild as HTMLElement | null;
      if (reduce.matches) {
        pin?.style.setProperty('--p', '0');
        return;
      }
      stop = watch(el);
    };
    apply();
    reduce.addEventListener('change', apply);
    return () => {
      stop?.();
      reduce.removeEventListener('change', apply);
    };
  }, [hold]);

  return (
    <section
      ref={ref}
      className={['stage', className ?? ''].filter(Boolean).join(' ')}
      style={{ '--hold': String(hold) } as CSSProperties}
    >
      <div className="stage-pin">{children}</div>
    </section>
  );
}
