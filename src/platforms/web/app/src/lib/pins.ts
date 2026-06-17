// Pinned flows — the favourites the user keeps in the rail's Cards slot.
// localStorage-backed with a tiny pub/sub so the Rail updates the moment a Card
// toggles a pin (same tab via a custom event, other tabs via `storage`).
import { useSyncExternalStore } from 'react';

export interface Pin { id: string; name: string }

const KEY = 'noema-pins';
const EVT = 'noema-pins-change';

export function getPins(): Pin[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function isPinned(id: string): boolean {
  return getPins().some((p) => p.id === id);
}

/** Toggle a flow's pin. Returns true if it is now pinned, false if removed. */
export function togglePin(pin: Pin): boolean {
  const pins = getPins();
  const i = pins.findIndex((p) => p.id === pin.id);
  if (i >= 0) pins.splice(i, 1);
  else pins.push({ id: pin.id, name: pin.name });
  localStorage.setItem(KEY, JSON.stringify(pins));
  window.dispatchEvent(new Event(EVT));
  return i < 0;
}

function subscribe(fn: () => void): () => void {
  window.addEventListener(EVT, fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener('storage', fn);
  };
}

// Cache the snapshot so useSyncExternalStore sees a stable reference between
// changes (getPins() parses fresh each call → would loop without this).
let snapshot: Pin[] = getPins();
function getSnapshot(): Pin[] {
  const next = getPins();
  if (next.length !== snapshot.length || next.some((p, i) => p.id !== snapshot[i]?.id)) snapshot = next;
  return snapshot;
}

/** Live list of pinned flows that re-renders on any pin change. */
export function usePins(): Pin[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
