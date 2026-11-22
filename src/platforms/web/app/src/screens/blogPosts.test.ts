import { describe, expect, it } from 'vitest';
import { parsePost } from './blogPosts';

describe('parsePost', () => {
  it('takes the title and the summary from the post itself', () => {
    const p = parsePost('train-a-model', [
      '# Train a model on your own work',
      '',
      '**Published:** 2026-09-02',
      '',
      'A walkthrough from a folder of references to a model you can run.',
      '',
      '## Step one',
    ].join('\n'));
    expect(p.title).toBe('Train a model on your own work');
    expect(p.published).toBe('2026-09-02');
    expect(p.blurb).toBe('A walkthrough from a folder of references to a model you can run.');
    expect(p.slug).toBe('train-a-model');
  });

  it('skips the date, rules and headings when looking for the summary', () => {
    expect(parsePost('x', '# T\n\n---\n\n## Sub\n\nThe actual first line.').blurb)
      .toBe('The actual first line.');
  });

  it('strips emphasis so the index reads as plain text', () => {
    expect(parsePost('x', '# T\n\nA **bold** and `code` line.').blurb).toBe('A bold and code line.');
  });

  it('survives a post with no title, date or body rather than throwing', () => {
    const p = parsePost('bare', '');
    expect(p.title).toBe('bare');
    expect(p.blurb).toBe('');
    expect(p.published).toBeUndefined();
  });
});

// REFERENCES.md REF-4: an index entry says what the reader will be able to do after the guide.
// That is a different sentence from a post's lede, so it lives in the front matter, beside the
// date, and never reaches the body.
describe('parsePost — the index line', () => {
  const md = [
    '# Run noema over the API',
    '',
    '**Published:** 2026-09-05',
    '**Summary:** Call any flow from your own code with one HTTP request.',
    '',
    'Every flow on the platform is one HTTP call away.',
    '',
    '## Discover',
  ].join('\n');

  it('takes the index line from the Summary front matter when the post carries one', () => {
    const p = parsePost('api', md);
    expect(p.blurb).toBe('Call any flow from your own code with one HTTP request.');
    expect(p.published).toBe('2026-09-05');
  });

  it('keeps the index line out of the body, and the body otherwise intact', () => {
    const p = parsePost('api', md);
    expect(p.body).not.toContain('**Summary:**');
    expect(p.body).toContain('**Published:** 2026-09-05\n\nEvery flow on the platform is one HTTP call away.');
    expect(p.body).toContain('## Discover');
  });

  it('strips emphasis from a Summary line the way it does from a first paragraph', () => {
    expect(parsePost('x', '# T\n\n**Summary:** Run `any` flow **now**.\n\nLede.').blurb).toBe('Run any flow now.');
  });
});
