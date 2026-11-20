// Activity read helpers (noema-326 + noema-327) and the home dashboard's "awaiting you" /
// "running now" bands. Pure helpers over `GET /v1/me/activity` rows (types + fetch live in
// `../api`). This file is the Muse-specific engine's front end elsewhere; these functions
// are unrelated to it — kept here because it's the client's designated non-component home
// for pure display logic.

import type { ActivityDoor, ActivityKind, ActivityRow } from '../api';

// ── Activity read helpers (noema-326 + noema-327) ─────────────────────────────
// Pure helpers over `GET /v1/me/activity` rows (types + fetch live in `./api`).
// Two surfaces consume the same read: the Activity screen's "running now" /
// "recently finished" bands + the rail badge (326: `Status.tsx`/`Rail.tsx`), and
// the home dashboard's AWAITING YOU / RUNNING NOW bands (327: `Dashboard.tsx`).
// This file is the Muse-specific engine's front end elsewhere; these functions
// are unrelated to it — kept here because it's the client's designated
// non-component home for pure display logic.

/**
 * Split one activity page into the two bands the Activity screen renders:
 * in-flight rows first (newest first, same order the read returns), then
 * settled rows. Order within each band is preserved from the input.
 *
 * Non-vacuity: a finished row landing in `running` (or vice versa) must fail —
 * every assertion below checks band MEMBERSHIP, not just band length.
 */
export function partitionActivity(rows: ActivityRow[]): { running: ActivityRow[]; finished: ActivityRow[] } {
  const running: ActivityRow[] = [];
  const finished: ActivityRow[] = [];
  for (const row of rows) (row.status === 'running' ? running : finished).push(row);
  return { running, finished };
}

/**
 * The rail's Activity badge count: how many rows are in flight right now.
 *
 * Non-vacuity: a badge that shows with zero in-flight rows must fail — this is
 * tested at zero explicitly, not just at a positive count.
 */
export function activityBadgeCount(rows: ActivityRow[]): number {
  return rows.reduce((n, row) => (row.status === 'running' ? n + 1 : n), 0);
}

// ── Home "awaiting you" / "running now" bands (noema-327) ──────────────────────────────
//
// The home dashboard's two real bands, built from ONE `GET /v1/me/activity` read (the
// first page — in-flight rows ride it exclusively). Pure so the split and the door
// resolution are testable without a DOM.

/** How many terminal rows the AWAITING YOU band shows. */
export const AWAITING_YOU_MAX = 5;

export interface HomeActivityBands {
  /** Terminal rows, newest first, capped to `AWAITING_YOU_MAX`. */
  awaiting: ActivityRow[];
  /** In-flight rows, newest first. */
  running: ActivityRow[];
}

/**
 * Split one activity page into the home dashboard's two bands. Operates only on real
 * `ActivityRow` shapes read from the activity endpoint — never on the client-local chat
 * list, which carries none of `status`/`kind`/`door` and so cannot feed a meaningful
 * band here.
 */
export function partitionHomeActivity(rows: ActivityRow[]): HomeActivityBands {
  return {
    awaiting: rows.filter((r) => r.status === 'settled').slice(0, AWAITING_YOU_MAX),
    running: rows.filter((r) => r.status === 'running'),
  };
}

// House label per activity kind — the nouns the app already uses elsewhere, no new ones.
const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  training: 'training',
  caption: 'caption pass',
  decompose: 'decompose',
  generation: 'generation',
};

/** Plain-English label for an activity row's kind. */
export function activityKindLabel(kind: ActivityKind): string {
  return ACTIVITY_KIND_LABEL[kind];
}

/** The label for one activity row: its server-supplied `modusLabel` if present, else the
 *  house noun for its kind. */
export function activityRowLabel(row: ActivityRow): string {
  return row.modusLabel ?? ACTIVITY_KIND_LABEL[row.kind];
}

/**
 * The door for one activity row: where it leads, by kind —
 *   training   -> the shelf (the model lands there; no per-model deep link exists yet)
 *   caption    -> the captionset view on its dataset
 *   decompose  -> the dataset's garden
 *   generation -> its produced media, when trivially resolvable
 *
 * Every case requires the door field(s) it needs; missing them returns `undefined` so a
 * door-less row renders without a link rather than a dead one — never guess a target.
 */
export function activityDoorHref(row: Pick<ActivityRow, 'kind' | 'door'>): string | undefined {
  const door = row.door;
  if (!door) return undefined;
  switch (row.kind) {
    case 'training':
      return door.modelId ? '/models' : undefined;
    case 'caption':
      return door.datasetId && door.captionsetId
        ? `/datasets/${encodeURIComponent(door.datasetId)}/caption?captionset=${encodeURIComponent(door.captionsetId)}`
        : undefined;
    case 'decompose':
      return door.datasetId ? `/datasets/${encodeURIComponent(door.datasetId)}/muse` : undefined;
    case 'generation':
      return door.mediaUrl || undefined;
    default:
      return undefined;
  }
}

/** Link text for `activityDoorHref`'s target, per kind — matches where the door leads. */
export function activityDoorLabel(kind: ActivityKind): string {
  switch (kind) {
    case 'training':
      return 'view models';
    case 'caption':
      return 'view captions';
    case 'decompose':
      return 'view cutting floor';
    default:
      return 'view media';
  }
}
