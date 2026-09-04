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
