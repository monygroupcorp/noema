// Identities + trust tiers (ported from the spike's app.js IDENTS).
// Latin stays out of the UI — these strings are already user-facing.

export type Tier = 'identified' | 'anon' | 'tee';

export interface RedactRow { k: string; v: string; block?: boolean }

export interface Ident {
  id: string;
  name: string;
  role: string;
  tier: Tier;
  chipCls: 'named' | 'masked' | 'sealed';
  chipColor?: string;
  glyph: string;        // letter for named identities
  bal: string;
  can: string[];
  cant: string[];
  redact: RedactRow[];
  note: string;         // may contain <b> </b>
  dest: string;         // composer hint; may contain markup
}

export const TIER_LABEL: Record<Tier, string> = {
  identified: 'identified',
  anon: 'anonymous',
  tee: 'private',
};

// privacy mini-indicator: [lucide icon name, label]
export const PRIV: Record<Tier, [string, string]> = {
  identified: ['eye', 'identified'],
  anon: ['venetian-mask', 'anonymous'],
  tee: ['eye-off', 'private'],
};

export const IDENTS: Ident[] = [
  {
    id: 'studio', name: 'studio', role: 'monyrth', tier: 'identified',
    chipCls: 'named', chipColor: '#cdd2ff', glyph: 'S',
    bal: '214 credits',
    can: ['identity', 'prompts', 'outputs'], cant: [],
    redact: [
      { k: 'who', v: 'studio · monyrth' },
      { k: 'prompt', v: '“…neon temple, dusk”' },
      { k: 'output', v: 'flux-schnell.png' },
      { k: 'cost', v: '$0.043 · 12 GPU-min' },
    ],
    note: '<b>Identified.</b> You’re signed in. We keep your work and your galaxy.',
    dest: 'posting as <b>studio</b>',
  },
  {
    id: 'ghost', name: 'untitled', role: 'bearer purse', tier: 'anon',
    chipCls: 'masked', glyph: '◷',
    bal: 'purse · 38 credits',
    can: ['prompts', 'outputs'], cant: ['identity'],
    redact: [
      { k: 'who', v: '▮▮▮▮▮▮', block: true },
      { k: 'prompt', v: '“…neon temple, dusk”' },
      { k: 'output', v: 'flux-schnell.png' },
      { k: 'cost', v: '$0.043 · 12 GPU-min' },
    ],
    note: '<b>Anonymous.</b> A bearer purse — no name is attached. We see the work, never who you are.',
    dest: 'posting <b>anonymously</b> — no identity attached',
  },
  {
    id: 'vault', name: 'private', role: 'sealed tunnel', tier: 'tee',
    chipCls: 'sealed', glyph: '∅',
    bal: 'private · metered',
    can: ['the meter'], cant: ['identity', 'prompts', 'outputs'],
    redact: [
      { k: 'who', v: '▮▮▮▮▮▮', block: true },
      { k: 'prompt', v: '▮▮▮▮▮▮▮▮▮▮', block: true },
      { k: 'output', v: '▮▮▮▮▮▮', block: true },
      { k: 'cost', v: '$0.043 · 12 GPU-min' },
    ],
    note: '<b>Private.</b> Runs in a sealed pod over your own tunnel. We receive only the meter — never the work itself.',
    dest: '<b>sealed</b> to your private tunnel — we can’t read this',
  },
];
