// walk/muse-fixtures.ts — canned data for the populated muse walk (noema/muse-is-the-jewel).
// Typed against the web client's own `../src/lib/api`, same convention as
// `collection-fixtures.ts`: a shape the real client no longer sends fails this file at
// compile time instead of silently drifting out of sync.
//
// One dataset, one session, eight settled pieces and one still generating — enough floor
// (fragments), nozzle (model stack) and stream for every piece of standing muse chrome the
// goal names (floor, chips, steer dock, stageline, nozzle) to render in its ordinary,
// populated state, not an empty one. Nothing here is random: a second run of this walk
// against the same fixtures diffs clean.

import type {
  Dataset, Fragment, FragmentCategory, FlowSummary, FlowDescription, ModelCard,
  MuseSessionView, MuseFloorEntry, MusePiece, MuseKeptRoll, Run,
} from '../src/lib/api';

export const DATASET_ID = 'fx-dataset';
export const SESSION_ID = 'fx-session';
export const FLOW_ID = 'fx-flow-make';
export const RUNNING_RUN_ID = 'fx-run-9';

/** Same deterministic hash `collection-fixtures.ts` uses, so two runs of this walk diff
 *  clean rather than on a re-rolled colour. */
function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** An inline SVG "piece", served same-origin from the fixture server at `/v1/media/:id.svg` —
 *  a placeholder for the generation itself, never a real image host. The chrome judgement
 *  this walk feeds is about what stands between the viewer and the picture, not about the
 *  picture's own fidelity — the before/after pack says so beside every shot that carries one. */
