import { describe, expect, it } from 'vitest';
import { splitReplyBlocks } from './replyBlocks';

describe('splitReplyBlocks', () => {
  it('splits paragraphs separated by a blank line into separate tiles', () => {
    expect(splitReplyBlocks('first prompt\n\nsecond prompt')).toEqual(['first prompt', 'second prompt']);
  });

  it('keeps a fenced code block whole even when it contains a blank line', () => {
    const text = '```\nline one\n\nline two\n```';
    expect(splitReplyBlocks(text)).toEqual([text]);
  });

  it('treats a fenced block and surrounding prose as separate tiles', () => {
    const text = 'before\n\n```\ncode\n```\n\nafter';
    expect(splitReplyBlocks(text)).toEqual(['before', '```\ncode\n```', 'after']);
  });

  it('collapses runs of blank lines without emitting empty tiles', () => {
    expect(splitReplyBlocks('a\n\n\n\nb')).toEqual(['a', 'b']);
  });

  it('returns the whole text as one tile when there is nothing to split', () => {
    expect(splitReplyBlocks('just one line')).toEqual(['just one line']);
  });
});
