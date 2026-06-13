/**
 * generate-note.mjs — create a fresh anonymous note before the on-chain deposit.
 *
 * Run this FIRST. It gives you:
 *   1. The commitment to pass to payAnonymous(bytes32 commitment) on-chain
 *   2. The secret + nullifier to save locally — these are the ONLY way to spend the note
 *
 * Usage:
 *   node scripts/generate-note.mjs
 *
 * Then:
 *   1. Call payAnonymous(<commitment>) with your chosen ETH amount
 *   2. Wait for the webhook to insert the leaf (poll /arcanum/tree/leaf/<commitment>)
 *   3. node scripts/mint-purse.mjs <nullifier> <secret> staging
 */

import { buildPoseidon } from 'circomlibjs'
import { randomBytes } from 'crypto'

const poseidon = await buildPoseidon()
const F = poseidon.F

function randomFieldElement() {
  // Sample a random 31-byte value — safely below the BN128 field prime
  return BigInt('0x' + randomBytes(31).toString('hex'))
}

function fieldToHex(f) {
  return '0x' + F.toObject(f).toString(16).padStart(64, '0')
}

const nullifier = randomFieldElement()
const secret    = randomFieldElement()

const commitmentF   = poseidon([nullifier, secret])
const nullifierHashF = poseidon([nullifier])

const commitment    = fieldToHex(commitmentF)
const nullifierHex  = '0x' + nullifier.toString(16).padStart(64, '0')
const secretHex     = '0x' + secret.toString(16).padStart(64, '0')
const nullifierHash = fieldToHex(nullifierHashF)

console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║           ARCANUM NOTE — SAVE THIS BEFORE DEPOSITING         ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log('')
console.log('Commitment (pass this to payAnonymous on-chain):')
console.log(' ', commitment)
console.log('')
console.log('Nullifier (keep secret — needed to spend):')
console.log(' ', nullifierHex)
console.log('')
console.log('Secret (keep secret — needed to spend):')
console.log(' ', secretHex)
console.log('')
console.log('NullifierHash (what gets recorded when spent):')
console.log(' ', nullifierHash)
console.log('')
console.log('─────────────────────────────────────────────────────────────')
console.log('NEXT STEPS:')
console.log('  1. Send ETH to the CreditVault via payAnonymous(<commitment>)')
console.log('     Contract: 0x00000001152D633eb2AC3Cf91eac9994aEEFc021')
console.log('  2. Wait for the leaf to appear:')
console.log(`     curl https://staging.noema.art/arcanum/tree/leaf/${commitment}`)
console.log('  3. Mint your purse:')
console.log(`     node scripts/mint-purse.mjs ${nullifierHex} ${secretHex} staging`)
console.log('─────────────────────────────────────────────────────────────')
console.log('')
console.log('WARNING: If you lose the nullifier and secret, the deposited ETH')
console.log('is unrecoverable. There is no account, no support, no backup.')
