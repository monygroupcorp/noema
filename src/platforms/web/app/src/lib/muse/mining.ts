// The mining loop (Muse P5) — locks, varies, and the roll-ancestry tree. Thin composition
// over `src/crystal/muse`; no logic is reimplemented here (see the note at the top of
// `../muse.ts`).

import { rollFragments } from '../../../../../../crystal/muse/sampler.js';
import { composeTemplate, detectConflicts } from '../../../../../../crystal/muse/weaver.js';
import { CATEGORIES, fragmentKey } from '../../../../../../crystal/muse/taxonomy.js';
import type { Fragment, FragmentCategory } from '../api';
import { curatedFragments, regroup, type StreamDraw } from './garden';

// ── The mining loop (Muse P5, noema-231) ─────────────────────────────────────
//
// A randomizer draws independent rolls; a prompt miner lets you steer one. The
// three moves below are what turns the former into the latter, and all three are
// arithmetic over a garden that is already in memory — no route, no provider, no
// credit is involved anywhere in this section.
//
//   LOCK    pin the fragments that are working. A locked fragment survives every
//           subsequent vary; everything else re-samples.
//   VARY    from one roll, draw N neighbours: same locked fragments, everything
//           else fresh. Distinct from `rollCurated`, which draws N INDEPENDENT
//           rolls — independent rolls find a direction, varies refine one.
//   ANCESTRY  every roll a vary came out of is kept, with a pointer back to the
//           roll it was varied from, so a wrong turn does not cost the good roll
//           you came from.
//
// Two things this composes over rather than changes:
//
// 1. `rollFragments` takes no notion of a lock and is not given one. A vary rolls
//    normally at a FRESH index and the locked categories are overwritten
//    afterwards (`applyLocks`). Determinism therefore survives intact: an index
//    always yields the same underlying roll, a vary is a new roll at a new index
//    rather than a mutation of an existing one, and a node stores its index and
//    its lock set so it can be recomputed exactly.
// 2. A varied roll is an ORDINARY roll — a prompt and a free/paid verdict — so it
//    goes through the existing keep and fire rails unchanged.
//
// Naming: this is roll ANCESTRY, deliberately not called lineage. `lineageOf` and
// `pieceLineage` above are a different thing entirely (the fragments that produced
// a fired piece), and the two must never read as one.

/**
 * The fragments pinned for the next vary, keyed by category.
 *
 * Category-keyed because that is the shape the engine yields: `rollFragments`
 * samples at most one fragment per category, so a lock is a replacement for a
 * category's sample rather than an extra fragment beside it.
 */
export type LockSet = ReadonlyMap<FragmentCategory, Fragment>;

/** Nothing pinned — the state a fresh roll is varied from. */
export const NO_LOCKS: LockSet = new Map();

/** Whether this exact fragment is the one pinned for its category. */
export function isLocked(locks: LockSet, fragment: Pick<Fragment, 'category' | 'text'>): boolean {
  const held = locks.get(fragment.category);
  return !!held && fragmentKey(held) === fragmentKey(fragment);
}

/** Pin a fragment, or unpin it if it is already the one held for its category.
 *  Pinning a second fragment of the same category REPLACES the first — a category
 *  contributes one fragment, so it can pin only one. */
export function toggleLock(locks: LockSet, fragment: Fragment): LockSet {
  const next = new Map(locks);
  if (isLocked(locks, fragment)) next.delete(fragment.category);
  else next.set(fragment.category, fragment);
  return next;
}

/** The pinned categories, in the taxonomy's own order so the readout is stable. */
export function lockedCategories(locks: LockSet): FragmentCategory[] {
  return CATEGORIES.filter((c) => locks.has(c));
}

/** How many fragments are pinned. */
export function lockCount(locks: LockSet): number {
  return locks.size;
}

/**
 * Overwrite a sampled roll's locked categories with their pinned fragments.
 *
 * THE TIER RULE. A category may contribute at most ONE fragment to a prompt, and
 * for the exclusive tier (`setting`, `style`, `palette`, `lighting`, `mood`) that
 * is not a tidiness preference: two settings describe two images. A locked
 * fragment therefore REPLACES its category's sample in place; it is never appended
 * beside it. A locked category the roll did not sample at all (an empty or fully
 * disabled pool) is appended once, at the end.
 *
 * Non-vacuity: replacing the body with `[...sampled, ...locks.values()]` must fail
 * "an exclusive category yields at most one fragment per roll".
 */