export function mediaSvg(id: string): string {
  const hue = hashHue(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="960">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 45% 32%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 25) % 360} 55% 14%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="768" height="960" fill="url(#g)"/>` +
    `<ellipse cx="384" cy="420" rx="210" ry="260" fill="hsl(${(hue + 40) % 360} 35% 55%)" opacity="0.55"/>` +
    `<text x="384" y="905" font-family="monospace" font-size="22" fill="white" opacity="0.8" text-anchor="middle">${id}</text>` +
    `</svg>`;
}

const FRAGMENTS: Fragment[] = [
  { category: 'subject', text: 'a woman with sharp, unhurried eyes', source: 'decompose', trigger: '' },
  { category: 'hair', text: 'wind-blown black hair, loose', source: 'decompose', trigger: '' },
  { category: 'outfit', text: 'cropped leather jacket over a plain tee', source: 'decompose', trigger: '' },
  { category: 'pose', text: 'three-quarter turn, chin lifted', source: 'decompose', trigger: '' },
  { category: 'expression', text: 'soft, knowing half-smile', source: 'decompose', trigger: '' },
  { category: 'props', text: 'gold hoop earrings', source: 'decompose', trigger: '' },
  { category: 'setting', text: 'empty parking garage, night', source: 'decompose', trigger: '' },
  { category: 'style', text: '35mm film grain, slight halation', source: 'decompose', trigger: '' },
  { category: 'palette', text: 'warm amber against cool concrete', source: 'decompose', trigger: '' },
  { category: 'lighting', text: 'single hard sodium streetlamp', source: 'decompose', trigger: '' },
  { category: 'mood', text: 'confident, unhurried', source: 'decompose', trigger: '' },
];

function floorKey(f: Pick<Fragment, 'category' | 'text'>): string {
  return `${f.category}:${f.text}`;
}

// One fragment held OFF the draw (`props` — the earrings), so the floor's own "disabled,
// still listed, still tappable back to live" state (muse.css:168-171) has something real to
// show rather than being inferred from the stylesheet alone.
const FLOOR: MuseFloorEntry[] = FRAGMENTS.map((f) => ({
  key: floorKey(f),
  enabled: f.category !== 'props',
  weight: f.category === 'subject' || f.category === 'setting' ? 1 : 0.6,
}));

const CATEGORIES_FOR_PIECES: FragmentCategory[][] = [
  ['subject', 'hair', 'setting', 'lighting'],
  ['subject', 'outfit', 'pose', 'style'],
  ['subject', 'expression', 'setting', 'palette'],
  ['subject', 'hair', 'outfit', 'mood'],
  ['subject', 'pose', 'lighting', 'style'],
  ['subject', 'setting', 'palette', 'expression'],
  ['subject', 'hair', 'mood', 'lighting'],
  ['subject', 'outfit', 'setting', 'style'],
];

function lineageFor(categories: FragmentCategory[]): Fragment[] {
  return FRAGMENTS.filter((f) => categories.includes(f.category));
}

export const PIECES: MusePiece[] = CATEGORIES_FOR_PIECES.map((cats, i) => ({
  runId: `fx-run-${i + 1}`,
  rollIndex: i,
  fragments: lineageFor(cats),
  saved: i % 3 === 0,
  dismissed: false,
  ...(i === 0 ? { reaction: 'up' as const } : i === 4 ? { reaction: 'down' as const } : {}),
}));
// The ninth piece is still generating — never recorded with a reaction/save, same as any
// run that hasn't settled yet.
PIECES.push({
  runId: RUNNING_RUN_ID,
  rollIndex: 8,
  fragments: lineageFor(['subject', 'outfit', 'setting', 'lighting', 'mood']),
  saved: false,
  dismissed: false,
});

export const KEPT_ROLLS: MuseKeptRoll[] = [
  { prompt: 'a woman with sharp, unhurried eyes, wind-blown black hair, empty parking garage, night, single hard sodium streetlamp', paid: false },
  { prompt: 'a woman with sharp, unhurried eyes, cropped leather jacket, three-quarter turn, chin lifted, 35mm film grain', paid: true },
];

export const FLOWS: FlowSummary[] = [
  { id: FLOW_ID, nomen: 'Make', versio: '1', modusGenus: 'make', categoria: 't2i', descriptio: 'text to image' },
];

export const FLOW_DESCRIPTION: FlowDescription = {
  id: FLOW_ID,
  nomen: 'Make',
  versio: '1',
  familia: 'sdxl',
  input: { type: 'object', properties: { prompt: { type: 'string', title: 'Prompt' } }, required: ['prompt'] },
};

export const MODELS: ModelCard[] = [
  {
    intellaId: 'fx-model-base', nomen: 'Base SDXL', genus: 'checkpoint', basis: 'sdxl',
    access: 'public', defaultWeight: 1,
  },
  {
    intellaId: 'fx-model-lora', nomen: 'Night Grain LoRA', genus: 'lora', basis: 'sdxl',
    trigger: 'nightgrain', access: 'public', defaultWeight: 0.8,
  },
];

export const SESSION: MuseSessionView = {
  id: SESSION_ID,
  owner: 'fx-owner',
  motherDatasetId: DATASET_ID,
  sessionDatasetId: `${DATASET_ID}-session`,
  fragments: FRAGMENTS,
  floor: FLOOR,
  pieces: PIECES,
  setup: {
    modusId: FLOW_ID,
    mode: 'batched',
    cap: 20,
    nozzle: [{ intellaId: 'fx-model-lora', nomen: 'Night Grain LoRA', trigger: 'nightgrain', weight: 0.8 }],
  },
  keptRolls: KEPT_ROLLS,
  natum: '2026-11-10T12:00:00.000Z',
  mutatum: '2026-11-19T09:00:00.000Z',
};

export const DATASET: Dataset = {
  id: DATASET_ID,
  owner: 'fx-owner',
  name: 'night garage portraits',
  modality: 'image',
  custody: 'remote',
  media: [1, 2, 3, 4].map((n) => ({
    id: `fx-media-${n}`,
    url: `/v1/media/fx-media-${n}.svg`,
    source: 'upload' as const,
    addedAt: '2026-11-01T00:00:00.000Z',
    fragments: lineageFor(['subject', 'setting', 'lighting']),
  })),
  captionsets: [],
  versions: [{ v: '1', count: 4, when: '2026-11-01T00:00:00.000Z' }],
  natum: '2026-11-01T00:00:00.000Z',
  mutatum: '2026-11-01T00:00:00.000Z',
};

/** A settled `Run` for every completed piece, keyed by runId — what both the SSE snapshot
 *  and the `GET /v1/runs/:id` poll fallback answer with. */
export const RUNS: Record<string, Run> = Object.fromEntries(
  PIECES.filter((p) => p.runId !== RUNNING_RUN_ID).map((p) => [
    p.runId,
    {
      id: p.runId,
      status: 'complete' as const,
      modusId: FLOW_ID,
      exitus: { image: `/v1/media/${p.runId}.svg` },
      cost: '0.04',
      createdAt: '2026-11-18T22:00:00.000Z',
    },
  ]),
);
RUNS[RUNNING_RUN_ID] = {
  id: RUNNING_RUN_ID,
  status: 'running' as Run['status'],
  modusId: FLOW_ID,
  createdAt: new Date().toISOString(),
};
