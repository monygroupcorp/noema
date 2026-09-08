import { api, type ConciergeMemoryDelta, type Generatio } from './api';

// ── conciergeMemory — applying the concierge's turn-end memory delta ──────────
//
// The concierge PROPOSES what it wants to remember; this module is what writes it, from the
// client, through the same `PUT /v1/me/generatio` the Preferences screen uses. Nothing on the
// server acts on the agent's say-so: a turn that proposes a delta and is never rendered here
// changes nothing.
//
// The caps below are the client's half of a pair — `CrystalApi.setGeneratio` re-applies the
// same two numbers on the way in, so the stored ceiling holds whatever a caller sends.

/** Longest single note (mirrors MEMORY_NOTE_MAX_CHARS in src/types/consuetudo.ts). */
export const MEMORY_NOTE_MAX_CHARS = 200;
/** Hard ceiling on notes kept (mirrors MEMORY_NOTES_MAX). The oldest fall off first. */
export const MEMORY_NOTES_MAX = 20;

/** Merge a delta into the current note list. Pure. Removals run first (so a turn can rewrite a
 *  line by removing the old one and adding the new), matching is exact and case-insensitive on
 *  the trimmed text, additions are deduped against what survives, and the result is trimmed to
 *  the newest MEMORY_NOTES_MAX. Returns the same array instance when nothing changed, so a
 *  caller can skip the round-trip. */
export function applyMemoryDelta(current: string[], delta: ConciergeMemoryDelta): string[] {
  const gone = new Set((delta.remove ?? []).map((n) => n.trim().toLowerCase()));
  const kept = current.filter((n) => !gone.has(n.trim().toLowerCase()));
  const seen = new Set(kept.map((n) => n.trim().toLowerCase()));
  const added: string[] = [];
  for (const raw of delta.add ?? []) {
    const note = raw.trim().slice(0, MEMORY_NOTE_MAX_CHARS);
    const key = note.toLowerCase();
    if (note === '' || seen.has(key)) continue;
    seen.add(key);
    added.push(note);
  }
  const next = [...kept, ...added].slice(-MEMORY_NOTES_MAX);
  const unchanged = next.length === current.length && next.every((n, i) => n === current[i]);
  return unchanged ? current : next;
}

/** Apply a turn's delta and persist it. Reads the caller's CURRENT generatio first so the PUT —
 *  which replaces the whole record — never clobbers a preference edited in another tab. Returns
 *  the notes now on file, or null when the delta was a no-op or the write failed: a memory note
 *  is a convenience, and losing one must never fail the turn that produced it. */
export async function commitMemoryDelta(delta: ConciergeMemoryDelta): Promise<string[] | null> {
  try {
    const me = await api.getMe();
    const generatio: Generatio = me.generatio ?? {};
    const current = generatio.memoryNotes ?? [];
    const next = applyMemoryDelta(current, delta);
    if (next === current) return null;
    await api.setGeneratio({ ...generatio, memoryNotes: next });
    return next;
  } catch {
    return null;
  }
}
