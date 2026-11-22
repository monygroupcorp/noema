import { describe, expect, it } from 'vitest';
import { countsLine } from './projects';

// DESIGN.md D-58: empty counters are suppressed — a project card renders the counts that are
// non-zero, or one line saying the project is new. The line used to read
// "1 chats · 1 cards · 0 canvases · 18 gens" on a project with no canvas.

describe('countsLine — the stat line under a project card', () => {
  it('leaves a zero axis out', () => {
    expect(countsLine({ chats: 1, cards: 1, canvases: 0, gens: 18 })).toBe('1 chat · 1 card · 18 gens');
  });

  it('keeps every axis that has something in it', () => {
    expect(countsLine({ chats: 3, cards: 2, canvases: 1, gens: 64 })).toBe('3 chats · 2 cards · 1 canvas · 64 gens');
  });

  it('says the project is new when every count is zero, instead of a row of zeros', () => {
    expect(countsLine({ chats: 0, cards: 0, canvases: 0, gens: 0 })).toBe('nothing in it yet');
  });
});
