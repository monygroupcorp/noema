#!/usr/bin/env -S npx tsx
// =============================================================================
// gen-api-docs.ts — emit the committed API docs from the in-code contract.
// =============================================================================
//
// The ONE generator: reads `API_CONTRACT`, runs the pure docgen functions, and
// writes the two committed artifacts:
//
//   docs/api/openapi.json   — the OpenAPI 3.1 document (pretty JSON + newline)
//   docs/api/reference.md   — the readable markdown reference
//
// Run via `npm run gen:api-docs`. The CI drift-check re-runs this and fails the
// build if the committed copies are stale (`git diff --exit-code docs/api/`).
//
//     npx tsx scripts/gen-api-docs.ts
// =============================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { API_CONTRACT } from '../src/allocutio/api/apiContract.js'
import { generateOpenApi, generateReference } from '../src/allocutio/api/docgen.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const outDir = resolve(repoRoot, 'docs/api')

mkdirSync(outDir, { recursive: true })

const openApiPath = resolve(outDir, 'openapi.json')
const referencePath = resolve(outDir, 'reference.md')

// Pretty JSON + a single trailing newline (matches the drift-check's expectation).
const openApiJson = JSON.stringify(generateOpenApi(API_CONTRACT), null, 2) + '\n'
const reference = generateReference(API_CONTRACT)

writeFileSync(openApiPath, openApiJson)
writeFileSync(referencePath, reference)

console.log(`wrote ${openApiPath}`)
console.log(`wrote ${referencePath}`)
