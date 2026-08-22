// Ambient declaration for `supertest`, which ships no type declarations of its own.
// Same treatment `src/types/vendor.d.ts` gives the other untyped dependencies, applied on
// the test side so the tests typecheck can resolve the import.
//
// Placement: the tests typecheck's `include` currently reaches the first tranche only, so this
// file lives inside it. When a later tranche widens that `include`, it can move to a shared
// tests-level types directory.
//
// Follow-on: replacing this shim with `@types/supertest` gives the request/response chain real
// types. That is a dependency addition (package.json + lockfile) and is its own change.
declare module 'supertest'
