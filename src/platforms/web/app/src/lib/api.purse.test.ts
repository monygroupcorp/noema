import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The anonymity-critical guard on the purse spend path (noema-034, gauntlet v3 finding):
// when a Vault purse is the active payer, `createRun` must send ONLY the bursa token —
// `{ content-type, x-bursa-token }` — and NEVER an identity header. A leaked
// `authorization` (session) or `x-commitment` (stable anon pseudonym) lets logs/proxies
// correlate an anonymous spend back to a person, which is the whole thing the note buys.
//
// No jsdom in this app's toolchain (see runStream.test.ts), so we stand up a minimal
// in-memory localStorage and a fetch spy that captures the outgoing request headers.

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
  return new Response(JSON.stringify({ run: { id: 'run_1' } }), {
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

// Fresh module each test so its localStorage-backed reads observe the stub above.
async function loadApi() {
  return import('./api');
}

const RUN_BODY = { modusId: 'm', verb: 'generate', aditus: {} } as never;
const PURSE = 'bursa_live_TESTTOKEN_abcdef';

describe('createRun — purse spend carries the bursa token and NO identity header', () => {
  it('active purse + signed in: only content-type + x-bursa-token (no authorization)', async () => {
    const { api, setActivePurse, upsertAccount } = await loadApi();
    upsertAccount({ animaId: 'anima_1', token: 'jwt-secret-token' });
    setActivePurse(PURSE);

    await api.createRun(RUN_BODY);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(lastHeaders['x-bursa-token']).toBe(PURSE);
    expect(lastHeaders['content-type']).toBe('application/json');
    expect(lastHeaders.authorization).toBeUndefined();
    expect(lastHeaders['x-commitment']).toBeUndefined();
    expect(Object.keys(lastHeaders).sort()).toEqual(['content-type', 'x-bursa-token']);
  });

  it('active purse + anonymous: still no x-commitment leaks alongside the token', async () => {
    const { api, setActivePurse } = await loadApi();
    setActivePurse(PURSE);

    await api.createRun(RUN_BODY);

    expect(lastHeaders['x-bursa-token']).toBe(PURSE);
    expect(lastHeaders.authorization).toBeUndefined();
    expect(lastHeaders['x-commitment']).toBeUndefined();
    expect(Object.keys(lastHeaders).sort()).toEqual(['content-type', 'x-bursa-token']);
  });

  it('no active purse + signed in: normal bearer identity, no x-bursa-token', async () => {
    const { api, setActivePurse, upsertAccount } = await loadApi();
    upsertAccount({ animaId: 'anima_1', token: 'jwt-secret-token' });
    setActivePurse(null);

    await api.createRun(RUN_BODY);

    expect(lastHeaders.authorization).toBe('Bearer jwt-secret-token');
    expect(lastHeaders['x-bursa-token']).toBeUndefined();
  });

  it('no active purse + anonymous: anon commitment header, no x-bursa-token', async () => {
    const { api } = await loadApi();

    await api.createRun(RUN_BODY);

    expect(lastHeaders['x-commitment']).toBeDefined();
    expect(lastHeaders.authorization).toBeUndefined();
    expect(lastHeaders['x-bursa-token']).toBeUndefined();
  });
});
