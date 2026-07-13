import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// noema-041: getRun was a bare fetch with no auth headers — a structural 401 for the
// owner-scoped `GET /v1/runs/:id` route (apiRouter.ts). Must send the same readHeaders()
// every other authed read call uses: bearer if signed in, else the anon commitment.
//
// No jsdom in this app's toolchain (see runStream.test.ts), so we stand up a minimal
// in-memory localStorage and a fetch spy, same pattern as api.purse.test.ts.

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

let lastHeaders: Record<string, string> = {};
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  lastHeaders = (init?.headers as Record<string, string>) ?? {};
  return new Response(JSON.stringify({ run: { id: 'run_1', status: 'running', modusId: 'm' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

beforeEach(() => {
  store.clear();
  lastHeaders = {};
  vi.stubGlobal('localStorage', localStorageStub);
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadApi() {
  return import('./api');
}

describe('getRun — sends readHeaders (bearer or anon commitment), never a bare fetch', () => {
  it('signed in: bearer header, no x-commitment', async () => {
    const { api, upsertAccount } = await loadApi();
    upsertAccount({ animaId: 'anima_1', token: 'jwt-secret-token' });

    await api.getRun('run_1');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(lastHeaders.authorization).toBe('Bearer jwt-secret-token');
    expect(lastHeaders['x-commitment']).toBeUndefined();
  });

  it('anonymous: x-commitment header, no authorization', async () => {
    const { api } = await loadApi();

    await api.getRun('run_1');

    expect(lastHeaders['x-commitment']).toBeDefined();
    expect(lastHeaders.authorization).toBeUndefined();
  });
});
