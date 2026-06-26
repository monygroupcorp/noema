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
}

export const counts = (p: Project) => ({
  chats: p.chats.length, cards: p.cards.length, canvases: p.canvases.length, gens: p.gens,
});

export const PROJECTS: Project[] = [
  {
    id: 'personal', name: 'Personal', glyph: '◇', color: '#9aa3b8',
    desc: 'Your default space — anything not filed into a project lands here.',
    updated: 'just now',
    chats: [{ id: 'c1', title: 'low-poly dragon, dusk', when: 'today' }],
    cards: [{ id: 'flux-schnell', name: 'FLUX Schnell', verb: 'make' }],
    canvases: [],
    gens: 18,
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
  },
  {
    id: 'brand', name: 'Brand Identity', glyph: 'B', color: '#5fd0a8',
    desc: 'Logo explorations, type, and marks for the studio.',
    updated: '1d ago',
    chats: [{ id: 'c1', title: 'monogram directions', when: '1d ago' }],
    cards: [{ id: 'dalleiii', name: 'DALL·E III', verb: 'make' }],
    canvases: [{ id: 'cv1', name: 'logo → variations', nodes: 3 }],
    gens: 27,
  },
  {
    id: 'mv', name: 'Music Video', glyph: 'M', color: '#d66f9a',
    desc: 'Shots + animation for the single. Shared with the band.',
    shared: 2, updated: '4d ago',
    chats: [{ id: 'c1', title: 'verse 2 — underwater', when: '4d ago' }],
    cards: [{ id: 'ltx-video', name: 'LTX Video', verb: 'animate' }],
    canvases: [],
    gens: 41,
  },
];
