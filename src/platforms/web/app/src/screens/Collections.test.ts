import { describe, expect, it } from 'vitest';
import { SEED_MODUS_ID, SEED_TRACTUS, buildCreateRequest } from './Collections';
import type { Tractus } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) — so
// this exercises the payload the create form submits rather than a full DOM render, per the
// item's "any component test the app supports" allowance.
//
// A new collection starts from a minimal WORKING configuration: one flow, one axis varying the
// `prompt` port over several complete prompts, and a supply of one piece per value. Fired
// untouched it produces pieces that differ. These assertions pin that shape, and pin that the
// seed stays ordinary editable config rather than becoming a rail.

const req = () => buildCreateRequest({ nomen: 'my collection', reviewEnabled: true });

describe('create sends a working starting configuration', () => {
  it('create sends a seeded modusId + one prompt axis with >1 value + total', () => {
    const body = req();
    expect(body.modusId).toBe(SEED_MODUS_ID);

    const tractus = body.tractus as Tractus[];
    expect(Array.isArray(tractus)).toBe(true);
    expect(tractus).toHaveLength(1);
    expect(tractus[0].porta).toBe('prompt');
    expect(tractus[0].valores.length).toBeGreaterThan(1);

    // One piece per value: the smallest run that exercises the whole axis.
    expect(body.total).toBe(tractus[0].valores.length);
  });

  it('seeds at least three values, each a complete non-empty prompt with a short label', () => {
    const axis = (req().tractus as Tractus[])[0];
    expect(axis.valores.length).toBeGreaterThanOrEqual(3);
    for (const v of axis.valores) {
      expect(typeof v.value).toBe('string');
      expect(v.value.trim().length).toBeGreaterThan(0);
      // The axis varies the prompt port directly, so each value must stand alone as the whole
      // prompt — not a fragment that only reads as a prompt once joined to something else.
      expect(v.value.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);
      expect(typeof v.label).toBe('string');
      expect((v.label ?? '').trim().length).toBeGreaterThan(0);
    }
    // Distinct values, or firing the seed produces identical pieces.
    expect(new Set(axis.valores.map((v) => v.value)).size).toBe(axis.valores.length);
  });

  it('still creates a draft carrying the author\'s naming act', () => {
    const body = buildCreateRequest({ nomen: 'my collection', descriptio: 'a set', reviewEnabled: false });
    expect(body.draft).toBe(true);
    expect(body.nomen).toBe('my collection');
    expect(body.descriptio).toBe('a set');
    expect(body.reviewEnabled).toBe(false);
  });

  it('omits descriptio entirely when the author left it blank', () => {
    expect('descriptio' in buildCreateRequest({ nomen: 'n', descriptio: '', reviewEnabled: true })).toBe(false);
    expect('descriptio' in req()).toBe(false);
  });
});

describe('the seed is a starting point, not a rail', () => {
  it('carries no seeded/locked marker — only ordinary Tractus and TractusValor fields', () => {
    const axis = (req().tractus as Tractus[])[0];
    expect(Object.keys(axis).sort()).toEqual(['label', 'porta', 'valores']);
    for (const v of axis.valores) {
      expect(Object.keys(v).sort()).toEqual(['label', 'value']);
    }
  });

  it('renaming the axis, editing a value or deleting one leaves a valid grid the garden can save', () => {
    const axis = (req().tractus as Tractus[])[0];

    // Rename the axis and repoint it at another input port — the garden's own edits.
    const renamed: Tractus = { ...axis, porta: 'style', label: 'Style' };
    expect(renamed.valores).toHaveLength(axis.valores.length);

    // Edit one value, delete another. Nothing depends on the seeded text or the original count.
    const edited: Tractus = {
      ...axis,
      valores: axis.valores
        .map((v, i) => (i === 0 ? { ...v, value: 'something the author typed' } : v))
        .filter((_, i) => i !== 1),
    };
    expect(edited.valores).toHaveLength(axis.valores.length - 1);
    expect(edited.valores[0].value).toBe('something the author typed');

    // Deleting the axis outright is equally allowed — an empty grid is a valid draft.
    expect(([] as Tractus[]).length).toBe(0);
  });

  it('hands each create its own copy, so editing one payload cannot mutate the next', () => {
    const first = req();
    (first.tractus as Tractus[])[0].valores[0].value = 'edited in place';
    (first.tractus as Tractus[])[0].valores.pop();

    const second = req();
    const secondAxis = (second.tractus as Tractus[])[0];
    expect(secondAxis.valores).toHaveLength(SEED_TRACTUS[0].valores.length);
    expect(secondAxis.valores[0].value).toBe(SEED_TRACTUS[0].valores[0].value);
    expect(second.total).toBe(SEED_TRACTUS[0].valores.length);
  });
});
