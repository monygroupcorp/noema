import { Deck } from './Deck';
import { LandingPlate } from './LandingPlate';
import { PLATE_ASPECT, type PlateFormat, type PlateSlot } from './landingPlates';

interface PlateDeckProps {
  slots: PlateSlot[];
  label: string;
  /** Card crop. Defaults to the run's own declared format; the lab overrides it to compare. */
  format?: PlateFormat;
  stagger?: number;
  progress?: 'lock' | 'pass';
  className?: string;
}

/** A deck of plates — the run of work the page shows. The mechanic lives in `Deck`; this fills
 *  it with the slot registry's plates and their reserved crop. */
export function PlateDeck({ slots, label, format, ...rest }: PlateDeckProps) {
  if (!slots.length) return null;
  return (
    <Deck
      {...rest}
      label={label}
      aspect={PLATE_ASPECT[format ?? slots[0].format]}
      items={slots.map((slot, i) => (
        <>
          <LandingPlate slot={slot} fill priority={i === 0} />
          {slot.source ? null : <span className="deck-i mono" aria-hidden="true">{i + 1}</span>}
        </>
      ))}
    />
  );
}
