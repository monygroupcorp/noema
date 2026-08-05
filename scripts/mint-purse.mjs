/**
 * mint-purse.mjs — generate a ZK spend proof and mint an anonymous credit purse.
 *
 * Usage:
 *   node scripts/mint-purse.mjs <nullifier> <secret> [staging|prod]
 *
 * Where nullifier and secret are the hex field elements you used when calling
 * payAnonymous(commitment) on-chain. commitment = Poseidon(nullifier, secret).
 *
 * Example:
 *   node scripts/mint-purse.mjs 0xabc...123 0xdef...456 staging
 */

import * as snarkjs from 'snarkjs'
import { buildPoseidon } from 'circomlibjs'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = join(__dirname, '../src/arcanum/circuit/artifacts')

const [,, nullifierHex, secretHex, env = 'staging'] = process.argv
if (!nullifierHex || !secretHex) {
  console.error('Usage: node scripts/mint-purse.mjs <nullifier_hex> <secret_hex> [staging|prod]')
  process.exit(1)
}

const BASE_URL = env === 'prod'
  ? 'https://noema.art'
  : 'https://staging.noema.art'

console.log(`\nTarget: ${BASE_URL}`)
console.log(`Nullifier: ${nullifierHex}`)
console.log(`Secret:    ${secretHex}\n`)

const poseidon = await buildPoseidon()
const F = poseidon.F

function toFieldElement(hex) {
  return BigInt(hex.startsWith('0x') ? hex : '0x' + hex)
}

function fieldToHex(f) {
  return '0x' + F.toObject(f).toString(16).padStart(64, '0')
}

const nullifier = toFieldElement(nullifierHex)
const secret    = toFieldElement(secretHex)

// 1. Derive commitment = Poseidon(nullifier, secret)
const commitmentF   = poseidon([nullifier, secret])
const commitment    = fieldToHex(commitmentF)
console.log('Commitment:', commitment)

// 2. Fetch the leaf from staging to get leafIndex + valor
console.log('\n[1/4] Fetching leaf from tree...')
const leafRes = await fetch(`${BASE_URL}/arcanum/tree/leaf/${commitment}`)
if (!leafRes.ok) {
  const body = await leafRes.text()
  console.error(`Leaf not found (${leafRes.status}): ${body}`)
  process.exit(1)
}
const { leaf } = await leafRes.json()
console.log('Leaf:', JSON.stringify(leaf, null, 2))
const leafIndex = leaf.leafIndex
const valor     = BigInt(leaf.valor)

// 3. Fetch current root + Merkle path
console.log('\n[2/4] Fetching Merkle proof...')
const proofRes = await fetch(`${BASE_URL}/arcanum/tree/proof/${leafIndex}`)
if (!proofRes.ok) {
  console.error(`Could not fetch proof: ${await proofRes.text()}`)
  process.exit(1)
}
const { proof: merklePath } = await proofRes.json()
console.log(`Root: ${merklePath.root}`)
console.log(`Leaf index: ${leafIndex}, path depth: ${merklePath.pathElements.length}`)

// 4. Derive nullifierHash = Poseidon(nullifier)
const nullifierHashF = poseidon([nullifier])
const nullifierHash  = fieldToHex(nullifierHashF)
console.log('\nNullifierHash:', nullifierHash)

// 5. Build circuit inputs
// recipient = 0 for purse mint (not bound to a specific execution)
const input = {
  nullifier:    nullifier.toString(),
  secret:       secret.toString(),
  pathElements: merklePath.pathElements.map(e => BigInt(e).toString()),
  pathIndices:  merklePath.pathIndices.map(Number),
  root:         BigInt(merklePath.root).toString(),
  nullifierHash: BigInt(nullifierHash).toString(),
  valor:        valor.toString(),
  recipient:    '0',
}

// 6. Generate Groth16 proof
console.log('\n[3/4] Generating Groth16 proof (this takes ~10s)...')
const wasmPath = join(ARTIFACTS, 'arcanum.wasm')
const zkeyPath = join(ARTIFACTS, 'arcanum_final.zkey')

const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath)

console.log('Proof generated.')
console.log('Public signals:', publicSignals)

// 7. POST to /arcanum/purse
console.log('\n[4/4] Minting purse...')
const mintRes = await fetch(`${BASE_URL}/arcanum/purse`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    arcanumProof: {
      proof,
      publicSignals: {
        root:          publicSignals[0],
        nullifierHash: publicSignals[1],
        valor:         publicSignals[2],
        recipient:     publicSignals[3],
      },
    },
  }),
})

const mintBody = await mintRes.json()
if (!mintRes.ok) {
  console.error(`Purse mint failed (${mintRes.status}):`, mintBody)
  process.exit(1)
}

console.log('\n✓ Purse minted!')
console.log('Token:  ', mintBody.token)
console.log('Credits:', mintBody.credits)
console.log('\nStore this token — it is your anonymous credit purse. Not recoverable.')
