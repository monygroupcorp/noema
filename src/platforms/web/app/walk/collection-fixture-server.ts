// walk/collection-fixture-server.ts — a local, in-memory stand-in for the `/v1` surface the
// collection screens read, typed against the client's own `../src/lib/api` contract so a drift
// in the real endpoint shapes fails this file at compile time rather than quietly serving a
// stale fixture.
//
// Plain `node:http` — no new dependency, the same choice `walk/review.ts` makes for its own
// pixel diff. Every response is canned from collection-fixtures.ts; nothing here reaches a
// database, a queue or the network. `collection-walk.ts` points the vite dev server's existing
// `API_ORIGIN` proxy at this server's `http://127.0.0.1:<port>`, so every `/v1/*` call the app
// makes resolves locally — the one property clause 1 asks for.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Editio } from '../src/lib/editio';
import {
  COLLECTIONS, COLLECTIONS_LIST, PIECES, RARITY, FLOWS, EDITIONS, mediaSvg,
} from './collection-fixtures.ts';

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

let editionSeq = 0;

/** Every publish this fixture answers settles instantly, already `published` — there is no
 *  worker to poll for, and the walk only needs the screen each outcome produces, not the wait
 *  between them. */
function publishImmediately(body: { artifact?: { kind: string; id: string }; destination: string }): Editio {
  editionSeq += 1;
  const id = `fx-edition-${editionSeq}`;
  const now = new Date().toISOString();
  const externalRef = body.destination === 'gallery'
    ? `/v1/media/gallery-${id}-baseuri`
    : `/v1/media/archive-${id}.zip`;
  const edition: Editio = {
    id,
    artifact: { kind: (body.artifact?.kind ?? 'collectio') as Editio['artifact']['kind'], id: body.artifact?.id ?? '' },
    destination: body.destination,
    visibility: body.destination === 'gallery' ? 'marketplace' : 'private',
    custody: 'ours',
    status: 'published',
    externalRef,
    createdAt: now,
    updatedAt: now,
  };
  const forCollection = EDITIONS[edition.artifact.id] ?? (EDITIONS[edition.artifact.id] = []);
  forCollection.push(edition);
  return edition;
}

export function startFixtureServer(port: number): Promise<{ close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    (async () => {
      const url = new URL(req.url ?? '/', 'http://fixture.local');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      // GET /v1/collectiones — the list screen.
      if (method === 'GET' && path === '/v1/collectiones') {
        return send(res, 200, { collections: COLLECTIONS_LIST });
      }

      // GET /v1/media/:name.svg — same-origin placeholder art for every piece this fixture
      // owns; also answers the archive/gallery "download ready" links with a stand-in file.
      const mediaMatch = /^\/v1\/media\/([^/]+?)\.svg$/.exec(path);
      if (method === 'GET' && mediaMatch) return sendSvg(res, mediaSvg(mediaMatch[1]));
      if (method === 'GET' && path.startsWith('/v1/media/')) {
        return send(res, 200, { note: 'fixture file — not a real download', path });
      }

      // GET /v1/flows — the garden's base-flow picker.
      if (method === 'GET' && path === '/v1/flows') return send(res, 200, { flows: FLOWS });

      // GET /v1/editiones?artifact=collectio:<id> — this collection's own publications.
      if (method === 'GET' && path === '/v1/editiones') {
        const artifact = url.searchParams.get('artifact') ?? '';
        const id = artifact.split(':')[1] ?? '';
        return send(res, 200, { editions: EDITIONS[id] ?? [] });
      }

      // POST /v1/editiones — publish (export-to-you / publish-to-hosting). Settles instantly.
      if (method === 'POST' && path === '/v1/editiones') {
        const body = await readBody(req) as { artifact?: { kind: string; id: string }; destination: string };
        return send(res, 200, { edition: publishImmediately(body) });
      }

      const collMatch = /^\/v1\/collectiones\/([^/]+)(\/.*)?$/.exec(path);
      if (collMatch) {
        const id = collMatch[1];
        const sub = collMatch[2] ?? '';
        const collection = COLLECTIONS[id];

        if (method === 'GET' && sub === '') {
          if (!collection) return send(res, 404, { error: 'not_found.collection' });
          return send(res, 200, { collection });
        }
        if (method === 'GET' && sub === '/rarity') {
          return send(res, 200, { rarity: RARITY[id] ?? { totalPieces: 0, axes: [] } });
        }
        if (method === 'GET' && sub === '/pieces') {
          const review = url.searchParams.get('review') ?? 'pending';
          const all = PIECES[id] ?? [];
          const pieces = review === 'all' ? all : all.filter((p) => p.review === review);
          return send(res, 200, { pieces });
        }
      }

      // Everything else (getMe, mePartner, admin reads, …) answers 404. Every caller in this
      // app treats a failed best-effort read as absence, not as a crash — Rail.tsx and
      // Account.tsx both `.catch(() => {})` their getMe()/mePartner() probes — so a screen
      // this walk visits renders the same as it would for a brand-new, unprivileged account.
      send(res, 404, { error: 'not_found.fixture', path, method });
    })().catch((err) => {
      send(res, 500, { error: 'fixture_server_error', message: (err as Error).message });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.COLLECTION_FIXTURE_PORT ?? '4185');
  startFixtureServer(port).then(() => {
    console.log(`collection fixture server — http://127.0.0.1:${port} (no request it answers leaves this box)`);
  });
}
