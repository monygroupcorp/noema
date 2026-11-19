# muse-walk — the populated, mobile-390 muse walk

A narrower, sharper companion to `walk.ts` and a sibling of `collection-walk.ts`: just the
muse routes (`/datasets/:id/muse`, `/datasets/:id/muse/sessions`), at 390×844 only, against a
local fixture server instead of a real backend — built for `noema/muse-is-the-jewel`, which asks
for a mobile-390 walk of muse reviewed against Instagram, with the chrome standing between the
viewer and the picture named element by element.

## Why a fixture, not `walk.ts` against `WALK_BASE_URL`

`walk.ts`'s one fixture id per route (`walk.config.ts`) resolves against whatever
`API_ORIGIN`/staging happens to hold for `sample-dataset` — usually nothing, so the muse route
there captures an empty floor and an empty grid: the one state that cannot answer "is the
picture the interface", because there is no picture. This walker is the `collection-walk.ts`
pattern applied to muse: a fixture server (`muse-fixture-server.ts`) answering the client's own
`/v1/flows`, `/v1/data/datasets/*`, `/v1/data/muse/sessions/*`, `/v1/models`, `/v1/runs/*`
shapes from canned data (`muse-fixtures.ts`) — a floor with live and disabled fragments, a
nozzle carrying a model, eight settled pieces and one still generating.

## Pieces (new files; nothing existing here was rewritten)

- `muse-fixtures.ts` — one dataset, one session: 11 fragments across most categories (one
  held off the draw, so the floor's own disabled-chip state has something real to show), a
  nozzle stack of one LoRA, nine pieces (eight settled with a reaction/save mixed in, one
  still generating), typed against `../src/lib/api` directly.
- `muse-fixture-server.ts` — a plain `node:http` server. Every read is canned except
  `GET /v1/runs/:id/stream`: a real SSE endpoint, because the stageline chrome this walk exists
  to name only renders for a run that has not reached terminal — a canned "complete" JSON can't
  produce that frame. Every settled run streams one snapshot (already complete) and closes; the
  still-generating run streams a snapshot (pending) then a `progress` frame and stays open, so
  whatever moment the walk screenshots still finds that tile mid-generation.
- `muse-walk.ts` — boots the fixture server, boots its own `vite` dev server instance with
  `API_ORIGIN` pointed at it, then screenshots: the resting screen, the launch banner expanded
  (it folds to one row by default — noema-286 — and the floor/nozzle controls only exist in the
  unfolded DOM), the cutting-floor sheet open (chips), the nozzle sheet open, and the sessions
  list. Every shot is taken twice — `*-fold.png` at the bare 390×844 viewport (what a thumb sees
  before it scrolls) and `*.png` full-page (grown to the content's own scroll height, like
  `walk.ts`) — because "is the picture the interface" is a first-fold question first.

## Running it

```
npx tsx walk/muse-walk.ts                  capture into shots/<run=muse>/, report/<run=muse>/
npx tsx walk/muse-walk.ts --run before      a named run (this goal's before/after pack)

npm run walk:review -- before               contact sheet (existing instrument, unmodified)
npm run walk:review -- before after          what changed → report/after/diff-from-before.html
```

Own ports throughout — `MUSE_WALK_VITE_PORT` (default 5186) and `MUSE_FIXTURE_PORT` (default
4186) — distinct from `vite.config.ts`'s own default (5174) and from `collection-walk.ts`'s own
(5185/4185), so any of the three can run alongside the others without clobbering a dev server.

## What this walk is not

It does not drive a real fire, a real steer, a real save or a real promote — every session
write the fixture server answers to is canned, the same canned session handed back regardless
of the body sent. It exists to photograph the populated resting screen and its two sheets, not
to exercise the mutation paths `walk.ts`/the hermetic test suite already cover.
