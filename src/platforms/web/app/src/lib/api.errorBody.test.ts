import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from './api';

// Transport wreckage used to reach the screen two ways. `j()` interpolated the whole response
// body into the Error message, so a collection screen printed
//   404 {"error":{"code":"not_found.collection","message":"Collection 'x' not found"}}
// and a route a build did not serve printed Express's entire HTML 404 page. And a 2xx that was
// not JSON — the SPA index served for an API path — let JSON.parse throw its own words at the
// user: "Unexpected token '<', "<!doctype "... is not valid JSON", on the wallet screen.
//
// No jsdom in this app's toolchain (see api.purse.test.ts), so this stubs fetch and drives the
// real client.

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const answers = (body: string, status: number, type = 'application/json') => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } })));
};

const EXPRESS_404 = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /v1/data/muse/sessions</pre>\n</body>\n</html>\n';

async function caught(fn: () => Promise<unknown>): Promise<ApiRequestError> {
  try { await fn(); } catch (e) { return e as ApiRequestError; }
  throw new Error('expected a rejection');
}

describe('a failed call never puts the response body on the screen', () => {
  it('shows the API its own message, not the JSON envelope around it', async () => {
    answers(JSON.stringify({ error: { code: 'not_found.collection', message: "Collection 'sample-collection' not found" } }), 404);
    const err = await caught(() => api.getCollection('sample-collection'));
    expect(err.message).toBe("Collection 'sample-collection' not found");
    expect(err.message).not.toContain('{');
    expect(err.message).not.toContain('404 ');
  });

  it('carries the code and status so a screen can branch instead of reading prose', async () => {
    answers(JSON.stringify({ error: { code: 'not_found.collection', message: 'nope' } }), 404);
    const err = await caught(() => api.getCollection('x'));
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe('not_found.collection');
    expect(err.status).toBe(404);
  });

  it('does not quote an HTML error document at the user', async () => {
    answers(EXPRESS_404, 404, 'text/html');
    const err = await caught(() => api.getCollection('x'));
    expect(err.message).not.toContain('<');
    expect(err.message).not.toContain('DOCTYPE');
    expect(err.message).toBe('That is not here.');
    expect(err.code).toBe('http.404');
  });

  it('keeps the raw body on the error for the console, just not in the message', async () => {
    answers(EXPRESS_404, 404, 'text/html');
    const err = await caught(() => api.getCollection('x'));
    expect(err.body).toContain('Cannot GET');
  });

  it('a 2xx that is not JSON is an honest sentence, not a parser exception', async () => {
    answers('<!doctype html><html><body>app shell</body></html>', 200, 'text/html');
    const err = await caught(() => api.getCollection('x'));
    expect(err.message).not.toMatch(/Unexpected token/i);
    expect(err.message).not.toMatch(/is not valid JSON/i);
    expect(err.code).toBe('transport.not_json');
    expect(err.status).toBe(200);
  });

  it('a 500 with no body blames the server, not the reader', async () => {
    answers('', 500);
    const err = await caught(() => api.getCollection('x'));
    expect(err.message).toBe('The server had a problem. It is not something you did.');
  });

  it('still parses a good answer', async () => {
    answers(JSON.stringify({ collection: { id: 'c1' } }), 200);
    await expect(api.getCollection('c1')).resolves.toEqual({ collection: { id: 'c1' } });
  });
});
