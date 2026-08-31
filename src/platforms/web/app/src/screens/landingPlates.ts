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

/** The ruled formats. Master 3:2 landscape for hero plates, 4:5 portrait for supporting
 *  plates, 1:1 only for the collection-grid demonstration. */
export type PlateFormat = '3:2' | '4:5' | '1:1';

/** The three subject classes the house look must hold across. The demonstration identity is
 *  a *look*, not a subject — these vary on purpose, and the grade is what unifies them. */
export type SubjectClass = 'figure' | 'mechanical' | 'illustrated';

/** Where a slot sits in the page's argument. */
export type PlateSection = 'hero' | 'cross-subject' | 'collection';

/** Width / height. Slots reserve this ratio before any art exists, so the layout built now is
 *  the layout the finished plates land into. */
export const PLATE_ASPECT: Record<PlateFormat, number> = {
  '3:2': 3 / 2,
  '4:5': 4 / 5,
  '1:1': 1,
};

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
  {
    id: 'hero',
    name: 'hero',
    section: 'hero',
    format: '3:2',
    subject: 'figure',
    brief:
      'One plate held still and alone, confident enough not to need a grid. Reserves a low-contrast region for the headline; the narrow crop keeps that region.',
    source: null,
  },

  // The cross-subject row: one plate per class, the same grade on all three. This is the
  // argument that the identity is the look rather than the subject, so all three slots are
  // filled together or none of them are.
  {
    id: 'cross-figure',
    name: 'supporting',
    section: 'cross-subject',
    format: '4:5',
    subject: 'figure',
    brief: 'Composed, mid-thought, gaze off-camera. Cold key, one warm practical, real skin.',
    source: null,
  },
  {
    id: 'cross-mechanical',
    name: 'supporting',
    section: 'cross-subject',
    format: '4:5',
    subject: 'mechanical',
    brief: 'A built object with evident purpose and wear, with scale cues so it has mass.',
    source: null,
  },
  {
    id: 'cross-illustrated',
    name: 'supporting',
    section: 'cross-subject',
    format: '4:5',
    subject: 'illustrated',
    brief: 'Drawn, not rendered: visible mark-making, held-back colour, large flat areas.',
    source: null,
  },

  // The collection grid: square tiles that read as one arrangement. The classes cycle so the
  // grid itself carries the cross-subject claim at thumbnail size.
  {
    id: 'collection-1',
    name: 'collection',
    section: 'collection',
    format: '1:1',
    subject: 'figure',
    brief: 'Silhouette-legible at tile size; sits in the ground rather than on a card.',
    source: null,
  },
  {
    id: 'collection-2',
    name: 'collection',
    section: 'collection',
    format: '1:1',
    subject: 'mechanical',
    brief: 'Silhouette-legible at tile size; sits in the ground rather than on a card.',
    source: null,
  },
  {
    id: 'collection-3',
    name: 'collection',
    section: 'collection',
    format: '1:1',
    subject: 'illustrated',
    brief: 'Silhouette-legible at tile size; sits in the ground rather than on a card.',
    source: null,
  },
  {
    id: 'collection-4',
    name: 'collection',
    section: 'collection',
    format: '1:1',
    subject: 'figure',
    brief: 'Silhouette-legible at tile size; sits in the ground rather than on a card.',
    source: null,
  },
  {
    id: 'collection-5',
    name: 'collection',
    section: 'collection',
    format: '1:1',
    subject: 'mechanical',
    brief: 'Silhouette-legible at tile size; sits in the ground rather than on a card.',
    source: null,
  },
  {
    id: 'collection-6',
    name: 'collection',
    section: 'collection',
    format: '1:1',
    subject: 'illustrated',
    brief: 'Silhouette-legible at tile size; sits in the ground rather than on a card.',
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
