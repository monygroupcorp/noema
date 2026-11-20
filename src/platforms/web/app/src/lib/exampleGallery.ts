// =============================================================================
// exampleGallery — the curated "examples of our own" showcase set
// =============================================================================
//
// A small, hand-picked list of noema's own generations (never third-party/scraped
// media — see the examples-of-our-own goal's clause 1), each one launchable into an
// editable run via the SAME query-string prefill Shelf.tsx's "Use in a flow" already
// uses (resolveUseInFlowTarget) — Card.tsx reads a query param per aditus key on load.
//
// SHOWCASE_EXAMPLES starts empty on purpose: every entry needs a real mediaUrl + real
// aditus from an actual noema run (see scripts/examples-gallery/fire-example.ts), and a
// fabricated placeholder here would be indistinguishable from the real thing to a
// visitor — the honest empty state lives in Examples.tsx instead, not a fake row.
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
  mediaUrl: string;
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

export const SHOWCASE_EXAMPLES: ShowcaseExample[] = [];

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
