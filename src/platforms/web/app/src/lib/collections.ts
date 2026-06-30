// editio — NOEMA's NFT-collection authoring (editio-overview.md). A collection is a hub
// (traits garden → rules → canonic run → curation → export). Local-first; the hemisphere
// flips to lit (public) only at the export crossing → NOESIS. No backend yet.
// TODO(backend: collection records — traits, rules, supply, custody, export adapters).

export type CollStatus = 'draft' | 'locked' | 'minted';

export interface Collection {
  id: string;
  name: string;
  theme: string;          // the collection's aesthetic family
  supply: number;         // pieces
  target: number;         // target supply
  traits: number;
  status: CollStatus;
  rarityDelta: string;    // ±x% of rarity target
  tile: string;
}

export const COLLECTIONS: Collection[] = [
  { id: 'lumen-heads', name: 'Lumen Heads', theme: 'Frost · Ember · Arcane', supply: 1889, target: 1889, traits: 4, status: 'locked', rarityDelta: '±0.4%', tile: 'radial-gradient(120% 100% at 40% 30%, #3b4f78, #1b2740)' },
  { id: 'sumi-spirits', name: 'Sumi Spirits', theme: 'Ink · Mist', supply: 512, target: 1000, traits: 3, status: 'draft', rarityDelta: '±1.2%', tile: 'radial-gradient(120% 100% at 55% 35%, #2f4a44, #18241f)' },
  { id: 'frost-drakes', name: 'Frost Drakes', theme: 'Frost', supply: 888, target: 888, traits: 5, status: 'minted', rarityDelta: '±0.2%', tile: 'radial-gradient(120% 100% at 50% 30%, #2c5d54, #16241f)' },
];

export const STATUS_LABEL: Record<CollStatus, string> = { draft: 'draft', locked: 'supply locked', minted: 'minted · live' };
