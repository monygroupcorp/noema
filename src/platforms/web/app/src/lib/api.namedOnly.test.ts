import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reads only a named account can answer — GET /v1/me/partner, GET /v1/me/partner-request and
// GET /v1/teams — are not issued when there is no session. The anonymous commitment path has no
// animaId, so the server can only ever refuse them (404 / 404 / 403), and the shell probes the
// partner record on every app route; a sessionless visit printed two failed requests in the
// console for a question whose answer was already known. The client now settles those with the
// same typed rejection the server would have sent, and no fetch happens. With a session the
// request goes out exactly as before, carrying the bearer.
//
// No jsdom in this app's toolchain (see api.purse.test.ts): a minimal in-memory localStorage
// and a fetch spy stand in for the browser.

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
  new Response(JSON.stringify({ teams: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  store.clear();
  fetchSpy.mockClear();
  vi.stubGlobal('localStorage', localStorageStub);
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// Fresh module each test so its localStorage-backed session reads observe the stub above.
async function loadApi() {
  return import('./api');
}

function signIn() {
  store.set('noema-sessions', JSON.stringify({
    accounts: [{ animaId: 'anima_1', token: 'tok_1', username: 'u', expiresAt: Date.now() + 600_000 }],
    activeAnimaId: 'anima_1',
  }));
}

describe('named-account-only reads without a session', () => {
  it('mePartner rejects with the server\'s 404 shape and issues no request', async () => {
    const { api, ApiRequestError } = await loadApi();
    const err = await api.mePartner().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'not_found.partner' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mePartnerRequest rejects with the server\'s 404 shape and issues no request', async () => {
    const { api, ApiRequestError } = await loadApi();
    const err = await api.mePartnerRequest().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'not_found.partner_request' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('listTeams rejects with the server\'s 403 shape and issues no request', async () => {
    const { api, ApiRequestError } = await loadApi();
    const err = await api.listTeams().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 403, code: 'auth.forbidden' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('named-account-only reads with a session', () => {
  it('mePartner goes to the wire with the bearer, as before', async () => {
    signIn();
    const { api } = await loadApi();
    await api.mePartner();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/v1/me/partner');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok_1');
  });

  it('listTeams goes to the wire with the bearer, as before', async () => {
    signIn();
    const { api } = await loadApi();
    const r = await api.listTeams();
    expect(r).toEqual({ teams: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/v1/teams');
  });
});