export function applyLocks(sampled: readonly Fragment[], locks: LockSet): Fragment[] {
  const out: Fragment[] = [];
  const placed = new Set<FragmentCategory>();
  for (const f of sampled) {
    const chosen = locks.get(f.category) ?? f;
    if (placed.has(chosen.category)) continue;
    placed.add(chosen.category);
    out.push(chosen);
  }
  for (const category of CATEGORIES) {
    const held = locks.get(category);
    if (!held || placed.has(category)) continue;
    placed.add(category);
    out.push(held);
  }
  return out;
}

/**
 * One neighbour of the current roll: a fresh roll at `index`, with the locked
 * categories overwritten.
 *
 * Non-vacuity: dropping the `applyLocks` call must fail "a locked fragment is
 * byte-identical across successive varies".
 */
export function varyAt(
  gardenFragments: readonly Fragment[],
  excluded: ReadonlySet<number>,
  locks: LockSet,
  index: number,
): StreamDraw {
  const garden = regroup(curatedFragments([...gardenFragments], excluded));
  const at = Math.max(0, Math.trunc(index));
  const fragments = applyLocks(rollFragments(garden, at), locks);
  return {
    index: at,
    fragments,
    prompt: composeTemplate(fragments),
    // The same detector the roll cards badge — never a second opinion formed here.
    paid: detectConflicts(fragments).length > 0,
  };
}

/**
 * `count` neighbours, at consecutive fresh indices starting at `startIndex`.
 *
 * The indices advance because a vary at a fixed index is the same roll every time:
 * `rollFragments` is deterministic on its index, which is exactly what makes a
 * stored node replayable and what makes re-seeding one illegal.
 */
export function varyFrom(
  gardenFragments: readonly Fragment[],
  excluded: ReadonlySet<number>,
  locks: LockSet,
  startIndex: number,
  count: number,
): StreamDraw[] {
  const from = Math.max(0, Math.trunc(startIndex));
  const draws: StreamDraw[] = [];
  for (let i = 0; i < Math.max(0, Math.trunc(count)); i++) {
    draws.push(varyAt(gardenFragments, excluded, locks, from + i));
  }
  return draws;
}

/**
 * Why a vary would come back as N copies of the roll it started from, or `null`
 * when it can genuinely move.
 *
 * A category can move only if it is unpinned AND still holds more than one
 * fragment in the draw. Lock every category and there is nothing left to sample; a
 * real dataset also reaches this from the other side, because a decomposed set
 * routinely yields categories with a single fragment or none at all. Either way the
 * control has to say which categories are pinning it rather than returning
 * identical rolls and reading as a broken button.
 *
 * Non-vacuity: returning `null` unconditionally must fail "varying with every
 * category locked reports that nothing can change".
 */
export function varyBlockReason(
  gardenFragments: readonly Fragment[],
  excluded: ReadonlySet<number>,
  locks: LockSet,
): string | null {
  const garden = regroup(curatedFragments([...gardenFragments], excluded));
  const present = CATEGORIES.filter((c) => (garden[c]?.length ?? 0) > 0);
  if (present.length === 0) return 'nothing is in the draw — every fragment is excluded.';
  if (present.some((c) => !locks.has(c) && (garden[c]?.length ?? 0) > 1)) return null;

  const locked = present.filter((c) => locks.has(c));
  const thin = present.filter((c) => !locks.has(c) && (garden[c]?.length ?? 0) === 1);
  const parts: string[] = [];
  if (locked.length > 0) parts.push(`${locked.join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked`);
  if (thin.length > 0) parts.push(`${thin.join(', ')} ${thin.length === 1 ? 'has' : 'have'} one fragment in the draw`);
  return `nothing can change — ${parts.join('; ')}. unlock a category, or widen the floor, to keep mining.`;
}

/**
 * One roll in the mining tree: what it drew, and what it was varied from.
 *
 * `rollIndex` plus `locks` are enough to recompute the node exactly, and
 * `fragments` is what it actually drew — stored rather than recomputed, so
 * stepping back returns the roll you came from rather than a re-sample of it.
 */
export interface MiningNode {
  /** Stable within one tree, and independent of the roll index — an independent
   *  roll and a vary can legitimately share an index. */
  id: string;
  rollIndex: number;
  locks: LockSet;
  fragments: Fragment[];
  prompt: string;
  paid: boolean;
  /** The node this one was varied from; `null` for a root (an independent roll). */
  parentId: string | null;
}

