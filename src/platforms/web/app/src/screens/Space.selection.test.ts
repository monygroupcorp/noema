import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredSelection, persistSelection, readStoredSelection, selectionKey, type SelSphere } from './Space';

// No jsdom/@testing-library/react in this app's toolchain (see Shelf.test.ts) — this
// exercises the pure localStorage round-trip for space-selection persistence (noema-331)
// with a minimal in-memory stub (see api.purse.test.ts), not a full render.

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', localStorageStub);
});

const sphere = (mode: SelSphere['mode']): SelSphere => ({ x: 1, y: 2, z: 3, r: 0.03, mode });

describe('space selection persistence — namespaced localStorage round-trip', () => {
  it('restores exactly what was written, for the same scope and layer', () => {
    const spheres = [sphere('inc'), sphere('exc')];
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'text', spheres }));
    expect(loadStoredSelection('anima_1', 'text')).toEqual(spheres);
  });

  it('ignores a stored set carved on a different layer, without deleting it', () => {
    const spheres = [sphere('inc')];
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'text', spheres }));
    expect(loadStoredSelection('anima_1', 'image')).toEqual([]);
    // still there for a switch back to the layer it was carved in
    expect(loadStoredSelection('anima_1', 'text')).toEqual(spheres);
  });

  it('never bleeds one account/anon scope into another', () => {
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'text', spheres: [sphere('inc')] }));
    expect(loadStoredSelection('anon', 'text')).toEqual([]);
  });

  it('restores to empty on garbage JSON, never throws', () => {
    localStorage.setItem(selectionKey('anima_1'), '{not json');
    expect(() => loadStoredSelection('anima_1', 'text')).not.toThrow();
    expect(loadStoredSelection('anima_1', 'text')).toEqual([]);
  });

  it('restores to empty when the stored shape is malformed (missing spheres array)', () => {
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'text' }));
    expect(loadStoredSelection('anima_1', 'text')).toEqual([]);
  });

  it('restores to empty with nothing stored at all', () => {
    expect(loadStoredSelection('anima_1', 'text')).toEqual([]);
  });
});

// The persist effect in Space.tsx writes when a selection is held and removes when it is not.
// "Not held" used to include "standing on a different layer than the one it was carved in",
// which is how arriving at the screen destroyed a set nobody had touched — the loss reported
// after a training failed was this, on the way back from looking at the run, not the training.
// These fix the RULE the component applies; the loader above was always innocent.
describe('space selection persistence — an untouched selection survives', () => {
  it('standing on another layer does not delete the set, so it is there on the way back', () => {
    const spheres = [sphere('inc')];
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'image', spheres }));
    // mount on 'text': the image set reads as empty, and the write-through runs with []
    persistSelection('anima_1', 'text', loadStoredSelection('anima_1', 'text'));
    expect(readStoredSelection('anima_1')).toEqual({ layer: 'image', spheres });
    expect(loadStoredSelection('anima_1', 'image')).toEqual(spheres);
  });

  it('the layer that owns the set still clears it when the user empties it', () => {
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'text', spheres: [sphere('inc')] }));
    persistSelection('anima_1', 'text', []);
    expect(readStoredSelection('anima_1')).toBeNull();
  });

  it('a held selection is written under the layer it is carved in', () => {
    const spheres = [sphere('inc'), sphere('exc')];
    persistSelection('anima_1', 'image', spheres);
    expect(readStoredSelection('anima_1')).toEqual({ layer: 'image', spheres });
  });

  it('an empty screen with nothing stored stays empty and throws nothing', () => {
    expect(() => persistSelection('anima_1', 'text', [])).not.toThrow();
    expect(readStoredSelection('anima_1')).toBeNull();
  });
});

describe('readStoredSelection — the entry as written', () => {
  it('reports the layer a set was carved in, so a mount can land there', () => {
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'image', spheres: [sphere('inc')] }));
    expect(readStoredSelection('anima_1')?.layer).toBe('image');
  });

  it('is null for garbage, a bad layer, or nothing at all — never a throw', () => {
    expect(readStoredSelection('anima_1')).toBeNull();
    localStorage.setItem(selectionKey('anima_1'), '{not json');
    expect(readStoredSelection('anima_1')).toBeNull();
    localStorage.setItem(selectionKey('anima_1'), JSON.stringify({ layer: 'sideways', spheres: [] }));
    expect(readStoredSelection('anima_1')).toBeNull();
  });
});
