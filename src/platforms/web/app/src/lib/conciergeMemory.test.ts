import { describe, it, expect } from 'vitest';
import { applyMemoryDelta, MEMORY_NOTES_MAX, MEMORY_NOTE_MAX_CHARS } from './conciergeMemory';

// The client's half of the author ladder's memory. This merge is what a user's note list actually
// goes through at the end of every turn, so its edges are the ones that show up on /preferences.

describe('applyMemoryDelta', () => {
  it('adds a note', () => {
    expect(applyMemoryDelta(['works in Portuguese'], { add: ['prefers cold palettes'] }))
      .toEqual(['works in Portuguese', 'prefers cold palettes']);
  });

  it('removes by exact text, ignoring case and surrounding space', () => {
    expect(applyMemoryDelta(['Works In Portuguese', 'prefers cold palettes'], { remove: ['  works in portuguese  '] }))
      .toEqual(['prefers cold palettes']);
  });

  // Removals run FIRST so a turn can rewrite a line: forget the old wording, add the new.
  it('rewrites a line when a turn removes it and adds a replacement', () => {
    expect(applyMemoryDelta(['prefers warm palettes'], {
      remove: ['prefers warm palettes'],
      add: ['prefers cold, desaturated palettes'],
    })).toEqual(['prefers cold, desaturated palettes']);
  });

  it('does not add a note that is already on file', () => {
    expect(applyMemoryDelta(['prefers cold palettes'], { add: ['  Prefers Cold Palettes  '] }))
      .toEqual(['prefers cold palettes']);
  });

  it('deduplicates within a single delta', () => {
    expect(applyMemoryDelta([], { add: ['a note', 'A NOTE'] })).toEqual(['a note']);
  });

  it('clips a note to the note ceiling and skips a blank one', () => {
    const [clipped, ...rest] = applyMemoryDelta([], { add: ['x'.repeat(MEMORY_NOTE_MAX_CHARS + 20), '   '] });
    expect(clipped).toHaveLength(MEMORY_NOTE_MAX_CHARS);
    expect(rest).toEqual([]);
  });

  it('keeps the newest MEMORY_NOTES_MAX, dropping the oldest', () => {
    const current = Array.from({ length: MEMORY_NOTES_MAX }, (_, i) => `note ${i}`);
    const next = applyMemoryDelta(current, { add: ['the newest'] });
    expect(next).toHaveLength(MEMORY_NOTES_MAX);
    expect(next[0]).toBe('note 1');
    expect(next[MEMORY_NOTES_MAX - 1]).toBe('the newest');
  });

  // The same array instance back means "nothing changed" — the caller skips the PUT entirely, so
  // a turn that learned nothing new never touches the user's saved preferences.
  it('returns the SAME array when nothing changed, so the caller can skip the write', () => {
    const current = ['prefers cold palettes'];
    expect(applyMemoryDelta(current, { add: ['prefers cold palettes'] })).toBe(current);
    expect(applyMemoryDelta(current, { remove: ['a line that was never there'] })).toBe(current);
    expect(applyMemoryDelta(current, {})).toBe(current);
  });

  it('never mutates the list it was handed', () => {
    const current = ['one', 'two'];
    applyMemoryDelta(current, { add: ['three'], remove: ['one'] });
    expect(current).toEqual(['one', 'two']);
  });
});
