import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Doc } from './Doc';

// On a phone every table row reflows into a stack of label + value lines (doc.css), the label
// carried onto each cell as `data-label`. The first cell is what the row is about, so it is the
// entry's heading and carries no label: a list of storage keys must read as the keys themselves,
// not as fifteen entries all headed "Key".

const render = (md: string) =>
  renderToStaticMarkup(<MemoryRouter><Doc md={md} /></MemoryRouter>);

const cells = (html: string) =>
  [...html.matchAll(/<td([^>]*)>/g)].map((m) => /data-label="([^"]*)"/.exec(m[1])?.[1] ?? null);

describe('Doc tables', () => {
  it('labels every cell but the row subject with its column header', () => {
    const html = render('| Key | What it holds |\n|---|---|\n| `a` | one |\n| `b` | two |\n');
    expect(cells(html)).toEqual([null, 'What it holds', null, 'What it holds']);
    expect(html).toContain('<th>Key</th>');
  });

  it('heads each browser-storage entry in the cookie policy by its key, not by "Key"', () => {
    const md = readFileSync(resolve(__dirname, '../content/cookies.md'), 'utf8');
    const labels = cells(render(md));
    expect(labels.length).toBeGreaterThan(10);
    expect(labels).not.toContain('Key');
    expect(labels).not.toContain('Name');
    expect(labels).toContain('What it holds');
    expect(labels).toContain('Purpose');
  });
});
