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
  /** Render slots that have no art yet as labelled reserved geometry. Dev-only. */
  showPlaceholders?: boolean;
}

/** A deck of plates — the run of work the page shows. The mechanic lives in `Deck`; this fills
 *  it with the slot registry's plates and their reserved crop. */
export function PlateDeck({ slots, label, format, showPlaceholders = false, ...rest }: PlateDeckProps) {
  // A run with nothing in it does not appear. The page ships without its imagery rather than
  // with a grid of grey boxes, and each run turns itself on the moment its plates land — which
  // is the whole point of the slots being one edit away from filled.
  const run = showPlaceholders ? slots : slots.filter((s) => s.source !== null);
  if (!run.length) return null;
  return (
    <Deck
      {...rest}
      label={label}
      aspect={PLATE_ASPECT[format ?? run[0].format]}
      /* No second composition. A plate's format is the shape its art was made at, so the crop
         that flatters it on a desktop is the same crop on a phone — and the run used to take a
         2:3 here, which cropped an already-cropped banner down to a column of its middle. What
         changes on a narrow screen is the card's size, not its shape. */
      items={run.map((slot, i) => (
        <>
          <LandingPlate slot={slot} fill priority={i === 0} />
          {slot.source ? null : <span className="lp-deck-i mono" aria-hidden="true">{i + 1}</span>}
        </>
      ))}
    />
  );
}
