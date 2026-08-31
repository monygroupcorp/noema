// landingPlates.ts — the landing page's plate slots, and the ONE place they are swapped.
//
// A "plate" is a piece of the demonstration visual world the landing page is built around.
// The plates themselves do not exist yet; their slots do. Every slot below declares the
// format, subject class and framing brief the finished plate must satisfy, and carries
// `source: null` until that plate lands.
//
// THE SWAP: fill a slot's `source` in this file. Nothing else in the app names an image
// path, so replacing placeholders with finished plates is one edit here, not a hunt through
// components. `validatePlateSource` (below) holds the format contract at that moment: a
// source whose pixel dimensions disagree with its declared format fails the unit test rather
// than silently reshaping the layout it was measured into.

/** The formats a plate is composed for. 3:2 is the master landscape and 4:5 the portrait
 *  supporting crop; 1:1 is the collection-grid tile. 16:9 and 2:1 exist because a card in the
 *  deck banner is a wide crop — a 3:2 plate at deck width is taller than a banner should be,
 *  so which of the three wide ratios the deck runs at is a real decision about what the art
 *  gets shot for. The lab renders all three so it can be settled by looking. */
export type PlateFormat = '3:2' | '4:5' | '1:1' | '16:9' | '2:1';

/** The three subject classes the house look must hold across. The demonstration identity is
 *  a *look*, not a subject — these vary on purpose, and the grade is what unifies them. */
export type SubjectClass = 'figure' | 'mechanical' | 'illustrated';

/** Where a slot sits in the page's argument. Both sections are deck runs: the page has one
 *  image mechanism, and standing an image up in a box is not it. */
export type PlateSection = 'deck' | 'deck-coda';

/** Width / height. Slots reserve this ratio before any art exists, so the layout built now is
 *  the layout the finished plates land into. */
export const PLATE_ASPECT: Record<PlateFormat, number> = {
  '3:2': 3 / 2,
  '4:5': 4 / 5,
  '1:1': 1,
  '16:9': 16 / 9,
  '2:1': 2,
};

/** The wide crops a deck card can run at, in the order the lab offers them. */
export const DECK_FORMATS = ['3:2', '16:9', '2:1'] as const satisfies readonly PlateFormat[];

export interface PlateSource {
  /** Desktop/master rendition. */
  src: string;
  /** The planned narrow crop. Composed at shoot time, never a squeeze of `src` — a plate is
   *  only finished when its 390px crop is a real composition. Omit to serve `src` at both. */
  narrow?: string;
  /** Describes the picture. Required: a plate with no alt text is not a finished plate. */
  alt: string;
  /** Intrinsic pixel dimensions of `src`, so the browser reserves the box and the format
   *  contract is checkable. */
  width: number;
  height: number;
}

export interface PlateSlot {
  id: string;
  /** Short human name, used to build the placeholder label. */
  name: string;
  section: PlateSection;
  format: PlateFormat;
  subject: SubjectClass;
  /** What this plate has to show. Internal direction, never rendered on the public page —
   *  public captions are not written here. */
  brief: string;
  /** `null` while this slot is a placeholder. */
  source: PlateSource | null;
}

export const PLATES: PlateSlot[] = [
  // The deck run. These are the images the page actually shows: a fanned banner the visitor
  // scrolls past, where the leading card holds most of the width and the next one peeks over
  // its right edge. The images are never stood up in front of the reader — they pass.
  //
  // The run is ordered, and the order is the composition: card 1 is the one seen longest and
  // is effectively the hero, the last is the one left standing when the banner exits. Subject
  // classes alternate so the claim that the look survives a change of subject is made by the
  // motion itself rather than by a caption.
  {
    id: 'deck-1',
    name: 'deck',
    section: 'deck',
    format: '2:1',
    subject: 'figure',
    brief:
      'The card held longest, and the one the page opens its imagery on. Composed for a wide crop with the subject off-centre left, so it still reads while the right fifth is covered by the next card.',
    source: null,
  },
  {
    id: 'deck-2',
    name: 'deck',
    section: 'deck',
    format: '2:1',
    subject: 'mechanical',
    brief: 'Arrives from behind the first card. Its left edge is seen before anything else of it, so the left edge has to be worth seeing.',
    source: null,
  },
  {
    id: 'deck-3',
    name: 'deck',
    section: 'deck',
    format: '2:1',
    subject: 'illustrated',
    brief: 'The change of register at the middle of the run — drawn where the neighbours are photographed, same light, same grade.',
    source: null,
  },
  {
    id: 'deck-4',
    name: 'deck',
    section: 'deck',
    format: '2:1',
    subject: 'figure',
    brief: 'Returns to the figure after the illustrated card, so the run reads as a loop rather than a list.',
    source: null,
  },
  {
    id: 'deck-5',
    name: 'deck',
    section: 'deck',
    format: '2:1',
    subject: 'mechanical',
    brief: 'The card left standing when the banner exits. It is the last thing seen, so it carries the closing note of the run.',
    source: null,
  },

  // The coda run. A second, smaller pass further down the page, so the imagery returns once
  // without ever becoming a gallery. Shorter run, shorter cards, same mechanism.
  {
    id: 'coda-1',
    name: 'coda',
    section: 'deck-coda',
    format: '16:9',
    subject: 'illustrated',
    brief: 'Opens the second pass in the register the first one closed away from.',
    source: null,
  },
  {
    id: 'coda-2',
    name: 'coda',
    section: 'deck-coda',
    format: '16:9',
    subject: 'figure',
    brief: 'Tighter crop than anything in the first run — the second pass is closer, not louder.',
    source: null,
  },
  {
    id: 'coda-3',
    name: 'coda',
    section: 'deck-coda',
    format: '16:9',
    subject: 'mechanical',
    brief: 'Detail rather than whole object; the run has already established the object.',
    source: null,
  },
  {
    id: 'coda-4',
    name: 'coda',
    section: 'deck-coda',
    format: '16:9',
    subject: 'illustrated',
    brief: 'The last image on the page. Quietest of the eight, and the one the closing action sits under.',
    source: null,
  },
];

export function isPlaceholder(slot: PlateSlot): boolean {
  return slot.source === null;
}

/** The text a placeholder block carries, e.g. "hero plate — 3:2 — figure". It names the
 *  reserved shape so a placeholder can never be mistaken for finished art. */
export function plateLabel(slot: PlateSlot): string {
  return `${slot.name} plate — ${slot.format} — ${slot.subject}`;
}

export function platesIn(section: PlateSection, slots: PlateSlot[] = PLATES): PlateSlot[] {
  return slots.filter((s) => s.section === section);
}

/** The format contract, enforced when a slot stops being a placeholder. Returns one string
 *  per problem; an empty array means the source honours the shape the layout reserved.
 *  Tolerance is half a percent — enough for an odd-pixel export, not enough to hide a crop
 *  that is quietly the wrong format. */
export function validatePlateSource(slot: PlateSlot): string[] {
  const src = slot.source;
  if (!src) return [];

  const problems: string[] = [];
  if (!src.alt.trim()) problems.push(`${slot.id}: source has no alt text`);
  if (src.width <= 0 || src.height <= 0) {
    problems.push(`${slot.id}: source dimensions must be positive`);
    return problems;
  }

  const want = PLATE_ASPECT[slot.format];
  const got = src.width / src.height;
  if (Math.abs(got - want) / want > 0.005) {
    problems.push(
      `${slot.id}: ${src.width}x${src.height} is ${got.toFixed(3)}, declared format ${slot.format} is ${want.toFixed(3)}`,
    );
  }
  return problems;
}
