# collection-walk — the populated collection walk

A narrower, sharper companion to `walk.ts` (not touched by this — the live review seat is using
it): just the 7 collection screens (`/collections` through `/collections/:id/export`), against a
local fixture server instead of a real backend.

## Why this exists, not just another `walk.ts --only` run

`walk.ts` walks the whole app against `WALK_BASE_URL`/`API_ORIGIN`, which defaults to
`https://staging.noema.art` (`vite.config.ts`'s own proxy default) unless overridden — so a plain
`npm run walk` sends real requests off the box, and every parameterized route gets exactly one
fixture id (`walk.config.ts`) that has to already exist, as whatever it happens to be, on
whatever `API_ORIGIN` answers. Nobody has ever pointed it at a collection that is actually
mid-run, in every lifecycle state, so no review round has seen the editio spine (garden → rules →
run → curation → export) populated — and the hosting/gallery export, the path that produces the
ERC-721 tokenURIs an NFT mint needs, has never been screenshotted at all.

## Pieces (new files; nothing existing here was rewritten)

- `collection-fixtures.ts` — three canned `Collection`s (draft / in-flight / finished), their
  pieces, rarity report and flow list, typed against `../src/lib/api` and `../src/lib/editio`
  directly — a shape those modules no longer send fails this file at compile time.
- `collection-fixture-server.ts` — a plain `node:http` server answering the client's own
  `/v1/collectiones`, `/v1/flows`, `/v1/editiones`, `/v1/media/*` calls from that canned data.
  No database, no queue, no network beyond `127.0.0.1`.
- `collection-walk.ts` — boots the fixture server, boots its own `vite` dev server instance with
  `API_ORIGIN` pointed at the fixture (so every `/v1`/`/api` request the app makes resolves
  locally), then screenshots all 7 screens across the three fixture collections, at both
  viewports. "Export" is captured as the transition the export screen itself makes once
  published — the walk actually clicks "Prepare download" and "Publish to hosting" rather than
  inventing a fourth pre-published fixture no screen would ever produce on its own.

## Running it

```
npx tsx walk/collection-walk.ts                  # capture into shots/collection/, report/collection/
npx tsx walk/collection-walk.ts --run baseline    # a named run, like walk.ts's own --run

npm run walk:review -- collection                 # contact sheet (existing instrument, unmodified)
npm run walk:critique -- collection                # CRIT pack (existing instrument, unmodified)
```

Own ports throughout — `COLLECTION_WALK_VITE_PORT` (default 5185) and `COLLECTION_FIXTURE_PORT`
(default 4185), both overridable — distinct from `vite.config.ts`'s own default (5174), so this
can run alongside another seat's `walk.ts` session without either clobbering the other's dev
server.

## What "populated" means here

- **draft** (`fx-draft`) — a named, undirected collection: a base flow and trait grid already
  authored (garden/rules screens with real axes, not an empty state), nothing fired yet.
- **in-flight** (`fx-inflight`) — mid-run: pieces arriving, some approved, some rerolled, six
  genuinely awaiting a verdict in curation.
- **finished** (`fx-finished`) — every piece settled; the export screen's choice of destination
  is still live, so both halves of it get walked: "export to you" (archive ZIP) and "publish to
  hosting" (public ERC-721 tokenURIs) are each actually clicked, producing the ready-to-download
  and ready-to-mint panels respectively.

Every piece's media is an inline SVG served from `/v1/media/<id>.svg` by the fixture server
itself — same-origin, generated on request, never a real image host.
