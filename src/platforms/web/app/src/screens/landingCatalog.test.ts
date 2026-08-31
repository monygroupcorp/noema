import { describe, expect, it } from 'vitest';
import { summariseCatalog } from './landingCatalog';
import type { FlowSummary, ModelCard } from '../lib/api';

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
    });
  });
});
