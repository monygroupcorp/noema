import { describe, expect, it } from 'vitest';
import { modelFamily, ratePacks, summariseApi, summariseCatalog } from './landingCatalog';
import type { FlowSummary, ModelCard, Pack } from '../lib/api';

const flow = (over: Partial<FlowSummary>): FlowSummary => ({ id: 'f', ...over });
const model = (over: Partial<ModelCard>): ModelCard =>
  ({ intellaId: 'i', nomen: 'n', genus: 'model', ...over }) as ModelCard;

describe('summariseCatalog', () => {
  it('counts the catalogue rather than restating a number written by hand', () => {
    const s = summariseCatalog(
      [
        flow({ categoria: 'image', modusGenus: 'make' }),
        flow({ categoria: 'image', modusGenus: 'make' }),
        flow({ categoria: 'video', modusGenus: 'animate' }),
      ],
      [model({ genus: 'model' }), model({ genus: 'lora' }), model({ genus: 'embedding' })],
    );
    expect(s.workflows).toBe(3);
    expect(s.models).toBe(3);
  });

  it('counts low-rank adaptations as their own kind', () => {
    const s = summariseCatalog([], [model({ genus: 'lora' }), model({ genus: 'lora' }), model({})]);
    expect(s.loras).toBe(2);
    expect(s.kinds).toEqual([
      { key: 'lora', count: 2 },
      { key: 'model', count: 1 },
    ]);
  });

  it('reports no loras rather than undefined when the catalogue carries none', () => {
    expect(summariseCatalog([], [model({})]).loras).toBe(0);
  });

  it('tallies what the trained identities were trained on, commonest base first', () => {
    const s = summariseCatalog(
      [],
      [
        model({ genus: 'lora', basis: 'flux' }),
        model({ genus: 'lora', basis: 'sdxl' }),
        model({ genus: 'lora', basis: 'flux' }),
        // a base model's own basis must not land in the trained-on tally
        model({ genus: 'model', basis: 'flux' }),
        model({ genus: 'lora' }),
      ],
    );
    expect(s.bases).toEqual([
      { key: 'flux', count: 2 },
      { key: 'sdxl', count: 1 },
    ]);
  });

  it('orders verbs and modalities commonest first, ties broken by name', () => {
    const s = summariseCatalog(
      [
        flow({ categoria: 'image', modusGenus: 'make' }),
        flow({ categoria: 'image', modusGenus: 'effect' }),
        flow({ categoria: 'video', modusGenus: 'make' }),
        flow({ categoria: 'audio', modusGenus: 'make' }),
      ],
      [],
    );
    expect(s.verbs).toEqual([
      { key: 'make', count: 3 },
      { key: 'effect', count: 1 },
    ]);
    expect(s.modalities).toEqual([
      { key: 'image', count: 2 },
      { key: 'audio', count: 1 },
      { key: 'video', count: 1 },
    ]);
  });

  it('skips workflows that declare no modality instead of inventing one', () => {
    // 10 of the live catalogue's flows carry no `categoria` — they must not become a bucket.
    const s = summariseCatalog(
      [flow({ categoria: 'image' }), flow({ categoria: null }), flow({}), flow({ categoria: 42 })],
      [],
    );
    expect(s.modalities).toEqual([{ key: 'image', count: 1 }]);
    expect(s.workflows).toBe(4);
  });

  it('ignores blank strings, which would otherwise render as an unnamed chip', () => {
    expect(summariseCatalog([flow({ modusGenus: '   ' as never })], []).verbs).toEqual([]);
  });

  it('returns zeroes for an empty catalogue rather than throwing', () => {
    const s = summariseCatalog([], []);
    expect(s).toEqual({
      workflows: 0, verbs: [], modalities: [], models: 0, kinds: [], loras: 0, bases: [],
      families: [],
    });
  });
});

describe('summariseApi', () => {
  it('counts the endpoints the served contract actually declares', () => {
    expect(summariseApi({ paths: { '/runs': {}, '/flows': {}, '/models': {} } })).toEqual({
      endpoints: 3,
      mcp: false,
    });
  });

  it('notices an MCP route, which is what lets an agent drive the platform', () => {
    expect(summariseApi({ paths: { '/runs': {}, '/mcp': {} } })?.mcp).toBe(true);
    expect(summariseApi({ paths: { '/mcp/tools': {} } })?.mcp).toBe(true);
    expect(summariseApi({ paths: { '/mcpanything': {} } })?.mcp).toBe(false);
  });

  it('returns null for anything that is not a contract, so nothing is rendered from a guess', () => {
    expect(summariseApi(null)).toBeNull();
    expect(summariseApi({})).toBeNull();
    expect(summariseApi({ paths: 'nope' })).toBeNull();
    expect(summariseApi('<!doctype html>')).toBeNull();
  });
});

