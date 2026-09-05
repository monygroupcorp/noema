// editio — NOEMA's NFT-collection authoring (editio-overview.md). A collection is a hub
// (traits garden → rules → canonic run → curation → export). Local-first; the hemisphere
// flips to lit (public) only at the export crossing → NOESIS. No backend yet.
// TODO(backend: collection records — traits, rules, supply, custody, export adapters).

export type CollStatus = 'draft' | 'locked' | 'minted';

export interface Collection {
  id: string;
  name: string;
  theme: string;          // the collection's aesthetic family
  supply: number;         // pieces
  target: number;         // target supply
  traits: number;
  status: CollStatus;
  rarityDelta: string;    // ±x% of rarity target
  tile: string;
}

export const COLLECTIONS: Collection[] = [
  { id: 'lumen-heads', name: 'Lumen Heads', theme: 'Frost · Ember · Arcane', supply: 1889, target: 1889, traits: 4, status: 'locked', rarityDelta: '±0.4%', tile: 'radial-gradient(120% 100% at 40% 30%, #3b4f78, #1b2740)' },
  { id: 'sumi-spirits', name: 'Sumi Spirits', theme: 'Ink · Mist', supply: 512, target: 1000, traits: 3, status: 'draft', rarityDelta: '±1.2%', tile: 'radial-gradient(120% 100% at 55% 35%, #2f4a44, #18241f)' },
  { id: 'frost-drakes', name: 'Frost Drakes', theme: 'Frost', supply: 888, target: 888, traits: 5, status: 'minted', rarityDelta: '±0.2%', tile: 'radial-gradient(120% 100% at 50% 30%, #2c5d54, #16241f)' },
];

export const STATUS_LABEL: Record<CollStatus, string> = { draft: 'draft', locked: 'supply locked', minted: 'minted · live' };

// ── Real backend helpers (Collections + EditioHub are wired; the other hub screens
//    still use the mock above until their endpoints exist). ─────────────────────────
import type { CollectionStatus } from './api';

export const COLL_STATUS_LABEL: Record<CollectionStatus, string> = {
  draft: 'draft', pending: 'queued', running: 'generating', complete: 'complete', cancelled: 'cancelled',
};

// A collection is local/private (dashed) until it's exported → minted. The Collectio
// projection never mints (mint is a separate publish), so it stays dashed here.
export const collGlyph = (): 'dashed' | 'lit' => 'dashed';

// A deterministic mosaic gradient from the collection id (no image on the projection).
export function collTile(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  const a = h % 360, b = (a + 40) % 360;
  return `radial-gradient(120% 100% at 45% 30%, hsl(${a} 30% 28%), hsl(${b} 35% 14%))`;
}

// ── How a trait's value reaches a piece ───────────────────────────────────────
//
// The traits garden used to explain the whole mechanism in five words — "the value is
// spliced into the flow" — which names no destination, no moment, and no rule. These
// derive the explanation from the assembly code instead, so the screens say what the
// run actually does rather than what someone remembered it doing.
//
// The path, read off `TraitMixer.selectForPiece` and `CollectioCursor`'s dispatch:
//
//   1. Per piece, one value is chosen from each axis — weighted by rarity, with the
//      axis's exclusions and tag rules applied. The choice is seeded from the axis and
//      the piece number, so the same grid always produces the same collection.
//   2. The winning value is set on the flow's input port named by the axis (`porta`).
//   3. The prompt is assembled separately, from the values' PROMPT FRAGMENTS — not from
//      their values. The mixer has two modes, and they are chosen for the prompt as a
//      WHOLE, not per axis: a base prompt containing `{{` anywhere is in TOKEN mode,
//      where the only thing that reaches the prompt is a `{{porta}}` being replaced in
//      place; any other base prompt is in JOIN mode, where fragments are appended to it,
//      comma-separated, in axis order.
//      The consequence worth saying out loud, because it is invisible on the screen: in
//      token mode an axis with a prompt fragment and NO `{{porta}}` of its own is not
//      appended as a fallback — it reaches the prompt not at all.
//   4. An axis on the `prompt` port itself skips all of that: its value is the piece's
//      whole prompt, and the assembled one is discarded.
//   5. The value's label (not its value) becomes the piece's NFT attribute, under the
//      axis's label.

/** Which route an axis's winning value takes to the piece. */
export type SpliceRoute =
  | 'whole-prompt'
  | 'prompt-token'
  | 'token-missing'
  | 'prompt-append'
  | 'port-only';

export interface AxisSplice {
  route: SpliceRoute;
  /** One plain sentence: where this axis's value lands on every piece. */
  line: string;
}

