import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./ProjectHub.tsx', import.meta.url)), 'utf8');

// Sentence case for everything the user reads (DESIGN.md D-26): the bottom band's section
// labels start with a capital, like the tab labels beside them.
describe('the project hub section labels', () => {
  it('are sentence case', () => {
    const labels = [...SOURCE.matchAll(/<div className="ph-l">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(labels).toEqual(['About this project', 'Activity']);
  });
});
