// The nozzle: choosing a LoRA, and what every piece then carries (noema-246). Two
// mechanisms, both required: `pinnedModels` on the run request says which weights the run
// may have, and the trigger word in the prompt is what actually applies them.

import type { ModelCard, RunRequest } from '../api';
import { ignitionRequest } from './ignition';
import { trim } from './run-readout';

// ── The nozzle: choosing a LoRA, and what every piece then carries (noema-246) ─
// S5 puts the model on a control of its own, beside the flow and away from the steer
// keyboard. The floor is fuel and a floor edit changes which fragments the next draw
// may pull; this is the nozzle, and changing it changes what the pod loads.
//
// TWO MECHANISMS, BOTH REQUIRED, and they are not alternatives:
//
//   `pinnedModels` on the run request says WHICH weights the run may have — the same
//   top-level field `ProposalCard.tsx` already sends, carrying `intellaId` (the
//   unambiguous half of the field's documented "intellaId or slug").
//
//   THE TRIGGER WORD IN THE PROMPT is what actually applies them:
//   `src/crystal/loraResolver.ts` scans the prompt text and rewrites a known trigger
//   into a `<lora:name:weight>` tag for the pod's loader.
//
// A pin with no trigger downloads weights that are never applied — full price, no
// effect — and a trigger with no pin names weights the run was never given. Hence two
// separate proofs in the tests below rather than one.
//
// THE TRIGGER IS NOT A FLOOR FRAGMENT. It goes into the prompt string and nowhere
// else: never onto the cutting floor, never steerable, and never into a piece's
// recorded lineage — lineage is what a reaction reweights (S4), and a ♡ that could
// reweight a trigger word would let a reaction steer the nozzle.

/**
 * THE NOZZLE HOLDS A STACK. A stream may carry more than one LoRA at a time, and this
 * module carries no cap on how many: the run request's `pinnedModels` is a list, the
 * compiler resolves every ref in it against the caller's own models and the public
 * catalog, and nothing on that path bounds the count.
 *
 * No bound is invented here either. What stacking costs is time — a longer weight
 * download and a longer diffusion per piece — and what it costs in quality, or on the
 * pod, is not something this control can measure. A number picked here would be a guess
 * wearing the clothes of a limit. If a bound is ever established, it belongs where it
 * can be measured and this control should read it rather than restate it.
 */

/** The weight band the control offers. The resolver itself takes any weight — these are
 *  the CONTROL's bounds. The floor is deliberately above zero: `trigger:0.0` silences a
 *  LoRA in the resolver, which would leave the run pinning weights it never applies. */
export const LORA_WEIGHT_MIN = 0.1;
export const LORA_WEIGHT_MAX = 2;

/** The chosen nozzle: which weights to pin, and the trigger word that applies them.
 *  `weight` is `null` until the user sets one, which fires the LoRA at its own
 *  `defaultWeight` — the resolver's behaviour for a bare trigger. */
export interface LoraChoice {
  intellaId: string;
  nomen: string;
  trigger: string;
  weight: number | null;
}

/** The nozzle: an ordered list of choices. Order is the order the user stacked them,
 *  and it is the order the trigger words are written into the prompt. */
export type LoraStack = readonly LoraChoice[];

/**
 * What every nozzle-reading function takes. A single choice IS a stack of one, so the
 * one-model call sites read exactly as they did — the stack is the general case, not a
 * second API beside it.
 */
export type NozzleInput = LoraChoice | LoraStack | null | undefined;

/**
 * The nozzle as a list, de-duplicated by `intellaId` and with anything unusable dropped.
 *
 * DE-DUPLICATION IS NOT COSMETIC: the compiler de-dupes pinned refs on its own, so a
 * stack that carried the same model twice would show the user something the run will not
 * do. A card with no trigger word is dropped for the reason `loraChoiceOf` refuses it —
 * weights that are downloaded and never applied are a paid run with no effect.
 */