/**
 * What one axis does to a piece — derived, not described.
 *
 * `basePrompt` is the collection's `_basePrompt`, and the mixer's two prompt modes turn on it
 * as a WHOLE, not per axis: a base prompt containing `{{` anywhere puts prompt assembly in
 * token mode, where the only thing that reaches the prompt is a token being replaced. An axis
 * with a prompt fragment and no `{{porta}}` to land in therefore contributes nothing — it is
 * NOT appended as a fallback. That asymmetry is the easiest thing to get wrong by describing
 * the mechanism from memory, so it gets its own route.
 */
export function axisSplice(
  axis: { porta: string; label?: string; valores: Array<{ promptFragment?: string }> },
  basePrompt?: string,
): AxisSplice {
  const port = axis.porta;

  // An axis on the `prompt` port wins outright: the dispatch takes the mixer's value for that
  // port over the assembled prompt, so nothing else this axis might do to the prompt survives.
  if (port === 'prompt') {
    return {
      route: 'whole-prompt',
      line: 'One of these values becomes the piece’s entire prompt — a value here replaces the assembled prompt rather than adding to it.',
    };
  }

  const setsPort = `One value is chosen per piece and set on the flow’s ${port} input.`;

  if (basePrompt?.includes('{{')) {
    // Token mode, for the whole prompt.
    if (basePrompt.includes(`{{${port}}}`)) {
      return {
        route: 'prompt-token',
        line: `${setsPort} Its prompt fragment replaces {{${port}}} where that token sits in the base prompt — or its label, when the value has no fragment.`,
      };
    }
    return {
      route: 'token-missing',
      line: `${setsPort} Your base prompt places its traits by token, and carries no {{${port}}} — so nothing from this axis reaches the prompt. Add {{${port}}} to the base prompt where you want it to read.`,
    };
  }

  // Join mode: only values carrying a prompt fragment contribute, appended in axis order.
  const withFragment = axis.valores.filter((v) => v.promptFragment).length;
  if (withFragment === 0) {
    return {
      route: 'port-only',
      line: `${setsPort} Nothing from this axis reaches the prompt — give a value a prompt fragment if it should.`,
    };
  }
  const some = withFragment < axis.valores.length;
  return {
    route: 'prompt-append',
    line: `${setsPort}${some ? ' Where the chosen value has a prompt fragment, it is' : ' Its prompt fragment is'} added to the end of the base prompt, in axis order.`,
  };
}

/** The shared sentence about WHEN and HOW OFTEN the choice happens — true of every axis. */
export const SPLICE_WHEN =
  'Every piece draws one value from each axis as the run dispatches it, weighted by rarity and filtered by your exclusions. The draw is seeded from the axis and the piece number, so the same grid always produces the same collection.';

/**
 * The run screen's plain-language account of the mechanism, sized to the collection it is
 * describing. Reads off the same axes the garden explains one at a time.
 */
export function spliceMechanismLine(
  tractus: Array<{ porta: string; label?: string; valores: Array<{ promptFragment?: string }> }> | undefined,
  basePrompt?: string,
): string {
  const axes = tractus ?? [];
  if (axes.length === 0) return SPLICE_WHEN;
  const routes = new Set(axes.map((a) => axisSplice(a, basePrompt).route));
  const ports = axes.map((a) => a.porta);
  const portList =
    ports.length === 1 ? ports[0]
    : `${ports.slice(0, -1).join(', ')} and ${ports[ports.length - 1]}`;

  // Says the strongest thing that is true of this grid, and names the one asymmetry an author
  // can be bitten by: in token mode an axis with no token of its own is silently prompt-less.
  const reaches =
    routes.has('whole-prompt') ? 'One axis supplies the whole prompt; the rest set their ports.'
    : routes.has('prompt-token') && routes.has('token-missing')
      ? 'Prompt fragments land where their {{token}} sits in the base prompt — and an axis with no token of its own reaches the prompt not at all.'
    : routes.has('prompt-token') ? 'Prompt fragments land where their {{token}} sits in the base prompt.'
    : routes.has('token-missing') ? 'The base prompt places traits by token and carries none of these axes’ — so it reads as written.'
    : routes.has('prompt-append') ? 'Prompt fragments are added to the end of the base prompt, in axis order.'
    : 'These axes set flow inputs only — the prompt is the base prompt as written.';

  return `${SPLICE_WHEN} Each draw sets the flow’s ${portList} input${ports.length === 1 ? '' : 's'}. ${reaches}`;
}
