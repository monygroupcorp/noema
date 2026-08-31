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
  /** Fraction of the banner width the leading card holds before the next one covers it.
   *  Lower leaves a wider peek of the card behind. */
  lead?: number;
  className?: string;
}

/**
 * The deck — the landing page's one image mechanism.
 *
 * A full-bleed banner holding a fanned run of plates: the leading card takes most of the width,
 * the next one overlaps its right edge, and the rest stack behind that. Scrolling past the
 * banner slides the whole fan left, so each card in turn exits and the one behind it opens into
 * the lead. The images are never stood up in front of the reader; they pass while the reader is
 * on their way somewhere else.
 *
 * The page's scroll is never intercepted, retimed, or snapped — the fan's position is read from
 * where the banner already is, so scrolling stays exactly as fast as the reader made it.
 *
 * Under `prefers-reduced-motion: reduce` the fan holds at its opening position. That is a
 * finished composition on its own: the lead card is fully visible and the run is legible behind
 * it, which is what the still has to be anyway.
 */
export function PlateDeck({ slots, label, format, lead = 0.78, className }: PlateDeckProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;

    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 as the banner's top reaches the bottom of the viewport, 1 as its bottom leaves the
      // top: the fan's travel is exactly the reader's pass over it.
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
  }, [slots.length, format, lead]);

  if (!slots.length) return null;

  const aspect = PLATE_ASPECT[format ?? slots[0].format];
  const style = {
    '--deck-n': String(slots.length),
    '--deck-aspect': String(aspect),
    '--deck-lead': String(lead),
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={['deck', className ?? ''].filter(Boolean).join(' ')}
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
