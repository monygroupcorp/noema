// Muse (dataset-wide garden, curate, roll) — the web app's front end onto the muse
// engine in `src/crystal/muse`. That module lives outside this app's own
// `tsconfig.json` `include` (see the note on `DatasetMediaItem` in `./api.ts`), but a
// direct relative import resolves fine through this app's own `tsc --noEmit` and
// `vite build` — verified before this file existed. Nothing below reimplements
// garden/roll/sampler/weaver logic; it is a thin, pure composition layer over it, so
// there is exactly one copy of that logic in the tree.
//
// This file is a barrel: the implementation lives in `./muse/*`, split by concern
// (garden/rolling, ignition, stream launch, mining, the stream itself, the live run
// readout, session resume, the session floor, the moodboard, archive controls, the
// steer sheet, the nozzle, setup persistence, the collapsing controls, the banner,
// session history, and activity). Every name that was importable from here before
// the split still is.

import {
  buildGarden,
  gardenCounts,
  type GardenBuild,
  type GardenDrops,
} from '../../../../../crystal/muse/garden.js';
import { rollReport, formatRoll, type RolledPrompt, type RollReport } from '../../../../../crystal/muse/roll.js';
import { CATEGORIES, type Category, type Garden } from '../../../../../crystal/muse/taxonomy.js';
import { MAX_FLOOR_FRAGMENTS, MAX_INSTRUCTION_CHARS } from '../../../../../crystal/muse/steer.js';
import type { Media } from './media';

export { buildGarden, gardenCounts, rollReport, formatRoll, CATEGORIES };
// The two steer bounds are the SERVER's — they live in `src/crystal/muse/steer.ts`, are
// enforced in the API layer and again in the cursor's `reserve()`, and are re-exported
// here so the keyboard mirrors them rather than keeping a second copy that can drift.
export { MAX_FLOOR_FRAGMENTS, MAX_INSTRUCTION_CHARS };
export type { GardenBuild, GardenDrops, RolledPrompt, RollReport, Category, Garden, Media };

export * from './muse/garden';
export * from './muse/ignition';
export * from './muse/launch';
export * from './muse/mining';
export * from './muse/stream';
export * from './muse/run-readout';
export * from './muse/session-resume';
export * from './muse/session';
export * from './muse/moodboard';
export * from './muse/archive-controls';
export * from './muse/steer';
export * from './muse/nozzle';
export * from './muse/setup-persistence';
export * from './muse/controls';
export * from './muse/banner';
export * from './muse/session-history';
export * from './muse/activity';
