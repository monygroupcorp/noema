import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredSelection, selectionKey, type SelSphere } from './Space';

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
