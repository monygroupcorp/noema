import { describe, expect, it } from 'vitest';
import { heldModelPublishStates, resolveUseInFlowTarget } from './Shelf';
import type { Editio } from '../lib/editio';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the shelf's pure "Use in a flow" target resolution rather than a full
// DOM render, per the item's "any component test the app supports" allowance.
//
// noema-062: the button used to hand the model's own Intella id to the flow-run screen
// (`/card?id=${m.intellaId}`), which always 404'd — no flow document exists for an
// imported model. It now resolves to the simplest existing base-model card for the
// model's familia, with the trigger word carried for prompt prefill.

describe('resolveUseInFlowTarget — "Use in a flow" base-card resolution (noema-062)', () => {
  it('resolves the operator\'s own worked example: a flux2 klein LoRA import', () => {
    // INTELLA_IMPRESSTATION_KLEIN (src/crystal/seeds/intellae.ts): familia 'flux2', trigger 'stationthis'.
    const to = resolveUseInFlowTarget({ basis: 'flux2', trigger: 'stationthis', nomen: 'impresstation' });
    expect(to).toBe('/card?id=klein&prompt=stationthis&loraName=impresstation');
  });

  it('never sends the caller to the dead import-<hash> flow id', () => {
    const to = resolveUseInFlowTarget({ basis: 'flux2', trigger: 'stationthis', nomen: 'impresstation' });
    expect(to.startsWith('/card?id=klein')).toBe(true);
  });

  it('maps every known familia to its canonical simplest text-to-image card', () => {
    expect(resolveUseInFlowTarget({ basis: 'flux', trigger: 't', nomen: 'n' })).toContain('id=flux-schnell');
    expect(resolveUseInFlowTarget({ basis: 'sdxl', trigger: 't', nomen: 'n' })).toContain('id=sdxl');
    expect(resolveUseInFlowTarget({ basis: 'sd15', trigger: 't', nomen: 'n' })).toContain('id=sd1-5');
    expect(resolveUseInFlowTarget({ basis: 'chroma', trigger: 't', nomen: 'n' })).toContain('id=chroma');
    expect(resolveUseInFlowTarget({ basis: 'krea2', trigger: 't', nomen: 'n' })).toContain('id=krea-turbo');
    expect(resolveUseInFlowTarget({ basis: 'zimage', trigger: 't', nomen: 'n' })).toContain('id=z-image-turbo');
  });

  it('omits the trigger/loraName params when the model has no trigger word', () => {
    const to = resolveUseInFlowTarget({ basis: 'sdxl', trigger: undefined, nomen: 'my-model' });
    expect(to).toBe('/card?id=sdxl&loraName=my-model');
  });

  it('falls back to a plain flux-schnell card (no params) for an unresolvable/unknown basis', () => {
    expect(resolveUseInFlowTarget({ basis: undefined, trigger: 'x', nomen: 'x' })).toBe('/card?id=flux-schnell');
    expect(resolveUseInFlowTarget({ basis: 'unknown-family', trigger: 'x', nomen: 'x' })).toBe('/card?id=flux-schnell');
  });
});

// A moderation HOLD never settles on its own — only a reviewer clears it. Held state the shelf
// learned while polling a publish attempt was component memory, so a reload dropped it and the
// model card offered a plain "Publish" again. This seeds the same state from the caller's own
// review queue, which is the server's record of the hold.
const ed = (p: Partial<Editio>): Editio => ({
  id: 'e1',
  artifact: { kind: 'intella', id: 'm1' },
  destination: 'huggingface',
  visibility: 'unlisted',
  custody: 'ours',
  status: 'pending',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  ...p,
});

describe('heldModelPublishStates — a hold survives the reload that used to lose it', () => {
  it('marks a held model promotion, carrying the server\'s author-safe reason', () => {
    const held = heldModelPublishStates([
      ed({ reviewOutcome: 'pending', moderationNote: 'Held for a moderator to look at.' }),
    ]);
    expect(held).toEqual({ m1: { s: 'held', note: 'Held for a moderator to look at.' } });
  });

  it('falls back to a reason rather than rendering a held model with none', () => {
    const held = heldModelPublishStates([ed({ reviewOutcome: 'pending' })]);
    expect(held.m1.note).toBe('Flagged by automated review.');
  });

  it('ignores held publications of anything that is not a model', () => {
    const held = heldModelPublishStates([
      ed({ artifact: { kind: 'actum', id: 'a1' }, visibility: 'feed', destination: 'feed', reviewOutcome: 'pending' }),
      ed({ artifact: { kind: 'collectio', id: 'c1' }, reviewOutcome: 'pending' }),
    ]);
    expect(held).toEqual({});
  });

  it('ignores an adjudicated entry — only a still-pending review is a hold', () => {
    expect(heldModelPublishStates([ed({ status: 'published', reviewOutcome: 'approved' })])).toEqual({});
    expect(heldModelPublishStates([ed({ status: 'rejected', reviewOutcome: 'rejected' })])).toEqual({});
    expect(heldModelPublishStates([ed({ status: 'pending' })])).toEqual({});
  });

  it('keeps the newest hold when a model has been put forth more than once', () => {
    // The queue is newest-first (Editiones.listHeld).
    const held = heldModelPublishStates([
      ed({ id: 'new', reviewOutcome: 'pending', moderationNote: 'the live hold' }),
      ed({ id: 'old', reviewOutcome: 'pending', moderationNote: 'an earlier hold' }),
    ]);
    expect(held.m1.note).toBe('the live hold');
  });
});
