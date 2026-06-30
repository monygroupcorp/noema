// Trained models — the shelf (train-shelf-spec.md). A model = weights with custody + lineage +
// a royalty ledger. The shelf EARNS imagery (personal craft, unlike the Registry). No backend
// for model records yet. TODO(backend: model records — weights/custody/versions/lineage/royalty).
import type { Custody } from './datasets';

export interface ModelCard {
  id: string;
  name: string;
  kind: 'subject' | 'style';
  version: string;
  listed: boolean;             // royalty listing is opt-in; private is default-safe
  base: string;
  rank: string;
  trigger: string;
  runs: number;
  royalties: number | null;    // credits earned (null when private/unlisted)
  lineage: { dataset: string; version: string; captionset: string; custody: Custody };
  tile: string;                // sample-image placeholder
}

export const MODELS: ModelCard[] = [
  {
    id: 'frostknight-v1', name: 'Frost-knight', kind: 'subject', version: 'v1', listed: true,
    base: 'Flux.1 dev', rank: 'LoRA r16', trigger: 'frostknight', runs: 1204, royalties: 8210,
    lineage: { dataset: 'Frost-knight set', version: 'v3', captionset: 'natural v2', custody: 'sealed' },
    tile: 'radial-gradient(120% 100% at 40% 30%, #3b4f78, #1b2740)',
  },
  {
    id: 'frostknight-v2', name: 'Frost-knight', kind: 'subject', version: 'v2', listed: true,
    base: 'SDXL', rank: 'LoRA r32', trigger: 'frostknight', runs: 312, royalties: 2030,
    lineage: { dataset: 'Frost-knight set', version: 'v3', captionset: 'booru v1', custody: 'local' },
    tile: 'radial-gradient(120% 100% at 60% 40%, #34343f, #1c1c24)',
  },
  {
    id: 'inkwash-v1', name: 'Ink-wash', kind: 'style', version: 'v1', listed: true,
    base: 'Flux.1 dev', rank: 'LoRA r16', trigger: 'inkwash', runs: 847, royalties: 8160,
    lineage: { dataset: 'Sumi studies', version: 'v2', captionset: 'natural v1', custody: 'local' },
    tile: 'radial-gradient(120% 100% at 50% 30%, #2f4a44, #18241f)',
  },
  {
    id: 'drake-v1', name: 'Drake', kind: 'subject', version: 'v1', listed: false,
    base: 'Flux.1 dev', rank: 'LoRA r16', trigger: 'drake', runs: 0, royalties: null,
    lineage: { dataset: 'Drake refs', version: 'v1', captionset: 'natural v1', custody: 'sealed' },
    tile: 'radial-gradient(120% 100% at 45% 35%, #2c5d54, #16241f)',
  },
];

export const LIFETIME_ROYALTIES = { total: 18400, last30: 1240 };
