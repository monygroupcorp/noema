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

// DESIGN.md P-1d: the tab row already opens each holding, so the Overview cards summarise
// what is in it and do not carry a second "Open" to the same place.
describe('the project hub overview cards', () => {
  it('are summaries, not a second set of doors beside the tabs', () => {
    expect(SOURCE).not.toContain('Open ▸');
    expect(SOURCE).not.toMatch(/<HoldingCard[^>]*\b(to|onTo)=/);
  });
});
