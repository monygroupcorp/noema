// walk/muse-fixture-server.ts — a local, in-memory stand-in for the `/v1` surface the muse
// screens read, typed against the client's own `../src/lib/api` contract (same convention as
// `collection-fixture-server.ts`, not touched by this) so a drift in the real endpoint shapes
// fails this file at compile time rather than quietly serving a stale fixture.
//
// Plain `node:http` — no new dependency. Every response is canned from `muse-fixtures.ts`;
// nothing here reaches a database, staging or production. `muse-walk.ts` points the vite dev
// server's own `API_ORIGIN` proxy at `http://127.0.0.1:<port>`, so every `/v1/*` request the
// app makes resolves locally.
//
// The one piece of live behaviour: `GET /v1/runs/:id/stream` is a real SSE endpoint, not a
// canned read, because the stageline chrome this walk exists to name only renders for a piece
// whose run has not reached terminal — a canned "complete" response can't produce that frame.
// Every settled piece's run streams one `snapshot` (already complete) and closes; the one
// still-generating piece streams a `snapshot` (pending) then a `progress` frame and stays
// open, so the tile it belongs to is captured mid-generation, same as a real one would be.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  DATASET, DATASET_ID, SESSION, SESSION_ID, FLOWS, FLOW_DESCRIPTION, FLOW_ID, MODELS, RUNS,
  RUNNING_RUN_ID, mediaSvg,
} from './muse-fixtures.ts';
import type { MuseSessionView } from '../src/lib/api';

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendSvg(res: ServerResponse, svg: string): void {
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-length': Buffer.byteLength(svg) });
  res.end(svg);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

// Every session write in this fixture answers with the SAME canned session rather than
// actually folding the write in — the walk only ever reads this screen in its populated
// resting state, never round-trips a mutation back through it. `session()` returns a fresh
// copy so nothing a caller does to the response object leaks between requests.
function session(): MuseSessionView {
  return structuredClone(SESSION);
}

function sseFrame(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function streamRun(req: IncomingMessage, res: ServerResponse, runId: string): void {
  const run = RUNS[runId];
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  if (!run) { sseFrame(res, { kind: 'failed', status: 'failed' }); res.end(); return; }

  if (runId !== RUNNING_RUN_ID) {
    // Already settled — one snapshot, already complete, then the stream ends. The real
    // server would keep the connection open until the client disconnects; ending it here
    // is simpler and the client treats a closed stream with no further terminal the same
    // way either way (it already applied the complete snapshot).
    sseFrame(res, { kind: 'snapshot', run });
    res.end();
    return;
  }

  // The still-generating piece: pending now, executing shortly after — and the connection
  // stays open, so whatever moment the walk screenshots still finds it mid-generation.
  sseFrame(res, { kind: 'snapshot', run });
  const timer = setTimeout(() => {
    sseFrame(res, {
      kind: 'progress',
      progressus: {
        phase: 'executing',
        target: 'fx-pod-1',
        message: 'sampling',
        progress: { done: 14, total: 28, unit: 'steps' },
      },
    });
  }, 300);
  req.on('close', () => clearTimeout(timer));
}

export function startFixtureServer(port: number): Promise<{ close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    (async () => {
      const url = new URL(req.url ?? '/', 'http://fixture.local');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/v1/flows') return send(res, 200, { flows: FLOWS });
      if (method === 'GET' && path === `/v1/flows/${FLOW_ID}`) return send(res, 200, FLOW_DESCRIPTION);

      const mediaMatch = /^\/v1\/media\/([^/]+?)\.svg$/.exec(path);
      if (method === 'GET' && mediaMatch) return sendSvg(res, mediaSvg(mediaMatch[1]));

      if (method === 'GET' && path === '/v1/data/datasets/full') {
        return send(res, 200, { datasets: [DATASET] });
      }
      if (method === 'GET' && path === `/v1/data/datasets/${DATASET_ID}`) {
        return send(res, 200, { dataset: DATASET });
      }

      if (method === 'GET' && path === '/v1/data/muse/sessions') {
        return send(res, 200, { sessions: [SESSION] });
      }
      if (method === 'POST' && path === '/v1/data/muse/sessions') {
        return send(res, 200, { session: session() });
      }
      const sessionSubMatch = /^\/v1\/data\/muse\/sessions\/([^/]+)(\/.*)?$/.exec(path);
      if (sessionSubMatch && sessionSubMatch[1] === SESSION_ID) {
        const sub = sessionSubMatch[2] ?? '';
        if (method === 'GET' && sub === '') return send(res, 200, { session: session() });
        if (sub === '/steer') {
          await readBody(req);
          return send(res, 200, { proposal: { eliminations: [], additions: [], dropped: 0 } });
        }
        if (sub.startsWith('/pieces/') && sub.endsWith('/save')) {
          return send(res, 200, { session: session() });
        }
        const pieceMatch = /^\/pieces\/([^/]+)$/.exec(sub);
        if (pieceMatch && method === 'PATCH') { await readBody(req); return send(res, 200, { session: session() }); }
        if (sub === '/pieces' && method === 'POST') { await readBody(req); return send(res, 200, { session: session() }); }
        if (sub === '/promote' && method === 'POST') {
          await readBody(req);
          return send(res, 404, { error: 'not_found.fixture', note: 'promotion is out of scope for this walk' });
        }
        // /setup, /floor/enabled, /floor/weight, /floor/fragments, /kept — every other
        // session write this screen can make, all answered the same canned way.
        if (method === 'PATCH' || method === 'POST') { await readBody(req); return send(res, 200, { session: session() }); }
      }

      if (method === 'GET' && path === '/v1/models') {
        const basis = url.searchParams.get('basis');
        const models = basis ? MODELS.filter((m) => m.basis === basis) : MODELS;
        return send(res, 200, { models });
      }
      if (method === 'GET' && path === '/v1/me/models') return send(res, 200, { models: MODELS });

      if (method === 'GET' && path === '/v1/me/status') {
        return send(res, 200, {
          balanceImpetus: '240.00', balanceUsd: 24, gens: [], studios: [], joinable: [],
          takenAt: new Date().toISOString(),
        });
      }

      if (method === 'POST' && path === '/v1/runs/quote') {
        await readBody(req);
        return send(res, 200, { impetus: '1.00' });
      }

      const runMatch = /^\/v1\/runs\/([^/]+)(\/stream)?$/.exec(path);
      if (runMatch && method === 'GET') {
        const runId = runMatch[1]!;
        if (runMatch[2]) return streamRun(req, res, runId);
        const run = RUNS[runId];
        if (!run) return send(res, 404, { error: 'not_found.run' });
        return send(res, 200, { run });
      }

      // Everything else (getMe, mePartner, admin reads, …) answers 404 — every caller in
      // this app treats a failed best-effort read as absence, not as a crash, the same
      // property `collection-fixture-server.ts` relies on.
      send(res, 404, { error: 'not_found.fixture', path, method });
    })().catch((err) => {
      send(res, 500, { error: 'fixture_server_error', message: (err as Error).message });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.MUSE_FIXTURE_PORT ?? '4186');
  startFixtureServer(port).then(() => {
    console.log(`muse fixture server — http://127.0.0.1:${port} (no request it answers leaves this box)`);
  });
}
