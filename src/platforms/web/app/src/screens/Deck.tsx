import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './plate-deck.css';

interface DeckProps {
  /** The run, in order. Order is the composition: the first card is seen longest, the last is
   *  the one left standing when the run ends. */
  items: ReactNode[];
  /** What the run is, for anyone who cannot see it. */
  label: string;
  /** Card crop, as width ÷ height. */
  aspect: number;
  /** Card crop on a narrow screen. A banner crop that commands a desktop is a letterbox slot on
   *  a phone, so the run is composed twice. Defaults to `aspect`. */
  aspectNarrow?: number;
  /** Extra travel after the last card is uncovered, measured in cards, during which nothing
   *  moves. A run whose final card has something of its own to do needs a stretch of scroll
   *  where it is alone — without it, the last card performs while the one above it is still
   *  sliding off. */
  trail?: number;
  /** How far each card in the pile is squared off from the one above it, in px. 0 stacks them
   *  exactly, so nothing beneath is visible until the top card moves. */
  stagger?: number;
  /** Where the run's progress comes from.
   *
   *  `lock` — inherit `--p` from an enclosing ScrollStage. The page holds still while the run
   *  passes, so the whole run is seen and the reader chooses the pace.
   *
   *  `pass` — drive the run from the banner's own trip through the viewport, with nothing
   *  locked. Cheaper and never holds the reader, but a long run goes by too fast to read. */
  progress?: 'lock' | 'pass';
  className?: string;
}

/**
 * The deck — the landing page's one way of showing a run of things.
 *
 * A stack of cards, squared up and staggered by a hair so the pile reads as a pile. Every card
 * is already in place; the top one covers the rest. As the run advances the top card slides off
 * to the left and uncovers the one beneath, which was there the whole time. Nothing arrives
 * from off-screen, and the last card is never dealt away — it is what the reader is left with.
 *
 * It is deliberately not specific to plates. The page shows more than one kind of run — the
 * work made here, and the rooms it was made in — and they are the same gesture, so they are the
 * same component.
 *
 * Under `prefers-reduced-motion: reduce` the pile holds squared up at its opening position,
 * which is a finished composition on its own: one card at full size with the pile beneath it
 * falling away in value.
 */
export function Deck({
  items,
  label,
  aspect,
  aspectNarrow,
  trail = 0,
  stagger = 18,
  progress = 'lock',
  className,
}: DeckProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    // In `lock` mode the enclosing stage owns the progress and the deck simply inherits it.
    if (!el || progress === 'lock') return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;

    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 as the banner's top reaches the bottom of the viewport, 1 as its bottom leaves the
      // top: the run's travel is exactly the reader's pass over it.
      const p = (vh - r.top) / (vh + r.height);
      el.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    const apply = () => {
      if (reduce.matches) {
        cancelAnimationFrame(raf);
        raf = 0;
        el.style.setProperty('--p', '0');
        window.removeEventListener('scroll', onScroll);
        return;
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      measure();
    };

    apply();
    window.addEventListener('resize', onScroll);
    reduce.addEventListener('change', apply);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      reduce.removeEventListener('change', apply);
    };
  }, [items.length, aspect, aspectNarrow, trail, stagger, progress]);

  if (!items.length) return null;

  const style = {
    '--deck-n': String(items.length),
    '--deck-aspect': String(aspect),
    '--deck-aspect-narrow': String(aspectNarrow ?? aspect),
    '--deck-trail': String(trail),
    // the wide stagger, not the stagger: a narrow screen halves it in CSS, and an inline
    // `--deck-stagger` would win over that media query and quietly keep the wide pile's
    // spread — which on a phone is a tenth of the column spent on the edges of cards nobody
    // can see yet.
    '--deck-stagger-wide': `${stagger}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={['lp-deck', progress === 'pass' ? 'lp-deck-pass' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
      role="group"
      aria-label={label}
    >
      <div className="lp-deck-track">
        {items.map((item, i) => (
          <div key={i} className="lp-deck-card" style={{ '--i': String(i) } as CSSProperties}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
