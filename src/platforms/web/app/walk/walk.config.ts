// walk/walk.config.ts — the ONE hand-maintained artifact in the route walk harness.
//
// Fixture ids for every parameterized route. `walk/routes.ts` FAILS LOUDLY (throws) when it
// finds a route with a `:param` that has no entry here — a silently-skipped route reads as
// coverage that isn't there. When a new parameterized route lands in
// `App.tsx`, add its fixture here or the census (and the walk) refuse to run.
//
// Keys are the route's path TEMPLATE exactly as written in `App.tsx` (e.g. "/datasets/:id"),
// not a resolved path. Values map each param name in that template to a placeholder id — these
// do not need to resolve against a real backend record; unauthenticated/empty-state renders are
// still valid screenshot input for visual regression and the axe pass.

export const fixtures: Record<string, Record<string, string>> = {
  '/datasets/:id': { id: 'sample-dataset' },
  '/datasets/:id/caption': { id: 'sample-dataset' },
  '/datasets/:id/derive': { id: 'sample-dataset' },
  '/datasets/:id/muse': { id: 'sample-dataset' },
  '/datasets/:id/muse/sessions': { id: 'sample-dataset' },
  '/train/run/:id': { id: 'sample-run' },
  '/collections/:id': { id: 'sample-collection' },
  '/collections/:id/garden': { id: 'sample-collection' },
  '/collections/:id/rules': { id: 'sample-collection' },
  '/collections/:id/run': { id: 'sample-collection' },
  '/collections/:id/curation': { id: 'sample-collection' },
  '/collections/:id/export': { id: 'sample-collection' },
  '/projects/:id': { id: 'sample-project' },
  '/account/:section': { section: 'profile' },
};