export function loraStack(nozzle: NozzleInput): LoraChoice[] {
  if (!nozzle) return [];
  const list: readonly LoraChoice[] = Array.isArray(nozzle)
    ? (nozzle as readonly LoraChoice[])
    : [nozzle as LoraChoice];
  const out: LoraChoice[] = [];
  const seen = new Set<string>();
  for (const choice of list) {
    if (!choice || !choice.intellaId) continue;
    if (!(choice.trigger ?? '').trim()) continue;
    if (seen.has(choice.intellaId)) continue;
    seen.add(choice.intellaId);
    out.push(choice);
  }
  return out;
}

/**
 * A catalog card as a choice, or `null` when it cannot be one.
 *
 * A card with no trigger word is not offerable: it could be pinned, but nothing in the
 * prompt would ever apply it, so it is a paid run with no effect. Refusing it in the
 * picker costs nothing; discovering it costs a piece.
 */
export function loraChoiceOf(card: ModelCard): LoraChoice | null {
  const trigger = (card.trigger ?? '').trim();
  if (!trigger || !card.intellaId) return null;
  return { intellaId: card.intellaId, nomen: card.nomen || card.intellaId, trigger, weight: null };
}

/**
 * The LoRAs on offer for the selected flow: the caller's own models first, then the
 * public catalog, de-duplicated by `intellaId`.
 *
 * SCOPED TO THE FLOW'S `familia` — the base-model family the flow runs on, read off its
 * own description. A LoRA trained on another base is a paid run that cannot work, so it
 * is not offered at all. With no `familia` in hand there is no scope to filter by and
 * the catalog is EMPTY rather than unscoped: an unscoped list is exactly the list that
 * contains the run that cannot work.
 *
 * Non-vacuity: dropping the `familia` filter must fail "the catalog offered is scoped to
 * the selected modus's familia".
 */
export function loraCatalog(
  ownModels: readonly ModelCard[],
  publicModels: readonly ModelCard[],
  familia: string | null | undefined,
): ModelCard[] {
  if (!familia) return [];
  const out: ModelCard[] = [];
  const seen = new Set<string>();
  for (const card of [...ownModels, ...publicModels]) {
    if (card.genus !== 'lora') continue;
    if (card.basis !== familia) continue;
    if (!loraChoiceOf(card)) continue;
    if (seen.has(card.intellaId)) continue;
    seen.add(card.intellaId);
    out.push(card);
  }
  return out;
}

/** Why there is no catalog to show, or `null` when there is one. Said in words rather
 *  than rendered as an empty list, because "no modus selected" and "this base has no
 *  LoRAs" are different facts and only one of them is the user's to fix. */
export function loraCatalogReason(
  modusId: string | null,
  familia: string | null | undefined,
  offered: number,
): string | null {
  if (!modusId) return 'choose a workflow first — a model is scoped to the workflow it runs on';
  if (!familia) return "this workflow doesn't name a base model, so there is no scoped catalogue to offer";
  if (offered <= 0) return `no LoRA with a trigger word is available for ${familia}`;
  return null;
}

/**
 * Stacking a LoRA onto the nozzle, or taking it back off: the same control both adds and
 * removes, so a card already on the stack is removed by choosing it again.
 *
 * TWO REFUSALS RIDE HERE, and both are the stack's own rather than the picker's:
 *
 *  - **`familia` scope.** A LoRA trained on another base is a paid run that cannot work.
 *    `loraCatalog` already declines to OFFER one; this declines to ACCEPT one, so the
 *    scope holds for every entry of the stack and not only for what the list happens to
 *    show. With no `familia` in hand there is no scope to check against and nothing can
 *    be stacked, which is the same answer `loraCatalog` gives to the same question.
 *  - **No duplicates.** The same `intellaId` cannot be stacked onto itself; choosing it
 *    again removes it. The compiler would de-dupe a repeated ref anyway, so a stack that
 *    displayed it twice would be describing a run that does not exist.
 *
 * Non-vacuity: dropping the familia check must fail "a LoRA outside the flow's familia
 * cannot enter the stack"; accumulating a repeat must fail "the same LoRA cannot be
 * stacked onto itself".
 */
