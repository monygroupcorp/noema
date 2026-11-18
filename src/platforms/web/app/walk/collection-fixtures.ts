// walk/collection-fixtures.ts — canned data for the populated collection walk. Typed against
// the web client's own `../src/lib/api` and `../src/lib/editio` modules (never redeclared), so
// a shape the real client no longer sends fails this file at compile time instead of silently
// drifting out of sync.
//
// Three collections, one per lifecycle moment the goal names: a draft still being authored, a
// run in flight with pieces landing and some awaiting review, and a finished run whose export
// screen is walked both before and after a publish (see collection-walk.ts) to also stand for
// the fourth, "export", moment — the NFT-hosting flow this harness exists to put in front of a
// critique for the first time.

import type { Collection, CollectionPiece, FlowSummary, RarityReport, Tractus } from '../src/lib/api';
import type { Editio } from '../src/lib/editio';

/** A tiny deterministic hash so each piece gets a stable-but-distinct tile colour, the same way
 *  `collTile()` does for a real actum id — never random, so two runs of this walk diff clean. */
function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** An inline SVG "piece", served same-origin from the fixture server at `/v1/media/:id.svg` —
 *  never a real image host, so a shot of a populated run never sends a request off the box. */
export function mediaSvg(id: string): string {
  const hue = hashHue(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
    `<rect width="512" height="512" fill="hsl(${hue} 55% 22%)"/>` +
    `<circle cx="256" cy="256" r="160" fill="hsl(${(hue + 40) % 360} 65% 45%)"/>` +
    `<text x="256" y="480" font-family="monospace" font-size="20" fill="white" text-anchor="middle">${id}</text>` +
    `</svg>`;
}

export const TRACTUS: Tractus[] = [
  {
    porta: 'background', label: 'Background',
    valores: [
      { value: 'a neon city street at night', label: 'Neon street', rarity: 0.5 },
      { value: 'a quiet forest clearing at dawn', label: 'Forest dawn', rarity: 0.3 },
      { value: 'a marble hall lit by candlelight', label: 'Marble hall', rarity: 0.2 },
    ],
  },
  {
    porta: 'character', label: 'Character',
    valores: [
      { value: 'a fox in a tailored coat', label: 'Fox', rarity: 0.4 },
      { value: 'a heron made of brass', label: 'Brass heron', rarity: 0.35 },
      { value: 'a small comet with a trailing scarf', label: 'Comet', rarity: 0.25 },
    ],
  },
];

const BASE_PROMPT = '{{character}}, standing in {{background}}, studio lighting, collectible art style';
const MODUS_ID = 'modus.gpt-image';

export const DRAFT_ID = 'fx-draft';
export const INFLIGHT_ID = 'fx-inflight';
export const FINISHED_ID = 'fx-finished';

const draft: Collection = {
  id: DRAFT_ID,
  nomen: 'Brass & Neon',
  descriptio: 'a small set pairing clockwork animals with city-at-night backdrops',
  status: 'draft',
  modusId: MODUS_ID,
  total: 24,
  provenanceHash: '0xdraft00000000000000000000000000000000000000000000000000000000',
  tractus: TRACTUS,
  basePrompt: BASE_PROMPT,
  reviewEnabled: true,
  completed: 0,
  failed: 0,
  rejected: 0,
  inFlight: 0,
  pendingReview: 0,
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
};

const inflight: Collection = {
  id: INFLIGHT_ID,
  nomen: 'Brass & Neon — run one',
  descriptio: 'a small set pairing clockwork animals with city-at-night backdrops',
  status: 'running',
  modusId: MODUS_ID,
  total: 100,
  provenanceHash: '0xinflight0000000000000000000000000000000000000000000000000000',
  tractus: TRACTUS,
  basePrompt: BASE_PROMPT,
  reviewEnabled: true,
  paused: false,
  inFlight: 9,
  pendingReview: 6,
  completed: 41,
  failed: 2,
  rejected: 3,
  cost: '1240000',
  createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
};

const finished: Collection = {
  id: FINISHED_ID,
  nomen: 'Brass & Neon — run one',
  descriptio: 'a small set pairing clockwork animals with city-at-night backdrops',
  status: 'complete',
  modusId: MODUS_ID,
  total: 60,
  provenanceHash: '0xfinished000000000000000000000000000000000000000000000000000',
  tractus: TRACTUS,
  basePrompt: BASE_PROMPT,
  reviewEnabled: true,
  inFlight: 0,
  pendingReview: 0,
  completed: 56,
  failed: 0,
  rejected: 4,
  cost: '1860000',
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
};

export const COLLECTIONS: Record<string, Collection> = {
  [DRAFT_ID]: draft,
  [INFLIGHT_ID]: inflight,
  [FINISHED_ID]: finished,
};

/** Every collection, newest first — what `GET /v1/collectiones` answers in one page. */
export const COLLECTIONS_LIST: Collection[] = [draft, inflight, finished]
  .slice()
  .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

function piece(collId: string, n: number, review: CollectionPiece['review']): CollectionPiece {
  const actumId = `${collId}-actum-${String(n).padStart(3, '0')}`;
  const bg = TRACTUS[0].valores[n % TRACTUS[0].valores.length];
  const ch = TRACTUS[1].valores[(n + 1) % TRACTUS[1].valores.length];
  return {
    actumId,
    review,
    output: { image: `/v1/media/${actumId}.svg` },
    attributes: [
      { trait_type: TRACTUS[0].label ?? TRACTUS[0].porta, value: bg.label ?? String(bg.value) },
      { trait_type: TRACTUS[1].label ?? TRACTUS[1].porta, value: ch.label ?? String(ch.value) },
    ],
  };
}

// In-flight run: 35 already approved, 3 rejected (rerolled), 6 still awaiting a verdict — the
// curation queue this walk puts in front of the critic.
const inflightPieces: CollectionPiece[] = [
  ...Array.from({ length: 35 }, (_, i) => piece(INFLIGHT_ID, i, 'approved')),
  ...Array.from({ length: 3 }, (_, i) => piece(INFLIGHT_ID, 35 + i, 'rejected')),
  ...Array.from({ length: 6 }, (_, i) => piece(INFLIGHT_ID, 38 + i, 'pending')),
];

const finishedPieces: CollectionPiece[] = [
  ...Array.from({ length: 56 }, (_, i) => piece(FINISHED_ID, i, 'approved')),
  ...Array.from({ length: 4 }, (_, i) => piece(FINISHED_ID, 56 + i, 'rejected')),
];

export const PIECES: Record<string, CollectionPiece[]> = {
  [DRAFT_ID]: [],
  [INFLIGHT_ID]: inflightPieces,
  [FINISHED_ID]: finishedPieces,
};

function rarityFor(pieces: CollectionPiece[]): RarityReport {
  const axes = TRACTUS.map((axis) => {
    const valores = axis.valores.map((v) => {
      const label = v.label ?? String(v.value);
      const realizedCount = pieces.filter((p) => p.attributes?.some((a) => a.trait_type === (axis.label ?? axis.porta) && a.value === label)).length;
      return {
        value: label,
        targetRarity: v.rarity ?? 1 / axis.valores.length,
        realizedCount,
        realizedRarity: pieces.length ? realizedCount / pieces.length : 0,
      };
    });
    return { trait_type: axis.label ?? axis.porta, valores };
  });
  return { totalPieces: pieces.length, axes };
}

export const RARITY: Record<string, RarityReport> = {
  [INFLIGHT_ID]: rarityFor(inflightPieces),
  [FINISHED_ID]: rarityFor(finishedPieces),
};

export const FLOWS: FlowSummary[] = [
  { id: 'modus.gpt-image', nomen: 'GPT Image', versio: '1', descriptio: 'Hosted text-to-image, fixed cost — no pod dependency.' },
  { id: 'modus.sdxl-illustrious', nomen: 'SDXL Illustrious', versio: '2', descriptio: 'Pod-hosted anime-leaning diffusion.' },
];

// Publications already on file, keyed by collection id — what `GET /v1/editiones?artifact=…`
// answers. Empty until the walk itself publishes one (see fixture-server.ts `POST /v1/editiones`).
export const EDITIONS: Record<string, Editio[]> = {
  [DRAFT_ID]: [],
  [INFLIGHT_ID]: [],
  [FINISHED_ID]: [],
};