describe('modelFamily', () => {
  it('reduces a precise catalogue name to the family a roster wants', () => {
    expect(modelFamily('Wan2.2 T2V — high-noise unet (14B, fp8 scaled)')).toBe('Wan');
    expect(modelFamily('FLUX.2 Klein 4B (fp8)')).toBe('FLUX');
    expect(modelFamily('FLUX.1 Schnell')).toBe('FLUX');
    expect(modelFamily('Krea 2 Turbo (fp8 scaled)')).toBe('Krea');
    expect(modelFamily('MiniMax H3 — reference to video (pruned int8 convrot)')).toBe('MiniMax');
  });

  it('keeps two-word and hyphenated family names whole', () => {
    expect(modelFamily('Stable Diffusion XL Base 1.0')).toBe('Stable Diffusion');
    expect(modelFamily('Stable Diffusion 1.5 (pruned emaonly)')).toBe('Stable Diffusion');
    expect(modelFamily('Z-Image Turbo (bf16)')).toBe('Z-Image');
    expect(modelFamily('MOSS-Music 8B Instruct')).toBe('MOSS-Music');
    expect(modelFamily('Qwen3-VL 8B Instruct')).toBe('Qwen3-VL');
  });

  it('collapses the four Wan variants and both FLUX Schnells to one entry each', () => {
    const models = [
      'Wan2.2 T2V — high-noise unet (14B, fp8 scaled)', 'Wan2.2 T2V — low-noise unet (14B, fp8 scaled)',
      'Wan2.2 I2V — high-noise unet (14B, fp8 scaled)', 'Wan2.2 I2V — low-noise unet (14B, fp8 scaled)',
      'FLUX.1 Schnell', 'FLUX.1 Schnell (fp8 scaled)',
    ].map((nomen) => ({ intellaId: nomen, nomen, genus: 'model' })) as never[];
    expect(summariseCatalog([], models).families).toEqual(['FLUX', 'Wan']);
  });

  it('rosters only base models — 262 trained identities would swamp it', () => {
    const models = [
      { intellaId: 'a', nomen: 'FLUX.1 Schnell', genus: 'model' },
      { intellaId: 'b', nomen: 'somebody-flux-klein', genus: 'lora' },
      { intellaId: 'c', nomen: 'CLIP-L (text encoder)', genus: 'embedding' },
    ] as never[];
    expect(summariseCatalog([], models).families).toEqual(['FLUX']);
  });
});

describe('ratePacks — the price block is read, not written', () => {
  // The four ratified packs as production serves them today. Not a fixture of invented
  // numbers: if `stripePacks.PACKS` changes, this test still passes and the page still tells
  // the truth, because neither of them is the source.
  const live: Pack[] = [
    { id: 'starter_10', usd: 10, credits: 2080, label: 'Starter' },
    { id: 'standard_25', usd: 25, credits: 5720, label: 'Standard' },
    { id: 'plus_50', usd: 50, credits: 12480, label: 'Plus' },
    { id: 'studio_100', usd: 100, credits: 27040, label: 'Studio', bestRate: true },
  ];

  it('derives the rate rather than carrying a second copy of it', () => {
    const rated = ratePacks(live);
    expect(rated.map((p) => Math.round(p.creditsPerUsd))).toEqual([208, 229, 250, 270]);
  });

  it('orders cheapest first, whatever order the till answered in', () => {
    const rated = ratePacks([...live].reverse());
    expect(rated.map((p) => p.usd)).toEqual([10, 25, 50, 100]);
  });

  it('drops a pack that cannot be priced, rather than printing Infinity or NaN at a visitor', () => {
    const rated = ratePacks([
      ...live,
      { id: 'free', usd: 0, credits: 100, label: 'Broken' },
      { id: 'empty', usd: 5, credits: 0, label: 'Broken' },
    ]);
    expect(rated.map((p) => p.id)).toEqual(['starter_10', 'standard_25', 'plus_50', 'studio_100']);
  });

  // The block's whole failure posture: no packs means no section, never a guessed price.
  it('returns nothing when the till answers with nothing', () => {
    expect(ratePacks([])).toEqual([]);
  });
});
