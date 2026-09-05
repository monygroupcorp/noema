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
// THE FORMAT IS THE ART'S OWN. Every one of these models composes square, because that is
// what the platform's image flows produce; `fullyarmoredgirl` is the one exception and it
// composes 2:3. An earlier version of this file ran the deck as a 21:9 banner and shipped
// each plate pre-cropped to 1024x439 to fill it, which threw away 57% of every picture: the
// mech lost its legs, the figure lost the top of its head, the hound lost its back. There is
// no framing brief a plate can satisfy while a crop like that is between it and the reader.
// So the run is square and the plates are their masters, uncropped, and the deck is sized
// from a height budget instead of the page width — see plate-deck.css.
//
// deck-2 is the one plate that is not its master untouched. Its sample is a mech on flat
// white, and the card it lands in is `#0c0e10`, so an untouched plate is a white slab punched
// into a near-black page. The ground is matted out instead — flood-filled from the border
// through bright neutral pixels only, so the mech's own white panels survive — and the plate
// ships with alpha rather than a baked ground, so it takes whatever the card is standing on
// if the theme ever changes. Its 2:3 cutout is then padded to square on transparency rather
// than cropped to it: padding a cutout adds nothing a reader can see, where cropping it would
// cost the legs again.
//
// The resolution question, recorded rather than rediscovered: the deck card is now bounded by
// height, so at a 1440x900 viewport it is about a 660px square rather than a 1586px banner —
// a 1024 master is downscaled into it instead of being blown up 1.55x. The plates read sharp
// at 1x and hold up at 2x. That is the same change that fixed the framing; it was the
// full-bleed banner costing both.
//
// THE SWAP: fill a slot's `source` in this file. Nothing else in the app names an image
// path, so replacing placeholders with finished plates is one edit here, not a hunt through
// components. `validatePlateSource` (below) holds the format contract at that moment: a
// source whose pixel dimensions disagree with its declared format fails the unit test rather
// than silently reshaping the layout it was measured into.

/** The formats a plate is composed for. 1:1 is the master, because it is the shape the
 *  platform's image flows produce and therefore the shape everything in the catalogue is
 *  actually made at; 4:5 and 3:2 are the supporting crops a plate can survive. The wide
 *  ratios are kept so the lab can still put a banner crop next to the square and show what it
 *  costs — they are a comparison, not a destination. */
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

/** The crops a deck card can run at, in the order the lab offers them. 1:1 leads because it is
 *  the shape the art arrives in; the rest are there so the cost of leaving it can be seen
 *  rather than argued. A deck card is no longer the full page width — it is bounded by a height
 *  budget and centred — so a square card is a square, not a page-tall slab, and how wide the
 *  card runs no longer decides how much of the picture survives. */
export const DECK_FORMATS = ['1:1', '4:5', '3:2', '16:9', '2:1'] as const satisfies readonly PlateFormat[];

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
  // The deck run. These are the images the page actually shows: a fanned pile the visitor
  // scrolls past, where the leading card covers the rest and the next one is squared off just
  // behind its right edge. The images are never stood up in front of the reader — they pass.
  //
  // The run is ordered, and the order is the composition: card 1 is the one seen longest and
  // is effectively the hero, the last is the one left standing when the run exits. Subject
  // classes alternate so the claim that the look survives a change of subject is made by the
  // motion itself rather than by a caption.
  {
    id: 'deck-1',
    name: 'deck',
    section: 'deck',
    format: '1:1',
    subject: 'figure',
    brief:
      'The card held longest, and the one the page opens its imagery on. The subject sits off-centre left, so it still reads while the right edge is covered by the next card.',
    source: {
      src: '/landing/plate-deck-1.webp',
      alt: 'A face turned toward the viewer, one green eye open, framed by shattered crystal and printed graphic edges.',
      width: 1024,
      height: 1024,
    },
  },
  {
    id: 'deck-2',
    name: 'deck',
    section: 'deck',
    format: '1:1',
    subject: 'mechanical',
    brief: 'Arrives from behind the first card. Its left edge is seen before anything else of it, so the left edge has to be worth seeing.',
    source: {
      src: '/landing/plate-deck-2.webp',
      alt: 'A white and yellow armoured mech standing at full height, shoulder cannons raised, a small pilot at its centre, cut out against the page.',
      width: 768,
      height: 768,
    },
  },
  {
    id: 'deck-3',
    name: 'deck',
    section: 'deck',
    format: '1:1',
    subject: 'illustrated',
    brief: 'The change of register at the middle of the run — drawn where the neighbours are photographed, same light, same grade.',
    source: {
      src: '/landing/plate-deck-3.webp',
      alt: 'A hound with its head down, nosing across a bare snow-streaked slope below a dark treeline.',
      width: 1024,
      height: 1024,
    },
  },
  {
    id: 'deck-4',
    name: 'deck',
    section: 'deck',
    format: '1:1',
    subject: 'figure',
    brief: 'Returns to the figure after the illustrated card, so the run reads as a loop rather than a list.',
    source: {
      src: '/landing/plate-deck-4.webp',
      alt: 'A figure in sunglasses standing below a glass tower, in the flat look of an early-2000s game, heads-up display in the corner.',
      width: 1024,
      height: 1024,
    },
  },
  {
    id: 'deck-5',
    name: 'deck',
    section: 'deck',
    format: '1:1',
    subject: 'illustrated',
    brief: 'The card left standing when the run exits. It is the last thing seen, so it carries the closing note of the run.',
    source: {
      src: '/landing/plate-deck-5.webp',
      alt: 'A rhinoceros in a suit at a control console, watching a tower of cheese in orbit through a porthole.',
      width: 1024,
      height: 1024,
    },
  },

  // The coda run. A second, smaller pass further down the page, so the imagery returns once
  // without ever becoming a gallery. Shorter run, smaller cards, same mechanism and the same
  // square — a coda that changed shape would read as a different kind of thing, not a reprise.
  {
    id: 'coda-1',
    name: 'coda',
    section: 'deck-coda',
    format: '1:1',
    subject: 'illustrated',
    brief: 'Opens the second pass in the register the first one closed away from.',
    source: {
      src: '/landing/plate-coda-1.webp',
      alt: 'A millefleurs tapestry, framed: a unicorn resting inside a low round fence beneath a tree.',
      width: 1024,
      height: 1024,
    },
  },
  {
    id: 'coda-2',
    name: 'coda',
    section: 'deck-coda',
    format: '1:1',
    subject: 'figure',
    brief: 'Tighter crop than anything in the first run — the second pass is closer, not louder.',
    source: null,
  },
  {
    id: 'coda-3',
    name: 'coda',
    section: 'deck-coda',
    format: '1:1',
    subject: 'mechanical',
    brief: 'Detail rather than whole object; the run has already established the object.',
    source: null,
  },
  {
    id: 'coda-4',
    name: 'coda',
    section: 'deck-coda',
    format: '1:1',
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
