import type { CSSProperties } from 'react';
import { PLATE_ASPECT, plateLabel, type PlateSlot } from './landingPlates';
import './landing-plate.css';

interface PlateProps {
  slot: PlateSlot;
  /** Extra class for the layout that owns this slot (sizing, span, bleed). */
  className?: string;
  /** Above-the-fold plates load eagerly; everything below the fold stays lazy. */
  priority?: boolean;
  /** Opt into the settle-in motion. Ignored under `prefers-reduced-motion: reduce`, where
   *  the plate is simply present and correct — see landing-plate.css. */
  resolve?: boolean;
}

/**
 * One plate slot, rendered at its reserved aspect ratio whether or not the art exists yet.
 *
 * A placeholder is a flat token-coloured block carrying its own label. It is deliberately
 * unlovely: nothing here should be able to pass for finished art, and no placeholder carries
 * caption copy, so nothing on this surface makes a claim.
 */
export function LandingPlate({ slot, className, priority = false, resolve = false }: PlateProps) {
  const style = { '--plate-aspect': String(PLATE_ASPECT[slot.format]) } as CSSProperties;
  const cls = [
    'plate',
    resolve ? 'plate-resolve' : '',
    slot.source ? '' : 'plate-empty',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!slot.source) {
    return (
      <div className={cls} style={style} data-format={slot.format} data-subject={slot.subject}>
        <span className="plate-label mono">{plateLabel(slot)}</span>
      </div>
    );
  }

  const { src, narrow, alt, width, height } = slot.source;
  return (
    <picture className={cls} style={style} data-format={slot.format} data-subject={slot.subject}>
      {narrow ? <source media="(max-width: 640px)" srcSet={narrow} /> : null}
      <img
        className="plate-img"
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
      />
    </picture>
  );
}
