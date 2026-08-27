// =============================================================================
// depositStatusParity — the deposit-status enum can't drift from DepositumStatus.
// =============================================================================
//
// Two independent guards, both required for this test to catch a drift:
//
//  1. COMPILE-TIME (typecheck:tests): `DEPOSITUM_STATUS_MEMBERS` below is typed as
//     `Record<DepositumStatus, true>`. TypeScript's excess-property and missing-key
//     checks mean this literal must name every member of the union and no others —
//     add a state to `DepositumStatus` in src/types/catena.ts without updating this
//     file, and typecheck fails here first.
//
//  2. RUNTIME (this test): reads the `status` enum straight off the `GET /deposit/mine`
//     route's response schema in `API_CONTRACT` and asserts its member set is exactly
//     `Object.keys(DEPOSITUM_STATUS_MEMBERS)` — so the contract's own enum can't drift
//     from the (compile-time-verified) status set either.
//
// Together: a state added to DepositumStatus and forgotten in the contract enum fails
// (2); a state added to DepositumStatus and forgotten in this file's member record
// fails (1). Neither guard alone catches both directions.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DepositumStatus } from '../../../../src/types/catena.js'
import { API_CONTRACT } from '../../../../src/allocutio/api/apiContract.js'

// Compile-time exhaustiveness: TypeScript rejects this object if it is missing a
// DepositumStatus member, or names one that doesn't exist.
const DEPOSITUM_STATUS_MEMBERS: Record<DepositumStatus, true> = {
  detectum: true,
  confirmatum: true,
  processatum: true,
  praesolutum: true,
  fractum: true,
}

test("the /deposit/mine response's status enum has exactly DepositumStatus's members", () => {
  const route = API_CONTRACT.routes.find(
    (r) => r.method === 'GET' && r.path === '/deposit/mine',
  )
  assert.ok(route, 'GET /deposit/mine is not declared in API_CONTRACT — the route was renamed or removed')

  const statusEnum = route!.response?.properties?.deposits?.items?.properties?.status?.enum
  assert.ok(
    statusEnum,
    "GET /deposit/mine's response schema no longer carries deposits[].status.enum — the shape changed",
  )

  assert.deepEqual(
    [...statusEnum!].sort(),
    Object.keys(DEPOSITUM_STATUS_MEMBERS).sort(),
    'the apiContract deposit-status enum and DepositumStatus have diverged — add the new state to both ' +
      'the enum in apiContract.ts and DEPOSITUM_STATUS_MEMBERS in this file, then run `npm run gen:api-docs`',
  )
})