export function chooseLora(
  current: NozzleInput,
  card: ModelCard,
  familia: string | null | undefined,
): LoraChoice[] {
  const stack = loraStack(current);
  const next = loraChoiceOf(card);
  if (!next) return stack;
  if (!familia || card.basis !== familia) return stack;
  const held = stack.some((c) => c.intellaId === next.intellaId);
  if (held) return stack.filter((c) => c.intellaId !== next.intellaId);
  return [...stack, next];
}

/**
 * Setting ONE entry's weight, leaving every other entry exactly as it was.
 *
 * A stack whose entries share a weight field is worse than no stack: the user sets 0.8
 * on one model and silently moves another they are already paying for. Each entry
 * carries its own `weight`, and an entry that has never been given one stays `null` —
 * "the LoRA's own default" — rather than inheriting its neighbour's.
 *
 * Non-vacuity: writing the weight onto every entry must fail "each stacked LoRA carries
 * its own weight, and an unset weight stays unset rather than inheriting its
 * neighbour's".
 */
export function setLoraWeight(
  current: NozzleInput,
  intellaId: string,
  value: number | null | undefined,
): LoraChoice[] {
  return loraStack(current).map((c) =>
    c.intellaId === intellaId ? { ...c, weight: loraWeight(value) } : c,
  );
}

/** Whether two nozzles differ — in which models they carry, in what order, or in the
 *  weight any one of them is carried at. What the screen holds the stream for. */
export function nozzleChanged(before: NozzleInput, after: NozzleInput): boolean {
  const a = loraStack(before);
  const b = loraStack(after);
  if (a.length !== b.length) return true;
  return a.some((c, i) => c.intellaId !== b[i].intellaId || (c.weight ?? null) !== (b[i].weight ?? null));
}

/** The trigger words the hold is loading, for the readout that names them. `undefined`
 *  when there is nothing on the nozzle, which is what `HoldState.trigger` omits. */
export function nozzleTriggerLabel(nozzle: NozzleInput): string | undefined {
  const stack = loraStack(nozzle);
  return stack.length === 0 ? undefined : stack.map((c) => c.trigger).join(' + ');
}

/** A weight the control will emit: inside the band, or `null` for "the LoRA's own
 *  default", which is what a bare trigger word means to the resolver. */
export function loraWeight(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(LORA_WEIGHT_MAX, Math.max(LORA_WEIGHT_MIN, value));
}

/**
 * The trigger as it is written into a prompt.
 *
 * The resolver's syntax is NOT re-implemented here — this emits one of the two forms it
 * already documents and reads: a bare `trigger` (applied at the LoRA's own
 * `defaultWeight`) or `trigger:0.8` (an explicit override). Everything else the
 * resolver understands — the `!`/`.` modifiers, explicit `<lora:…>` tags, the silencing
 * `:0.0` — stays the resolver's and is never generated here.
 */
export function triggerToken(choice: LoraChoice): string {
  const weight = loraWeight(choice.weight);
  return weight == null ? choice.trigger : `${choice.trigger}:${weight}`;
}

/**
 * The prompt a piece is actually fired with: the drawn prompt, led by the trigger word
 * of EVERY LoRA on the nozzle. With nothing on the nozzle it is the drawn prompt,
 * unchanged.
 *
 * EVERY entry's trigger, not the first one's. A pinned model whose trigger never reaches
 * the prompt is exactly the paid-run-with-no-effect that `loraChoiceOf` refuses a
 * triggerless card to avoid — stacking three and writing one reproduces it twice over,
 * at full price, per piece.
 *
 * The triggers are prepended and comma-separated, which is a delimiter the resolver's
 * own tokenizer splits on, so each word is reachable by its scan wherever the drawn
 * prompt happens to begin.
 *
 * Non-vacuity: returning `prompt` unchanged must fail "a piece fired under a LoRA
 * carries that LoRA's trigger word in its prompt"; writing only the first entry's
 * trigger must fail "the prompt carries every stacked LoRA's trigger word".
 */
