// workModes.ts — the rooms of the product, and where their screenshots go.
//
// The landing page shows what working here looks like. STANDARD §6 bans fake dashboards and
// invented product screens outright, so every shot in this registry is a capture of a real
// screen or the slot stays empty. Filling one is an edit here and nothing else.

export interface ModeShot {
  src: string;
  /** Describes the screen for anyone who cannot see it. Required. */
  alt: string;
  width: number;
  height: number;
}

export interface WorkMode {
  id: string;
  name: string;
  /** What the room is for, in the fewest words that are still true. */
  line: string;
  /** Where the room is, so the card can be a door rather than a picture. */
  route: string;
  /** null until a real capture lands. Never a mockup. */
  shot: ModeShot | null;
  /** Whether the screen needs a populated session before a capture is worth showing. Recorded
   *  so an empty capture is a known gap rather than a disappointing surprise: `/canvas` and
   *  `/datasets/:id/muse` render honest but empty for a signed-out visitor. */
  needsSession?: boolean;
}

export const WORK_MODES: WorkMode[] = [
  {
    id: 'concierge',
    name: 'Concierge',
    line: 'Say what you want. It picks the tools and runs them.',
    route: '/chat',
    shot: null,
    needsSession: true,
  },
  {
    id: 'catalogue',
    name: 'Catalogue',
    line: 'Every model the platform carries, one row each.',
    route: '/catalog',
    shot: null,
  },
  {
    id: 'canvas',
    name: 'Canvas',
    line: 'Wire tools together into a workflow you can run again.',
    route: '/canvas',
    shot: null,
    needsSession: true,
  },
  {
    id: 'muse',
    name: 'Muse',
    line: 'Turn material into a vocabulary, then make from it.',
    route: '/datasets',
    shot: null,
    needsSession: true,
  },
  {
    id: 'training',
    name: 'Datasets & training',
    line: 'Build the set, caption it, train the identity.',
    route: '/datasets',
    shot: null,
  },
  {
    id: 'collections',
    name: 'Collections',
    line: 'Assemble a body of work and take it to market.',
    route: '/collections',
    shot: null,
  },
];

/** How many rooms have a real capture behind them. */
export function shotCount(modes: WorkMode[] = WORK_MODES): { filled: number; total: number } {
  return { filled: modes.filter((m) => m.shot !== null).length, total: modes.length };
}
