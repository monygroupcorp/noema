// Boundary mapping — backend Latin nouns → plain-English display labels.
// RULE (UX handoff §2): the Latin nomenclature is backend-only. No Latin primitive may
// render in the UI except the brand NOEMA. Translate at THIS boundary so new leaks are
// caught centrally rather than screen-by-screen.

export const NOUN_LABEL: Record<string, string> = {
  modus: 'flow', modusId: 'flow', essentia: 'flow',
  fundamentum: 'base model', fundamentumId: 'base model',
  categoria: 'category', impetus: 'cost',
  aditus: 'inputs', exitus: 'output',
  editio: 'publication', tractus: 'trait set',
  actum: 'run', actumId: 'run', intella: 'model',
  signum: 'credit', nomen: 'name', versio: 'version',
  porta: 'input', valor: 'value', auctor: 'author',
};

// Plain-English label for a raw backend noun; falls back to the noun unchanged.
export function nounLabel(noun: string): string {
  return NOUN_LABEL[noun] ?? noun;
}

// Turn a schema key / port id into a friendly label:
// "negative_prompt" → "Negative prompt", "guidanceScale" → "Guidance scale".
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}
