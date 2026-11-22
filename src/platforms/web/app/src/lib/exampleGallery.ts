// =============================================================================
// exampleGallery — the curated "examples of our own" showcase set
// =============================================================================
//
// A small, hand-picked list of noema's own generations (never third-party/scraped
// media — see the examples-of-our-own goal's clause 1), each one launchable into an
// editable run via the SAME query-string prefill Shelf.tsx's "Use in a flow" already
// uses (resolveUseInFlowTarget) — Card.tsx reads a query param per aditus key on load.
//
// SHOWCASE_EXAMPLES is the manifest rth's ruling sized at 8 (2026-11-20): every row's
// modus, aditus and prompt text are authored now (ours, never copied — clause 1), but
// `mediaUrl` is a SLOT, left unset until the boardroom fires the row for real against
// prod (scripts/examples-gallery/fire-example.ts drives that step; see its PLAN.md —
// most of these rows dispatch async to a RunPod pod, which this manifest does not need
// to know about). `isFired` is the one place that distinction is read from; a row with
// no mediaUrl is still real and still launchable — only its preview is pending.
// =============================================================================

export type ExampleFeature = 'make' | 'muse' | 'collections' | 'model';
export type ExampleKind = 'image' | 'video';

export interface ShowcaseExample {
  id: string;
  title: string;
  blurb: string;
  feature: ExampleFeature;
  kind: ExampleKind;
  /** Free-form style tags ("portrait", "cgi", "anime", …) — the third facet axis. */
  style: string[];
  /** Unset until this row is fired for real — see `isFired`. */
  mediaUrl?: string;
  thumbUrl?: string;
  /** Which flow "launch" opens — the /card?id=<modusId> target. */
  modusId: string;
  /** Every key here rides the launch link's query string and seeds that aditus field. */
  aditus: Record<string, string | number | boolean>;
  /** Cosmetic only (mirrors Card.tsx's loraName param) — names the model this example shows. */
  loraName?: string;
}

export const FEATURE_LABEL: Record<ExampleFeature, string> = {
  make: 'Make',
  muse: 'Muse',
  collections: 'Collections',
  model: 'A trained model',
};

/** A row counts as fired once it carries a real output — see the manifest note above. */
export function isFired(example: ShowcaseExample): boolean {
  return !!example.mediaUrl;
}

