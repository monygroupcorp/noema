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
  + mobile (390x844) screenshots into `shots/<route>/`, and an axe WCAG 2.1/2.2 A+AA scan
  appended to `report/axe.json`. `npm run walk -- --list` enumerates the planned shots without
  touching a target. `npm run walk` runs the real walk against `WALK_BASE_URL`.

`shots/` and `report/` are gitignored — regenerated output, not committed baselines. No
`toHaveScreenshot` baselines are committed by this item: prod is several PRs behind the next
deploy cut, so a baseline cut now would bake a stale build.

## Running it

```
WALK_BASE_URL=http://localhost:5173 \
WALK_EMAIL=<username> WALK_PASSWORD=<password> \
npm run walk
```

`WALK_BASE_URL` can point at a local dev server, staging, or prod — the harness doesn't care.
`WALK_EMAIL`/`WALK_PASSWORD` are optional: without them the walk still runs, as an anonymous
session (many screens work anon; auth-gated ones capture whatever the anon/redirect state
renders, which is a real observation, not a failure). The fleet's own account for this is
`an internal account` (credential file `an internal path`); as of this item's build that
credential is expired — rotating it gates the first *live* run against a real target, not this
build.

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
