// Deterministic embedding double for the sweep tests: the same text always maps to the
// same vector, so a writeback can be asserted against the value that produced it without
// a live CLIP service. The dimension is small on purpose — nothing here depends on 512.
export const MEMORY_ONLY_DIM = 8

export function fakeVector(text: string): number[] {
  let seed = 0
  for (const ch of text) seed += ch.charCodeAt(0)
  return new Array(MEMORY_ONLY_DIM).fill(0).map((_, i) => Math.sin(seed + i))
}