export function promptWithTrigger(prompt: string, nozzle: NozzleInput): string {
  const stack = loraStack(nozzle);
  if (stack.length === 0) return prompt;
  const body = prompt.trim();
  const tokens = stack.map(triggerToken).join(', ');
  return body ? `${tokens}, ${body}` : tokens;
}

/**
 * A standing instruction that rides EVERY prompt fired on this nozzle, blanket the way
 * the model choice does — set once, and every piece from then on carries it until it is
 * changed, unlike a steer, which is sent once and lands on the floor. It is client
 * state on the same terms as the model choice: it does not survive a reload, and it
 * never writes the floor, restamps a fragment, or opens a `SteerState`.
 */
export interface AffixInput {
  prefix?: string | null;
  suffix?: string | null;
}

export function hasAffix(affix: AffixInput | null | undefined): boolean {
  return !!((affix?.prefix ?? '').trim() || (affix?.suffix ?? '').trim());
}

/** The affix in words, for the nozzle's own collapsed line — `undefined` when nothing is
 *  riding, so a bare nozzle summary reads exactly as it did before this item. Abbreviated
 *  rather than wrapped, the same way the tile readout is (`TILE_READOUT_MAX`). */
const AFFIX_READOUT_MAX = 28;

export function affixSummaryLine(affix?: AffixInput | null): string | undefined {
  if (!hasAffix(affix)) return undefined;
  const prefix = (affix?.prefix ?? '').trim();
  const suffix = (affix?.suffix ?? '').trim();
  const parts: string[] = [];
  if (prefix) parts.push(`prefix “${trim(prefix, AFFIX_READOUT_MAX)}”`);
  if (suffix) parts.push(`suffix “${trim(suffix, AFFIX_READOUT_MAX)}”`);
  return parts.join(' · ');
}

/**
 * The prompt a piece is actually fired with, the standing affix composed in ON TOP of
 * `promptWithTrigger`'s own trigger-leading rule — never through it. A LoRA trigger
 * token always leads the final prompt; the affix composes AROUND that block, never
 * displacing, duplicating or reordering a trigger. The prefix sits immediately after
 * the trigger tokens (or leads the prompt when there is no LoRA chosen) and before the
 * drawn text; the suffix always trails everything, after the drawn text.
 *
 * Empty means untouched: with no prefix and no suffix this returns exactly what
 * `promptWithTrigger` returns, unmodified — so every existing call site is unaffected
 * until an affix is actually set.
 *
 * Non-vacuity: dropping the affix on either the stream or the manual path must fail "a
 * fired piece carries the standing prefix and suffix"; reverting the empty-affix guard
 * must fail "an empty prefix and suffix leave the prompt byte-identical"; reverting the
 * ordering must fail "every LoRA trigger token is still present, exactly once, and
 * still leads the prompt".
 */
export function promptWithAffix(prompt: string, nozzle: NozzleInput, affix?: AffixInput | null): string {
  if (!hasAffix(affix)) return promptWithTrigger(prompt, nozzle);

  const stack = loraStack(nozzle);
  const tokens = stack.length > 0 ? stack.map(triggerToken).join(', ') : '';
  const prefix = (affix?.prefix ?? '').trim();
  const suffix = (affix?.suffix ?? '').trim();
  const body = prompt.trim();

  const lead = [tokens, prefix, body].filter((part) => part.length > 0).join(', ');
  return suffix ? (lead ? `${lead}, ${suffix}` : suffix) : lead;
}

/** The weights the run is given, by `intellaId` — the unambiguous half of the field's
 *  documented "intellaId or slug", picked once and used consistently. */
export function pinnedModelsFor(nozzle: NozzleInput): string[] {
  return loraStack(nozzle).map((c) => c.intellaId);
}

