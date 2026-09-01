// Beckoning, fill-in-the-blank prompt starters the Concierge shows when a prompt
// field is focused, plus a v1 local drafter. Keyed by flow id, falling back to the
// medium inferred from the id, then a generic scaffold.
export interface PromptTemplate { example: string; hint: string }

const BY_ID: Record<string, PromptTemplate> = {
  'heartmula-3b': { example: 'make me a ___ song with the style like ___, about ___', hint: 'genre · reference · theme' },
  sdxl: { example: 'a ___ of ___, ___ lighting, ___ style, highly detailed', hint: 'subject · scene · light · style' },
  chroma: { example: 'a ___ of ___, ___ lighting, ___ style, highly detailed', hint: 'subject · scene · light · style' },
  'krea-turbo': { example: 'a ___ of ___, ___ lighting, ___ style', hint: 'subject · scene · light · style' },
  'kontext-edit': { example: 'add a ___ to the image, make it ___', hint: 'what to add · what to change' },
  'klein-edit': { example: 'replace the ___ with ___, keep the rest the same', hint: 'what to replace · what to swap in' },
  rmbg: { example: 'upload a photo with a clear subject — the background comes off automatically', hint: 'no prompt needed · just an image' },
  upscale: { example: 'upload an image to sharpen and blow up 4x — no prompt needed', hint: 'no prompt needed · just an image' },
  'qwen3-vl-8b': { example: 'what\'s happening in this image? describe the ___', hint: 'question · what to focus on' },
  'shotvl-7b': { example: 'describe the shot: framing, camera angle, and lighting', hint: 'shot size · framing · lighting' },
  'qwen3-vl-caption': { example: 'describe this image in one dense, comma-separated caption', hint: 'subject · attributes · style · composition' },
  'minimax-h3-t2v': { example: 'a ___ in ___ says: \"___\"', hint: 'subject · setting · what they say aloud' },
  'minimax-h3-fl2v': { example: 'the ___ in the image ___, and says: \"___\"', hint: 'subject · motion · what they say' },
  // ref2v's reference convention is the model's own and is not guessable: the prompt has to
  // name <Picture 1> / <Audio 1> and tag the voice, or the timbre is not carried.
  'minimax-h3-ref2v': { example: '<Audio 1> is the voice-timbre reference for <Picture 1>. The person in <Picture 1> ___, and says: \"___\"', hint: 'keep the tag · setting · what they say' },
  'make-upscale': { example: 'a ___ of ___, ___ lighting, ___ style — generated then upscaled 4x', hint: 'subject · scene · light · style' },
};

const BY_KEYWORD: [RegExp, PromptTemplate][] = [
  [/song|music|audio|mula|moss/i, { example: 'a ___ track, ___ mood, in the style of ___', hint: 'genre · mood · reference' }],
  [/video|ltx|wan|hunyuan-?video/i, { example: 'a ___ scene: ___, camera slowly ___, ___ lighting', hint: 'subject · action · camera · light' }],
  [/3d|mesh|hunyuan3d/i, { example: 'a ___, ___ style, clean topology, ___ details', hint: 'object · style · details' }],
  [/flux|sd\d|sd1|dalle|image|diffus|schnell|dev/i, { example: 'a ___ of ___, ___ lighting, ___ style, highly detailed', hint: 'subject · scene · light · style' }],
];

const GENERIC: PromptTemplate = { example: 'describe what you want — subject, style, mood, any references…', hint: 'subject · style · mood' };

export function promptTemplate(flowId: string): PromptTemplate {
  if (BY_ID[flowId]) return BY_ID[flowId];
  for (const [re, t] of BY_KEYWORD) if (re.test(flowId)) return t;
  return GENERIC;
}

// Per-field examples beat per-flow ones — keyed by `flowId:fieldKey`, then by the
// bare field name (covers the same field across flows), then by the bare flow id
// (covers a flow whose only jargon-prone field is the prompt itself). Until essentiae
// carry rich per-input hints of their own, this is where the Concierge's field-level
// teeth live.
const FIELD_EXAMPLES: Record<string, string> = {
  'heartmula-3b:lyrics': '[Verse]\nneon rain on an empty street\n___\n[Chorus]\n___',
  'heartmula-3b:tags': 'piano, lo-fi, dreamy, 90bpm',
  lyrics: '[Verse]\n___\n[Chorus]\n___',
  tags: 'cinematic, warm, analog',
  negative_prompt: 'blurry, low quality, extra limbs, watermark',
  'ltx-t2v:negative': 'blurry, low quality, extra limbs, watermark',
  'ltx-i2v:negative': 'blurry, low quality, extra limbs, watermark',
  'klein': 'a foggy harbor at dawn, cargo ships silhouetted against amber light, cinematic wide shot',
  'klein-edit-4b': 'turn the sky into a stormy sunset and add rain streaks on the window',
};

/** The best example for a specific field: curated per-field → curated per-flow → flow medium → description. */
export function fieldExample(flowId: string, fieldKey: string, description?: string): string {
  const curated = FIELD_EXAMPLES[`${flowId}:${fieldKey}`] ?? FIELD_EXAMPLES[fieldKey] ?? FIELD_EXAMPLES[flowId];
  if (curated) return curated;
  const t = promptTemplate(flowId);
  if (t === GENERIC && description) return description; // schema hint is richer than a generic blank
  return t.example;
}

// v1 local drafting: weave the user's brief into a fuller prompt, enriched by medium.
// An honest starter — swap for a real Concierge endpoint when the chat backend lands.
export function buildPrompt(flowId: string, brief: string): string {
  const b = brief.trim().replace(/\s+/g, ' ');
  if (!b) return '';
  if (/song|music|audio|mula|moss/i.test(flowId)) return `${b} — rich, emotive arrangement, polished studio mix`;
  if (/video|ltx|wan|hunyuan-?video/i.test(flowId)) return `${b}, smooth cinematic motion, natural lighting, sharp focus`;
  if (/3d|mesh|hunyuan3d/i.test(flowId)) return `${b}, clean geometry, even topology, well-defined details`;
  return `${b}, cinematic lighting, highly detailed, crisp focus`;
}
