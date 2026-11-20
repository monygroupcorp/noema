// The setup survives a reload (noema-287): the flow, the run shape, the nozzle stack and
// the standing affix live on the session, server-side, hydrated on mount. HYDRATING IS NOT
// FIRING — everything here is a pure read.

import type { ModelCard, MuseNozzleEntry, MuseSessionView, MuseSetup } from '../api';
import {
  loraChoiceOf,
  loraStack,
  loraWeight,
  type AffixInput,
  type LoraChoice,
  type NozzleInput,
} from './nozzle';
import type { StreamConfig } from './launch';

// ── The setup survives a reload (noema-287) ─────────────────────────────────
//
// A session's PIECES come back and, until this item, its SETUP did not: the flow, the
// run shape, the nozzle stack and the standing affix were plain screen state with
// hardcoded initials, so a reload returned the user to a session with its work intact
// and its engine reset to defaults.
//
// IT LIVES ON THE SESSION, SERVER-SIDE, hydrated on mount — the shape this screen
// already uses for the floor. The alternative is a browser store, and it is wrong here
// for the reason the floor is not in one: a session is a durable, owner-scoped,
// resumable record, so a setup held in one browser would disagree with the session the
// moment it was opened anywhere else. `src/crystal/muse/session.ts` carries the setup
// as a field of the PURE session value rather than of the persistence envelope, whose
// four fields are declared not to change.
//
// TWO RULES MAKE IT SAFE, and both are gated below.
//
//   HYDRATING IS NOT FIRING. Everything here is a pure read: no function in this
//   section makes a request, prices anything, or produces a run. A restored setup
//   leaves the screen exactly where choosing it by hand leaves it — armed, priced by
//   the ordinary quote path, and spending nothing until launch is pressed.
//
//   A MODEL THAT IS NO LONGER THERE IS NAMED, NOT DROPPED. A stored stack can cite a
//   model that has been deleted, or a private one the catalog no longer offers.
//   `resolveNozzle` resolves the stack against the catalog and hands back what it could
//   not restore, by name, so the screen can say it. Firing under fewer models than the
//   line claims is a wrong image at full price.
//
// The infinite-mode acknowledgement is not persisted and is not restored: it is consent
// for one sitting, and there is no field for it anywhere on this path.

/** The run shape a fresh configuration starts on, and the one a session with no stored
 *  setup comes back to. */
export const DEFAULT_STREAM_CONFIG: StreamConfig = { mode: 'batched', cap: 12, acknowledged: false };

/** The screen state a setup is written from and restored into. */
export interface SetupState {
  modusId: string | null;
  config: StreamConfig;
  nozzle: NozzleInput;
  affix?: AffixInput | null;
}

/**
 * The setup as it is sent to the session.
 *
 * `acknowledged` IS NOT WRITTEN, and it is not an omission that a later reader should
 * tidy up: an infinite-mode acknowledgement is consent for the sitting that gave it, so
 * a stored one would come back on the next mount and let a reload arrive already
 * agreed to a run that has no count to stop it. The wire type has no field for it and
 * the server's normalizer has none either — this is the first of the three places that
 * refuse it.
 *
 * Non-vacuity: writing the acknowledgement must fail "a restored session comes back
 * UNACKNOWLEDGED".
 */
