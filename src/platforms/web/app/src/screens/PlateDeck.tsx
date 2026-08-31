import { useEffect, useRef, type CSSProperties } from 'react';
import { LandingPlate } from './LandingPlate';
import { PLATE_ASPECT, type PlateFormat, type PlateSlot } from './landingPlates';
import './plate-deck.css';

interface PlateDeckProps {
  /** The run, in order. Order is the composition: the first card is seen longest, the last is
   *  the one left standing when the banner exits. */
  slots: PlateSlot[];
  /** What the banner is, for anyone who cannot see it. */
  label: string;
  /** Card crop. Defaults to the run's own declared format; the lab overrides it to compare. */
  format?: PlateFormat;
  /** How far each card in the pile is squared off from the one above it, in px. 0 stacks them
   *  exactly, so nothing beneath is visible until the top card moves. */
  stagger?: number;
  /** Where the run's progress comes from.
   *
   *  `lock` — inherit `--p` from an enclosing ScrollStage. The page holds still while the run
   *  passes, so the whole run is seen and the reader chooses the pace. This is the page's mode.
   *
   *  `pass` — drive the run from the banner's own trip through the viewport, with nothing
   *  locked. Cheaper and never holds the reader, but a long run goes by too fast to read. */
  progress?: 'lock' | 'pass';
  className?: string;
}

/**
 * The deck — the landing page's one image mechanism.
 *
 * A stack of plates, squared up and staggered by a hair so the pile reads as a pile. Every card
 * is already in place; the top one covers the rest. As the run advances the top card slides off
 * to the left and uncovers the one beneath, which was there the whole time. Nothing arrives
 * from off-screen, and the last card is never dealt away — it is what the reader is left with.
 *
 * The images are never stood up in front of the reader. They are uncovered, one at a time,
 * while the reader is on their way somewhere else.
 *
 * Under `prefers-reduced-motion: reduce` the pile holds squared up at its opening position,
 * which is a finished composition on its own: one plate at full size with the pile beneath it
 * falling away in value.
 */
export function PlateDeck({ slots, label, format, stagger = 18, progress = 'lock', className }: PlateDeckProps) {
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
  }, [slots.length, format, stagger, progress]);

  if (!slots.length) return null;

  const aspect = PLATE_ASPECT[format ?? slots[0].format];
  const style = {
    '--deck-n': String(slots.length),
    '--deck-aspect': String(aspect),
    '--deck-stagger': `${stagger}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={['deck', progress === 'pass' ? 'deck-pass' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
      role="group"
      aria-label={label}
    >
      <div className="deck-track">
        {slots.map((slot, i) => (
          <div key={slot.id} className="deck-card" style={{ '--i': String(i) } as CSSProperties}>
            <LandingPlate slot={slot} fill priority={i === 0} />
            {slot.source ? null : <span className="deck-i mono" aria-hidden="true">{i + 1}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
