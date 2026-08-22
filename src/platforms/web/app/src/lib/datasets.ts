// Training data model (train-overview.md): the DATASET is the primitive — media + versions +
// captionsets; trainings derive from it; models land on the shelf. The backend now carries real
// Dataset records (`GET /v1/data/datasets/full`, `types/dataset.ts`) — the whole Datasets library
// (`Datasets.tsx`, `Dataset.tsx`, `CaptionJob.tsx`, `Derive.tsx`, `TrainRun.tsx`) fetches live
// data and no longer imports `DATASETS` below. It remains exported for `ProjectHub.tsx`'s
// dataset-name lookup (a separate, not-yet-migrated consumer, deliberately left alone here)
// and for Storybook/tests; not live data for the library screens above.

export type Modality = 'image' | 'video' | 'audio' | '3d';
export type Custody = 'sealed' | 'local' | 'remote';   // hemisphere: ring · dashed · lit
export type Readiness = 'ready' | 'needs-captioning' | 'thin';

// `captions` mirrors the server's `types/dataset.ts#Captionset` — caption text keyed by
// media id, sparse, optional.
export interface Captionset { id: string; name: string; method: string; custody: Custody; coverage: string; captions?: Record<string, string> }
export interface DatasetVersion { v: string; count: number; when: string }

export interface Dataset {
  id: string;
  name: string;
  modality: Modality;
  count: number;            // media items
  version: string;
  updated: string;
  size: string;
  custody: Custody;
  readiness: Readiness;
  tiles: string[];          // 4 mosaic tints (placeholder for real media)
  captionsets: Captionset[];
  versions: DatasetVersion[];
  trains: number;           // tracked derive links (feeds N trainings)
}

// noema-283 — the fragment garden under a media item on the dataset detail screen is collapsed
// by default (a decomposed set can put a dozen chips under every thumbnail). These are pure so
// the open/closed rule and the summary line are gated without a renderer.

// Whether a media item's garden is open, given the per-item open-id set the screen holds.
export const isGardenOpen = (openIds: ReadonlySet<string>, mediaId: string): boolean => openIds.has(mediaId);

// A NEW Set with `mediaId` flipped — never mutates `openIds`. Opening one item's garden must
// not open (or close) any other item's.
export const toggleGardenId = (openIds: ReadonlySet<string>, mediaId: string): Set<string> => {
  const next = new Set(openIds);
  if (next.has(mediaId)) next.delete(mediaId); else next.add(mediaId);
  return next;
};

// The closed-state summary line: how many fragments the item carries and, when any are
// currently excluded (`toggleFragment` in Dataset.tsx — unrelated to garden open/closed and
// left untouched by this file), how many. Empty string when there is nothing to summarize —
// the caller only renders this when `fragmentCount > 0`.
export const gardenSummaryLine = (fragmentCount: number, excludedCount: number): string => {
  if (fragmentCount <= 0) return '';
  const noun = `fragment${fragmentCount === 1 ? '' : 's'}`;
  return excludedCount > 0
    ? `${fragmentCount} ${noun} · ${excludedCount} excluded`
    : `${fragmentCount} ${noun}`;
};

// hemisphere glyph class for a custody value
export const custodyGlyph = (c: Custody): 'lit' | 'ring' | 'dashed' =>
  c === 'remote' ? 'lit' : c === 'sealed' ? 'ring' : 'dashed';
export const CUSTODY_LABEL: Record<Custody, string> = { sealed: 'sealed', local: 'local', remote: 'remote' };
export const MODALITY_TOKEN: Record<Modality, string> = {
  image: 'var(--m-image)', video: 'var(--m-video)', audio: 'var(--m-audio)', '3d': 'var(--m-3d)',
};

const CAPS = (n: number): Captionset[] => ([
  { id: 'nl', name: 'natural language', method: 'Florence-2', custody: 'remote', coverage: '12/12' },
  { id: 'booru', name: 'booru tags', method: 'WD14', custody: 'local', coverage: '12/12' },
  { id: 'trig', name: 'trigger-only', method: 'manual', custody: 'local', coverage: '12/12' },
] as Captionset[]).slice(0, n);

export const DATASETS: Dataset[] = [
  {
    id: 'frost-knight', name: 'Frost-knight set', modality: 'image', count: 12, version: 'v3',
    updated: '2d ago', size: '84 MB', custody: 'remote', readiness: 'ready', trains: 3,
    tiles: ['#2b3a5e', '#324063', '#2f5d56', '#33406b'],
    captionsets: CAPS(3),
    versions: [{ v: 'v3', count: 12, when: 'now' }, { v: 'v2', count: 9, when: '5d' }, { v: 'v1', count: 6, when: '2w' }],
  },
  {
    id: 'sumi', name: 'Sumi studies', modality: 'image', count: 40, version: 'v2',
    updated: '5d ago', size: '210 MB', custody: 'local', readiness: 'ready', trains: 1,
    tiles: ['#3a3a3f', '#34343a', '#2c4a44', '#2f2f37'],
    captionsets: CAPS(2),
    versions: [{ v: 'v2', count: 40, when: 'now' }, { v: 'v1', count: 22, when: '1w' }],
  },
  {
    id: 'drake', name: 'Drake refs', modality: 'image', count: 8, version: 'v1',
    updated: '1w ago', size: '52 MB', custody: 'remote', readiness: 'thin', trains: 0,
    tiles: ['#2f5d56', '#33406b', '#2b3a5e', '#324063'],
    captionsets: CAPS(1),
    versions: [{ v: 'v1', count: 8, when: 'now' }],
  },
  {
    id: 'loop', name: 'Loop refs', modality: 'video', count: 24, version: 'v1',
    updated: '3d ago', size: '1.2 GB', custody: 'remote', readiness: 'ready', trains: 2,
    tiles: ['#5e3a2b', '#634032', '#5a3a2c', '#4d3a2c'],
    captionsets: CAPS(1),
    versions: [{ v: 'v1', count: 24, when: 'now' }],
  },
  {
    id: 'product', name: 'Product shots', modality: 'image', count: 60, version: 'v4',
    updated: 'just now', size: '320 MB', custody: 'local', readiness: 'needs-captioning', trains: 0,
    tiles: ['#3a3a3f', '#34343a', '#2c2c33', '#2f2f37'],
    captionsets: [],
    versions: [{ v: 'v4', count: 60, when: 'now' }, { v: 'v3', count: 48, when: '2d' }],
  },
];

export const READINESS: Record<Readiness, { dot: string; label: string; action: string }> = {
  ready: { dot: 'good', label: 'ready to train', action: 'open ▸' },
  'needs-captioning': { dot: 'amber', label: 'needs captioning', action: 'caption ▸' },
  thin: { dot: 'amber', label: 'thin — add more images', action: 'open ▸' },
};
