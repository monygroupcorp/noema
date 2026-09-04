// landingPlates.ts — the landing page's plate slots, and the ONE place they are swapped.
//
// A "plate" is a piece of the demonstration visual world the landing page is built around.
// Every slot below declares the format, subject class and framing brief its plate must
// satisfy, and carries `source: null` until one lands.
//
// The six plates standing here are work made on the platform: each is a preview sample
// published by a model in the catalogue, and every one of those models is in `noema-art`
// on Hugging Face. That matters more than it looks. A landing page showing a stranger's
// output has to answer for the stranger's consent, and none of these do.
//
// Which model each plate came from, so the provenance survives without a second document:
//   deck-1 supernal   deck-2 fullyarmoredgirl   deck-3 colvilleflux-klein
//   deck-4 impresstation   deck-5 cheeseworld1flux-klein   coda-1 rugcoreflux-klein
//
// The three remaining coda slots are `null` on purpose rather than filled with the
// next-best thing. An unfilled slot renders nothing, so the coda is a one-card pass — which
// is what its own brief asks for, "the imagery returns once without ever becoming a
// gallery". A run does not get better by being longer.
//
// deck-2 is the one plate that is not a straight crop. Its sample is a mech on flat white,
// and the card it lands in is `#0c0e10`, so an untouched crop is a white slab punched into
// a near-black page. The ground is matted out instead — flood-filled from the border
// through bright neutral pixels only, so the mech's own white panels survive — and the
// plate ships with alpha rather than a baked ground, so it takes whatever the card is
// standing on if the theme ever changes.
//
// The limit worth recording rather than rediscovering: a deck card is a 1586px box at a
// 1440 viewport, so a 1024-wide plate is upscaled about 1.55x, and more on a 2x display.
// It reads soft. Cropping to a wide format spends height, not width, so there is no
// sharper version of these — the fix is art shot for the format, or a pass through the
// platform's own `4x-UltraSharp`, which is the whole point of the slot briefs above.
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
export type PlateFormat = '3:2' | '4:5' | '1:1' | '16:9' | '2:1' | '21:9' | '3:1';

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
  '21:9': 21 / 9,
  '3:1': 3,
};

/** The wide crops a deck card can run at, in the order the lab offers them. Wider is cheaper as
 *  well as more banner-like: at a fixed width, 21:9 is 14% fewer pixels than 2:1 and 3:1 is 33%
 *  fewer, so the crop decision is a bandwidth decision too. 3:2 is absent on purpose — at full
 *  banner width it is taller than a banner. */
export const DECK_FORMATS = ['16:9', '2:1', '21:9', '3:1'] as const satisfies readonly PlateFormat[];

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
    format: '21:9',
    subject: 'figure',
    brief:
      'The card held longest, and the one the page opens its imagery on. Composed for a wide crop with the subject off-centre left, so it still reads while the right fifth is covered by the next card.',
    source: {
      src: '/landing/plate-deck-1.webp',
      alt: 'A close crop of a green eye, framed by shattered crystal and printed graphic edges.',
      width: 1024,
      height: 439,
    },
  },
  {
    id: 'deck-2',
    name: 'deck',
    section: 'deck',
    format: '21:9',
    subject: 'mechanical',
    brief: 'Arrives from behind the first card. Its left edge is seen before anything else of it, so the left edge has to be worth seeing.',
    source: {
      src: '/landing/plate-deck-2.webp',
      alt: 'A white and yellow armoured mech with shoulder cannons, a small pilot at its centre, cut out against the page.',
      width: 1024,
      height: 439,
    },
  },
  {
    id: 'deck-3',
    name: 'deck',
    section: 'deck',
    format: '21:9',
    subject: 'illustrated',
    brief: 'The change of register at the middle of the run — drawn where the neighbours are photographed, same light, same grade.',
    source: {
      src: '/landing/plate-deck-3.webp',
      alt: 'A hound with its head down, nosing across a bare snow-streaked slope.',
      width: 1024,
      height: 439,
    },
  },
  {
    id: 'deck-4',
    name: 'deck',
    section: 'deck',
    format: '21:9',
    subject: 'figure',
    brief: 'Returns to the figure after the illustrated card, so the run reads as a loop rather than a list.',
    source: {
      src: '/landing/plate-deck-4.webp',
      alt: 'A figure in sunglasses below a glass tower, in the flat look of an early-2000s game.',
      width: 1024,
      height: 439,
    },
  },
  {
    id: 'deck-5',
    name: 'deck',
    section: 'deck',
    format: '21:9',
    subject: 'illustrated',
    brief: 'The card left standing when the banner exits. It is the last thing seen, so it carries the closing note of the run.',
    source: {
      src: '/landing/plate-deck-5.webp',
      alt: 'A rhinoceros in a suit at a control console, watching a tower of cheese in orbit.',
      width: 1024,
      height: 439,
    },
  },

  // The coda run. A second, smaller pass further down the page, so the imagery returns once
  // without ever becoming a gallery. Shorter run, shorter cards, same mechanism.
  {
    id: 'coda-1',
    name: 'coda',
    section: 'deck-coda',
    format: '2:1',
    subject: 'illustrated',
    brief: 'Opens the second pass in the register the first one closed away from.',
    source: {
      src: '/landing/plate-coda-1.webp',
      alt: 'A millefleurs tapestry: a unicorn resting inside a low round fence beneath a tree.',
      width: 1024,
      height: 512,
    },
  },
  {
    id: 'coda-2',
    name: 'coda',
    section: 'deck-coda',
    format: '2:1',
    subject: 'figure',
    brief: 'Tighter crop than anything in the first run — the second pass is closer, not louder.',
    source: null,
  },
  {
    id: 'coda-3',
    name: 'coda',
    section: 'deck-coda',
    format: '2:1',
    subject: 'mechanical',
    brief: 'Detail rather than whole object; the run has already established the object.',
    source: null,
  },
  {
    id: 'coda-4',
    name: 'coda',
    section: 'deck-coda',
    format: '2:1',
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
