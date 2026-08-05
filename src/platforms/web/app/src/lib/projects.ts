// A project is not a new noun — it's a named SLICE across the axes the app already has.
// Create axis = chat / card / canvas; Remember axis = space. A project scopes all of them:
// its chat histories, its saved cards, its canvases, its filtered space. It is also the unit
// of SHARING (a shared context with collaborators). So "project" is the active workspace lens,
// exactly like the active identity/execution — selected once, read everywhere.

export interface ProjChat { id: string; title: string; when: string }
export interface ProjCard { id: string; name: string; verb: string }
export interface ProjCanvas { id: string; name: string; nodes: number }

export interface Project {
  id: string;
  name: string;
  glyph: string;
  color: string;
  desc: string;
  shared?: number;          // collaborator count — present = a shared context
  updated: string;          // relative
  chats: ProjChat[];
  cards: ProjCard[];
  canvases: ProjCanvas[];
  gens: number;             // creations in the project's slice of the space
  // Holdings — id references into the canonical asset stores (Provincia.res). For a
  // backend-backed project these are real; for the anon/mock path they default to [].
  datasetIds: string[];
  modelIds: string[];
  collectionIds: string[];
  teamId?: string;          // referenced Team (Sodalitas) — the shared member set
}

export const counts = (p: Project) => ({
  chats: p.chats.length, cards: p.cards.length, canvases: p.canvases.length, gens: p.gens,
  datasets: p.datasetIds.length, models: p.modelIds.length, collections: p.collectionIds.length,
});

// Map a server RemoteProject onto the client Project, layering any client-local view
// state (chats/canvases/favorites/gens) that has no backend store yet. Holdings + identity
// come from the server; the overlay fills the ephemeral axes.
export function fromRemote(
  r: {
    id: string; name: string; desc?: string; glyph?: string; color?: string;
    datasetIds: string[]; modelIds: string[]; collectionIds: string[]; teamId?: string; updatedAt: string;
  },
  overlay?: Partial<Pick<Project, 'chats' | 'cards' | 'canvases' | 'gens' | 'shared'>>,
): Project {
  return {
    id: r.id,
    name: r.name,
    glyph: r.glyph || r.name.charAt(0).toUpperCase() || '◇',
    color: r.color || '#9aa3b8',
    desc: r.desc ?? '',
    updated: relTime(r.updatedAt),
    chats: overlay?.chats ?? [],
    cards: overlay?.cards ?? [],
    canvases: overlay?.canvases ?? [],
    gens: overlay?.gens ?? 0,
    ...(overlay?.shared !== undefined ? { shared: overlay.shared } : {}),
    datasetIds: r.datasetIds,
    modelIds: r.modelIds,
    collectionIds: r.collectionIds,
    ...(r.teamId !== undefined ? { teamId: r.teamId } : {}),
  };
}

// Coarse relative-time from an ISO string — the UI only shows "just now / Nh ago / Nd ago".
function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'recently';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const PROJECTS: Project[] = [
  {
    id: 'personal', name: 'Personal', glyph: '◇', color: '#9aa3b8',
    desc: 'Your default space — anything not filed into a project lands here.',
    updated: 'just now',
    chats: [{ id: 'c1', title: 'low-poly dragon, dusk', when: 'today' }],
    cards: [{ id: 'flux-schnell', name: 'FLUX Schnell', verb: 'make' }],
    canvases: [],
    gens: 18,
    datasetIds: [], modelIds: [], collectionIds: [],
  },
  {
    id: 'dragon', name: 'Dragon Game', glyph: 'D', color: '#5b8cff',
    desc: 'Concept art + assets for the N64-style dragon game.',
    shared: 3, updated: '2h ago',
    chats: [
      { id: 'c1', title: 'neon temple, dusk lighting', when: 'today' },
      { id: 'c2', title: 'wyvern silhouettes', when: 'yesterday' },
      { id: 'c3', title: 'boss arena moodboard', when: '2d ago' },
    ],
    cards: [
      { id: 'flux-schnell', name: 'FLUX Schnell', verb: 'make' },
      { id: 'ltx-video', name: 'LTX Video', verb: 'animate' },
    ],
    canvases: [{ id: 'cv1', name: 'character turnaround', nodes: 4 }],
    gens: 64,
    datasetIds: [], modelIds: [], collectionIds: [],
  },
  {
    id: 'brand', name: 'Brand Identity', glyph: 'B', color: '#5fd0a8',
    desc: 'Logo explorations, type, and marks for the studio.',
    updated: '1d ago',
    chats: [{ id: 'c1', title: 'monogram directions', when: '1d ago' }],
    cards: [{ id: 'dalleiii', name: 'DALL·E III', verb: 'make' }],
    canvases: [{ id: 'cv1', name: 'logo → variations', nodes: 3 }],
    gens: 27,
    datasetIds: [], modelIds: [], collectionIds: [],
  },
  {
    id: 'mv', name: 'Music Video', glyph: 'M', color: '#d66f9a',
    desc: 'Shots + animation for the single. Shared with the band.',
    shared: 2, updated: '4d ago',
    chats: [{ id: 'c1', title: 'verse 2 — underwater', when: '4d ago' }],
    cards: [{ id: 'ltx-video', name: 'LTX Video', verb: 'animate' }],
    canvases: [],
    gens: 41,
    datasetIds: [], modelIds: [], collectionIds: [],
  },
];