/**
 * The run request for ONE fired piece: the prompt carrying the trigger and the standing
 * affix, and the pinned weights the trigger resolves against.
 *
 * ONE COMPOSER FOR BOTH PATHS, and the name says so rather than naming the stream. A
 * piece fired by hand off a rolled card (`Muse.tsx#doFire`) and a piece fired by the
 * stream loop take the same route and are composed here, not twice: the nozzle is one
 * control on one screen, and a path that read it while its neighbour did not would make
 * the model beside the prompt mean two different things.
 *
 * BOTH HALVES OR NEITHER. `ignitionRequest` above stays exactly as it is — a mined
 * fragment's own trigger is still never lifted into `pinnedModels`, because that would
 * attach a model the user never chose. This path pins only what the user picked on the
 * nozzle control.
 *
 * NOTHING IS RESHAPED WHEN THERE IS NO NOZZLE. With an empty stack and no affix this is
 * `ignitionRequest(modusId, prompt)` exactly — the same keys and the same prompt string —
 * so a hand fire with no model chosen sends what it sent before.
 *
 * Non-vacuity: dropping `pinnedModels` must fail "a piece fired under a LoRA names it in
 * pinnedModels"; pinning only the first entry must fail "a piece fired under two LoRAs
 * names BOTH in pinnedModels"; reshaping the empty-nozzle request must fail "a hand-fired
 * piece with an empty stack sends what it sends today".
 */
export function firedRunRequest(
  modusId: string,
  prompt: string,
  nozzle: NozzleInput,
  affix?: AffixInput | null,
): RunRequest {
  const request = ignitionRequest(modusId, promptWithAffix(prompt, nozzle, affix));
  const pinned = pinnedModelsFor(nozzle);
  return pinned.length > 0 ? { ...request, pinnedModels: pinned } : request;
}

/** rth's rider on the nozzle stack (noema-276 shipped no cap, which is the ruling; this
 *  is the one readout it was still missing): a stack this deep is a longer COLD START,
 *  not a worse result and not anything refused — the stack still fires at any size, this
 *  only names the wait more plainly once it is long enough to be worth naming twice. */
export const DEEP_STACK_WARMUP_THRESHOLD = 4;

/** What the readout says while the first piece under a newly chosen nozzle is being
 *  made. The pod fetches the weights before it can make anything with them, so the first
 *  piece can be slow; said in words, it is a wait rather than a stall. A stack makes this
 *  matter MORE, not less — several sets of weights are fetched before the first piece —
 *  so the note names how many are coming down, and past `DEEP_STACK_WARMUP_THRESHOLD`
 *  it names the cold start explicitly rather than leaving the reader to infer it from a
 *  count. */
export function loraWarmupNote(nozzle: NozzleInput): string | null {
  const stack = loraStack(nozzle);
  if (stack.length === 0) return null;
  const names = stack.map((c) => c.nomen).join(' + ');
  if (stack.length === 1) {
    return `first piece under ${names} may be slow — the pod fetches its weights before it can use them`;
  }
  if (stack.length < DEEP_STACK_WARMUP_THRESHOLD) {
    return `first piece under ${names} may be slow — the pod fetches all ${stack.length} sets of weights before it can use them`;
  }
  return `first piece under ${names} may be slow — a stack this deep means a longer cold start, fetching all ${stack.length} sets of weights before the pod can use any of them`;
}

/** The chosen nozzle in one line, trigger word included: S5 asks for the trigger to be
 *  visible on the chosen model and not only in the picker, because it is the part a user
 *  has to see to trust that the model is being applied at all. */
export function loraChoiceLine(nozzle: NozzleInput): string {
  const stack = loraStack(nozzle);
  if (stack.length === 0) return 'no model — the workflow’s own base only';
  return stack
    .map((choice) => {
      const weight = loraWeight(choice.weight);
      return `${choice.nomen} · trigger ${choice.trigger}${weight == null ? '' : ` · weight ${weight}`}`;
    })
    .join(' + ');
}