export function setupOf(state: SetupState): MuseSetup {
  const stack = loraStack(state.nozzle);
  const prefix = (state.affix?.prefix ?? '').trim();
  const suffix = (state.affix?.suffix ?? '').trim();
  return {
    ...(state.modusId ? { modusId: state.modusId } : {}),
    mode: state.config.mode,
    cap: Math.max(1, Math.trunc(state.config.cap)),
    ...(stack.length > 0
      ? {
          nozzle: stack.map((choice) => {
            const weight = loraWeight(choice.weight);
            return {
              intellaId: choice.intellaId,
              nomen: choice.nomen,
              trigger: choice.trigger,
              ...(weight == null ? {} : { weight }),
            };
          }),
        }
      : {}),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

/** A setup read back off a session. The stack is still UNRESOLVED — it is a list of
 *  stored entries until `resolveNozzle` matches it against the catalog. */
export interface RestoredSetup {
  modusId: string | null;
  config: StreamConfig;
  nozzle: MuseNozzleEntry[];
  affix: AffixInput;
}

/**
 * The setup a resumed session comes back with.
 *
 * A PURE READ. It takes a session view and returns screen state: it makes no request,
 * asks for no price, and cannot start the stream loop — restoring a setup is free, and
 * the launch control is still the only thing that spends.
 *
 * `acknowledged` is forced to `false` here whatever the session carries. The field is
 * not written (`setupOf`), has no place in the wire type, and is dropped by the
 * server's normalizer — this is the last of the three refusals, and it is the one that
 * holds even for a session written before those existed.
 *
 * Non-vacuity: returning a stored acknowledgement must fail "a restored session comes
 * back UNACKNOWLEDGED"; making a request from here must fail "hydrating fires no run
 * and no quote".
 */
export function hydrateSetup(view: MuseSessionView | null | undefined): RestoredSetup {
  const setup = (view?.setup ?? {}) as MuseSetup & { acknowledged?: unknown };
  const cap = typeof setup.cap === 'number' && Number.isFinite(setup.cap)
    ? Math.max(1, Math.trunc(setup.cap))
    : DEFAULT_STREAM_CONFIG.cap;
  return {
    modusId: setup.modusId ?? null,
    config: {
      mode: setup.mode === 'infinite' ? 'infinite' : 'batched',
      cap,
      // Consent for one sitting. Never restored, whatever arrives.
      acknowledged: false,
    },
    nozzle: [...(setup.nozzle ?? [])],
    affix: {
      ...(setup.prefix ? { prefix: setup.prefix } : {}),
      ...(setup.suffix ? { suffix: setup.suffix } : {}),
    },
  };
}

/** A restored stack, and what could not be restored. */
export interface ResolvedNozzle {
  /** The entries that resolved against the live catalog, in their stored order. */
  stack: LoraChoice[];
  /** The names of the entries that did not, in their stored order. */
  missing: string[];
}

/**
 * A stored stack resolved against the catalog that is actually on offer.
 *
 * EVERY ENTRY IS RE-RESOLVED, never trusted as stored. A stack is stored with the
 * model's id, name and trigger word, and any of the three can go stale: the model may
 * have been deleted, made private, or re-triggered since. The card the catalog offers
 * now is the one that fires, so the restored choice is built from that card and the
 * stored entry contributes only its weight and its position.
 *
 * The `familia` scope is checked here for the same reason `chooseLora` checks it: a
 * LoRA trained on another base is a paid run that cannot work, and a restored stack
 * must not be a way around a refusal the picker enforces.
 *
 * AN ENTRY THAT DOES NOT RESOLVE IS RETURNED BY NAME, NOT DROPPED. Silently firing
 * under fewer models than the stored line claims is a wrong image at full price, every
 * piece, with nothing on screen saying so.
 *
 * Non-vacuity: dropping the unresolved entries instead of returning them must fail "a
 * restored stack naming a model that is gone SAYS SO".
 */
export function resolveNozzle(
  entries: readonly MuseNozzleEntry[] | null | undefined,
  offer: readonly ModelCard[],
  familia: string | null | undefined,
): ResolvedNozzle {
  const stack: LoraChoice[] = [];
  const missing: string[] = [];
  const byId = new Map<string, ModelCard>();
  for (const card of offer) byId.set(card.intellaId, card);

  for (const entry of entries ?? []) {
    const card = byId.get(entry.intellaId);
    const choice = card ? loraChoiceOf(card) : null;
    if (!card || !choice || !familia || card.basis !== familia) {
      missing.push(entry.nomen || entry.intellaId);
      continue;
    }
    stack.push({ ...choice, weight: loraWeight(entry.weight ?? null) });
  }
  return { stack, missing };
}

/** What the screen says about the entries a resume could not put back, or `null` when
 *  every entry came back. Named plainly: the user is about to fire under a stack that
 *  is shorter than the one they left, and the price does not go down with it. */
export function missingNozzleNote(missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  const names = missing.join(', ');
  return missing.length === 1
    ? `${names} is no longer available on this workflow — it is NOT on the nozzle, and pieces will fire without it`
    : `${names} are no longer available on this workflow — they are NOT on the nozzle, and pieces will fire without them`;
}

