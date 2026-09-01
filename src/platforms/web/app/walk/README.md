# route walk — the instrument substrate

A route census + Playwright screenshot harness over every web route, with an `@axe-core`
accessibility scan riding along. Phase 1 of the UX-instruments stack: screenshots feed visual
regression (future baselines) and an LLM-critique pass (Phase 2); axe findings are advisory here.

## Pieces

- `routes.ts` — the census. Parses `src/App.tsx`'s route table at run time (never hand-copied),
  substitutes fixture ids from `walk.config.ts` for parameterized routes, and fails loudly if a
  parameterized route has no fixture. `npx tsx walk/routes.ts` prints it standalone — static, no
  server or network needed.
- `walk.config.ts` — the one hand-maintained file: fixture ids for `:param` segments.
- `walk.ts` — the walker. Signs in (best-effort, see below), then per route: desktop (1280x800)
  + mobile (390x844) screenshots into `shots/<run>/<route>/`, and an axe WCAG 2.1/2.2 A+AA scan
  written to `report/<run>/axe.json` beside a `manifest.json`. `npm run walk -- --list`
  enumerates the planned shots without touching a target.
- `review.ts` — how a person looks at the result. One run builds a contact sheet of every shot;
  two runs build a diff, every shot compared pixel for pixel and sorted by how much moved.

## Runs

Captures are named, because the point of photographing every route is comparing two sets of
photographs. A run writes a manifest recording the commit, the target, whether it was signed in,
every shot's size, and any route it could not reach — so a set of pictures stays attributable to
the build that produced it. A baseline nobody can trace to a revision is a folder of screenshots,
not evidence.

```
npm run walk -- --run baseline           # capture, named
npm run walk:review -- baseline          # contact sheet → report/baseline/index.html
npm run walk:review -- baseline redesign # what changed → report/redesign/diff-from-baseline.html
```

The diff renders a mask per shot (changed pixels lit) and reports the ratio, plus any change in
page height. Images of unlike size are compared on the union canvas, so a page that got taller
counts the new region as changed — which it is.

The comparison runs in the browser Playwright already provides rather than pulling in an image
library; this codebase avoids new npm dependencies where a platform primitive will do.

`shots/` and `report/` are gitignored — regenerated output, never committed. Baselines live on
the machine that cut them and are re-cut from a named revision when needed, so nothing here goes
stale in the repository.

## Running it

```
WALK_BASE_URL=http://localhost:5173 \
WALK_EMAIL=<username> WALK_PASSWORD=<password> \
npm run walk -- --run baseline
```

Point the dev server at production data with `API_ORIGIN=https://noema.art npm run dev` if the
capture should show a populated app rather than staging's near-empty one.

`WALK_BASE_URL` can point at a local dev server, staging, or prod — the harness doesn't care.
`WALK_EMAIL`/`WALK_PASSWORD` are optional: without them the walk still runs, as an anonymous
session (many screens work anon; auth-gated ones capture whatever the anon/redirect state
renders, which is a real observation, not a failure).

The login session is cached to a gitignored `walk/.storage-state.json` local to the machine
running the walk; delete it to force a fresh sign-in.

## Known ceiling

`@axe-core` catches roughly 30-57% of WCAG issues by independent estimates — it's a floor, not a
certificate. A green `report/axe.json` is a statement about axe's rule set, never "the app is
accessible." Manual review and the future LLM-critique pass (Phase 2) cover what axe can't.

## Portability

The only App.tsx-specific code is the `extractFromAppTsx` function inside `routes.ts`. Porting
this harness to another repo means swapping that one function for an adapter reading that repo's
route table — the fixtures file, the CLI, and the walker itself are generic.
