import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { START_MAX, startList } from './Run';
import { toUI } from './Catalog';

const SOURCE = readFileSync(fileURLToPath(new URL('./Run.tsx', import.meta.url)), 'utf8');

const flows = (n: number) => Array.from({ length: n }, (_, i) => toUI({ id: `flow-${i}`, nomen: `Flow ${i}`, categoria: 'image', modusGenus: 'make' }));

describe('startList — the flows the /run landing offers to start from', () => {
  it('lists every flow when there are few, with nothing left over', () => {
    expect(startList(flows(3))).toEqual({ shown: flows(3), more: 0 });
    expect(startList([])).toEqual({ shown: [], more: 0 });
  });
  it(`caps the list at ${START_MAX} and counts the rest for the catalogue door`, () => {
    const out = startList(flows(START_MAX + 7));
    expect(out.shown).toHaveLength(START_MAX);
    expect(out.more).toBe(7);
  });
});

describe('the /run landing with no run open (REFERENCES.md REF-15, DESIGN.md D-60)', () => {
  it('is a list of last runs and startable flows, not a dashed placeholder', () => {
    expect(SOURCE).not.toContain('No run selected');
    expect(SOURCE).toContain('Your last runs');
    expect(SOURCE).toContain('Start a run');
    expect(SOURCE).toContain('flowSummaries()');
  });
});