export const SHOWCASE_EXAMPLES: ShowcaseExample[] = [
  {
    id: 'model-01',
    title: "Your photo, STATIONTHIS'd",
    blurb: "Our forked, LoRA-pinned edit flow — drop in any photo and get back our locked PS2-emulator recipe. The prompt and the LoRA are pinned; only the photo is yours.",
    feature: 'model',
    kind: 'image',
    style: ['retro', '3d', 'portrait'],
    modusId: 'stationthis',
    aditus: {},
    loraName: 'impresstation-klein',
  },
  {
    id: 'model-02',
    title: 'Train a LoRA from a handful of photos',
    blurb: 'Our own training flow — point it at an image set and a trigger word, and it hands back a usable LoRA plus sample renders of what it learned.',
    feature: 'model',
    kind: 'image',
    style: ['training'],
    modusId: 'modus.aitoolkit-training',
    aditus: {
      triggerWord: 'duskwalker',
      baseModel: 'klein-4b',
      steps: 800,
      samplePrompts: JSON.stringify([
        'duskwalker standing in a flooded neon alley, rain streaked light',
        'duskwalker reading at a kitchen table lit by a single bulb',
      ]),
    },
  },
  {
    id: 'muse-01',
    title: 'A fragment-combo render from Muse',
    blurb: "One kept combination from our caption-to-fragment decomposer, rendered on a pod flow — not the OpenAI anchor.",
    feature: 'muse',
    kind: 'image',
    style: ['painterly', 'still-life'],
    modusId: 'krea-turbo',
    aditus: { prompt: 'a cracked terracotta urn glowing faint blue from within, set on a moss-covered stone step, afternoon light through pine needles' },
  },
  {
    id: 'collections-01',
    title: "One trait pull from a collection's grid",
    blurb: "A single value off a collection's trait axis — one flow, one prompt axis, many values; this is glaze: oxide green.",
    feature: 'collections',
    kind: 'image',
    style: ['collectible', 'ceramic'],
    modusId: 'flux-schnell',
    aditus: { prompt: 'a ceramic fox figurine, one of a numbered set, glazed oxide green with a cracked-glaze pattern, studio lit on a plain backdrop' },
  },
  {
    id: 'video-01',
    title: 'Text to video — Wan2.2',
    blurb: 'A prompt in, a short silent clip out — no image needed.',
    feature: 'make',
    kind: 'video',
    style: ['atmospheric'],
    modusId: 'wan22-t2v',
    aditus: { prompt: 'a paper boat drifting down a rain-flooded gutter at night, streetlight reflections breaking across the water, shot low and level with the curb' },
  },
  {
    id: 'video-02',
    title: 'Bring a still to life — Wan2.2 image to video',
    blurb: 'Upload any still; this animates it into a short clip around your prompt.',
    feature: 'make',
    kind: 'video',
    style: ['atmospheric'],
    modusId: 'wan22-i2v',
    aditus: { prompt: 'the still exhales into motion: steam curls off the surface and drifts right, light flickers once like a passing cloud' },
  },
  {
    id: 'video-03',
    title: 'Text to video with audio — MiniMax H3',
    blurb: 'One pass, synced dialogue and ambience baked into the clip — a capability no OpenAI flow offers.',
    feature: 'make',
    kind: 'video',
    style: ['dialogue', 'atmospheric'],
    modusId: 'minimax-h3-t2v',
    aditus: { prompt: 'a radio DJ leans into a vintage mic in a dim booth: "you are listening to something that does not exist yet", over tape hiss and a distant kick drum' },
  },
  {
    id: 'make-01',
    title: 'Quick hosted anchor — GPT Image',
    blurb: 'Our one hosted-API anchor, kept to exactly one: fast and cheap next to the pod flows above.',
    feature: 'make',
    kind: 'image',
    style: ['3d', 'game'],
    modusId: 'modus.gpt-image',
    aditus: { prompt: 'a low-poly n64-style dragon perched on a neon temple rooftop, dusk, long shadows', size: '1024x1024', quality: 'high' },
  },
];

/** Same shape as Shelf.tsx's resolveUseInFlowTarget: every aditus key rides the query
 *  string, which Card.tsx's init-building loop seeds the form from on load. */
export function launchTarget(example: ShowcaseExample): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(example.aditus)) q.set(k, String(v));
  if (example.loraName) q.set('loraName', example.loraName);
  const qs = q.toString();
  return qs ? `/card?id=${example.modusId}&${qs}` : `/card?id=${example.modusId}`;
}

/** The distinct style tags present in the set, sorted — no hardcoded allowlist, so a
 *  new style tag on a future example shows up as a filter automatically (Catalog.tsx's
 *  distinctVerbs follows the same "derive from the result set" rule). */
export function distinctStyles(examples: ShowcaseExample[]): string[] {
  return Array.from(new Set(examples.flatMap((e) => e.style))).sort();
}

/** One filtering model, same rule Catalog.tsx's applyFilters states: every facet, and
 *  'All' clears it. A visitor with no facet picked sees everything — the way in for
 *  someone who doesn't know what they want yet. */
export function applyExampleFilters(
  examples: ShowcaseExample[],
  feature: ExampleFeature | 'All',
  kind: ExampleKind | 'All',
  style: string | 'All',
): ShowcaseExample[] {
  return examples.filter(
    (e) =>
      (feature === 'All' || e.feature === feature) &&
      (kind === 'All' || e.kind === kind) &&
      (style === 'All' || e.style.includes(style)),
  );
}
