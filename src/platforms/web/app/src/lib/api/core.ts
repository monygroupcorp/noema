// Generic `/v1` HTTP plumbing shared by every concern module under lib/api/: response
// parsing, the read-timeout guarantee, and the fetch-based SSE reader. Platform-neutral —
// nothing here knows about any one route.

import { getSession } from './session';

/**
 * Read a response as the API's JSON, or throw an error written for a person.
 *
 * The body is read ONCE, as text — it can only be consumed once, and it is not always JSON. A
 * proxy 502, an Express 404 for a route this build does not serve, and the SPA index served for
 * an API path all answer HTML. Quoting that at the user put a whole error document on the
 * screen; letting JSON.parse throw put "Unexpected token '<'" there instead. Neither is a
 * sentence anybody can act on, and both were reaching real screens.
 *
 * What the user gets is the API's own message when there is one, and a short honest line about
 * the status when there is not. What a developer gets is everything: `status`, `code`, and the
 * raw body on the error object and in the console.
 */
async function readApiJson<T>(res: Response): Promise<T> {
  const raw = await res.text().catch(() => '');
  let parsed: unknown;
  let parsedOk = false;
  if (raw) { try { parsed = JSON.parse(raw); parsedOk = true; } catch { parsedOk = false; } }

  if (!res.ok) {
    const e = parsedOk ? (parsed as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })?.error : undefined;
    throw reportable(new ApiRequestError(
      e?.code ?? `http.${res.status}`,
      e?.message ?? statusLine(res),
      res.status,
      e?.details,
      raw,
    ));
  }
  // A 2xx that is not JSON is the transport answering for the API — the SPA index, a captive
  // portal, a proxy error page with an optimistic status.
  if (!parsedOk) {
    throw reportable(new ApiRequestError('transport.not_json', statusLine(res, true), res.status, undefined, raw));
  }
  return parsed as T;
}

/** A sentence about the status, for when the body carried no message of its own. */
function statusLine(res: Response, notJson = false): string {
  if (notJson) return 'The server did not answer with data. It may be mid-deploy — try again in a moment.';
  if (res.status === 404) return 'That is not here.';
  if (res.status === 401 || res.status === 403) return 'You are not signed in, or not allowed to see this.';
  if (res.status >= 500) return 'The server had a problem. It is not something you did.';
  return res.statusText || `The server answered ${res.status}.`;
}

/** The raw body never reaches the screen, and never stops reaching the console. */
function reportable(err: ApiRequestError): ApiRequestError {
  try { console.debug('[api]', err.status, err.code, err.body ?? ''); } catch { /* no console */ }
  return err;
}

export async function j<T>(res: Response): Promise<T> {
  return readApiJson<T>(res);
}

// A read only a named account can answer. The anonymous commitment path carries no animaId,
// so the server has nothing to look up and can only refuse: GET /v1/me/partner answers 404
// (no partner record can exist) and GET /v1/teams answers 403 (teams require an identified
// account). Asking anyway printed a failed request in the console on every app route, because
// the shell probes the partner record on mount. The question is settled here instead, with
// the same typed rejection the server would have sent, and no request is issued. A caller's
// catch branch therefore sees exactly what it saw before; only the network round-trip is gone.
export function namedOnly<T>(refusal: { status: number; code: string; message: string }, read: () => Promise<T>): Promise<T> {
  if (getSession()) return read();
  return Promise.reject(new ApiRequestError(refusal.code, refusal.message, refusal.status));
}

// ── Deadline for a read a screen is blocked on ─────────────────────────────
// `fetch` has no timeout of its own. A request the network accepts and then never answers —
// a socket a proxy holds open, a server that stops mid-response — leaves its promise pending
// for as long as the tab lives. A screen that shows "Loading…" until that promise settles has
// no error to print and no way out; it just sits there. That is the last door to the run
// screen's "Loading… and nothing else", and unlike the others it cannot be closed at the
// screen, because the screen never learns anything went wrong.
//
// So the deadline lives with the read: the request is aborted, and the silence becomes a
// rejection carrying a sentence a person can act on. Reads only — a write must not be
// retried on a guess about whether it landed.
export const READ_TIMEOUT_MS = 20_000;
export const READ_TIMEOUT_MESSAGE = 'the server did not answer — reload to try again';

export async function withReadTimeout<T>(
  read: (signal: AbortSignal) => Promise<T>,
  ms: number = READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  // The deadline RACES the read rather than waiting for the abort to come back through it.
  // Aborting alone would leave the guarantee resting on the read honouring the signal, which
  // is the same bet — a read that ignores it hangs exactly as long as one with no deadline at
  // all. So the abort frees the socket and the rejection settles the caller, independently.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(READ_TIMEOUT_MESSAGE));
    }, ms);
  });
  try {
    return await Promise.race([read(controller.signal), deadline]);
  } catch (err) {
    // When the read loses the race it usually rejects first, with a DOMException whose message
    // names neither the request nor anything the reader can do about it. Report the deadline.
    if (controller.signal.aborted) throw new Error(READ_TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timer!);
  }
}

// ── Fetch-based SSE reader ─────────────────────────────────────────────────
// EventSource can't send auth headers, so authed SSE routes need a hand-rolled
// reader over `fetch` + a `ReadableStream`. Surfaces the minimal shape callers
// (useRunStream) need: a message callback and a way to close. The server emits
// plain `data: <json>\n\n` frames (no `event:` field) — see RunEventHub.
export interface SseHandle {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
  close: () => void;
}

export function sseStream(url: string, headers: Record<string, string>): SseHandle {
  const handle: SseHandle = { onmessage: null, onerror: null, close: () => {} };
  const controller = new AbortController();
  let closed = false;
  handle.close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
  };

  (async () => {
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`sse http ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (data) handle.onmessage?.({ data });
        }
      }
      if (!closed) throw new Error('sse stream ended');
    } catch (err) {
      if (closed) return; // intentional close (e.g. AbortError) — not a failure
      handle.onerror?.(err);
    }
  })();

  return handle;
}

// Generic `/v1` request errors — the wire shape every non-auth route throws on 4xx/5xx
// (`{ error: { code, message, details? } }`, see allocutio/api/errors.ts ApiError). Carries
// `details` (e.g. Tabula publish's `{ code, vinculumId }`) so screens can branch on the
// specific failure, not just the HTTP status.
export class ApiRequestError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  /** The response body as it arrived. For the console and for a bug report — never rendered. */
  body?: string;
  constructor(code: string, message: string, status: number, details?: Record<string, unknown>, body?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.body = body;
  }
}
// jApi and j ask the same question and now answer it the same way. jApi was already the right
// shape — it read the structured error and never quoted the body — but only eighteen call sites
// used it against a hundred and twenty-three on the naive one.
export async function jApi<T>(res: Response): Promise<T> {
  return readApiJson<T>(res);
}