/** The mining tree, and where in it the user is standing. */
export interface MiningTree {
  nodes: MiningNode[];
  currentId: string | null;
  /** The lowest roll index no node has taken. A vary starts here. */
  nextIndex: number;
}

/**
 * Where the mining index space starts.
 *
 * `rollCurated` always indexes its independent rolls from zero, so varies are given
 * a disjoint band above them. A roll index then names exactly one card on the
 * screen, which is what lets the per-card state the screen keys by index (the edited
 * text, the in-flight fire, the fire's error) belong to one card rather than two.
 */
export const MINING_INDEX_BASE = 1000;

/** The most rolls one batch may draw — independent or varied. Well below
 *  `MINING_INDEX_BASE`, which is what keeps the two index spaces disjoint. */
export const MAX_ROLLS = 50;

export const EMPTY_MINING: MiningTree = { nodes: [], currentId: null, nextIndex: MINING_INDEX_BASE };

/** What a vary needs from the roll it starts from — satisfied by both a report roll
 *  and a mining node, so either can be the thing you pull on. */
export interface VaryOrigin {
  index: number;
  fragments: Fragment[];
  prompt: string;
  paid: boolean;
}

/** Admit an independent roll as a root of the tree and stand on it. */
export function rootFrom(tree: MiningTree, origin: VaryOrigin, locks: LockSet): MiningTree {
  const node: MiningNode = {
    id: `m${tree.nodes.length}`,
    rollIndex: origin.index,
    locks: new Map(locks),
    fragments: [...origin.fragments],
    prompt: origin.prompt,
    paid: origin.paid,
    parentId: null,
  };
  return {
    nodes: [...tree.nodes, node],
    currentId: node.id,
    nextIndex: Math.max(tree.nextIndex, MINING_INDEX_BASE, origin.index + 1),
  };
}

/**
 * Hang a batch of neighbours off `parentId` and stay standing on the parent — the
 * neighbours are what you are looking at, the parent is what you are looking from.
 *
 * Non-vacuity: writing `parentId: null` on the children must fail "stepping back
 * returns the exact prior roll, not a re-sample of it".
 */
export function varyInto(
  tree: MiningTree,
  parentId: string,
  draws: readonly StreamDraw[],
  locks: LockSet,
): MiningTree {
  if (!nodeOf(tree, parentId)) return tree;
  const nodes = [...tree.nodes];
  let nextIndex = tree.nextIndex;
  for (const draw of draws) {
    nodes.push({
      id: `m${nodes.length}`,
      rollIndex: draw.index,
      locks: new Map(locks),
      fragments: [...draw.fragments],
      prompt: draw.prompt,
      paid: draw.paid,
      parentId,
    });
    nextIndex = Math.max(nextIndex, draw.index + 1);
  }
  return { nodes, currentId: parentId, nextIndex };
}

/** The node with this id, if the tree holds one. */
export function nodeOf(tree: MiningTree, id: string | null | undefined): MiningNode | undefined {
  if (!id) return undefined;
  return tree.nodes.find((n) => n.id === id);
}

/** The node a vary produced this one from. */
export function parentOf(tree: MiningTree, node: MiningNode): MiningNode | undefined {
  return nodeOf(tree, node.parentId);
}

/** The neighbours varied out of this node, in the order they were drawn. */
export function childrenOf(tree: MiningTree, id: string): MiningNode[] {
  return tree.nodes.filter((n) => n.parentId === id);
}

/** The trail from the root down to this node, root first — the path the mining took. */
export function ancestryOf(tree: MiningTree, id: string): MiningNode[] {
  const trail: MiningNode[] = [];
  const seen = new Set<string>();
  let at = nodeOf(tree, id);
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    trail.unshift(at);
    at = parentOf(tree, at);
  }
  return trail;
}

/** Stand on another node — a step back to an ancestor, or across to a neighbour.
 *  An unknown id leaves the tree where it was rather than clearing it. */
export function stepTo(tree: MiningTree, id: string): MiningTree {
  if (!nodeOf(tree, id)) return tree;
  return { ...tree, currentId: id };
}

/** The node being stood on. */
export function currentMiningNode(tree: MiningTree): MiningNode | null {
  return nodeOf(tree, tree.currentId) ?? null;
}

/** A short readout of what is pinned, for the vary control. */
export function lockSummaryLine(locks: LockSet): string {
  const categories = lockedCategories(locks);
  if (categories.length === 0) return 'nothing locked — a vary is a fresh roll';
  return `locked: ${categories.join(', ')}`;
}

