#!/usr/bin/env npx tsx
/**
 * ceremony-finalize.ts — cap the Arcanum ceremony and export the real keys.
 *
 * The contributions are already folded together (each zkey builds on the last), so
 * "finalizing" is not recombining secrets — it's taking the FINAL contribution off the
 * live sequencer and capping it with a public random beacon that nobody controls. The
 * output is the trustless proving/verification key pair, not a secret anyone holds.
 *
 * Usage:
 *   npm run ceremony:finalize                       # against https://staging.noema.art
 *   npm run ceremony:finalize -- https://noema.art   # against a specific host
 *
 * What it does:
 *   1. Reads GET /v1/ceremony (must be `open`) and captures the head hash + chain length.
 *   2. Downloads GET /v1/ceremony/current.zkey — the last contribution — and checks its
 *      sha256 matches the published head.
 *   3. Runs scripts/arcanum-trusted-setup.sh --finalize on it, which applies the beacon,
 *      exports verification_key.json, and verifies the final key.
 *   4. Prints the final proving-key hash and the exact CEREMONY_FINALIZE=… line to set.
 *
 * After this you: commit verification_key.json (server auto-loads it → real ZK spend
 * verification), host arcanum_final.zkey for clients (ARCANUM_ZKEY_URL), and set
 * CEREMONY_FINALIZE=<hash> + restart so the page shows the ceremony as complete.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const HOST = (process.argv[2] || process.env.CEREMONY_HOST || 'https://staging.noema.art').replace(/\/$/, '')
const ART = path.resolve('src/arcanum/circuit/artifacts')
const CAPTURED = path.join(ART, 'arcanum_last_contribution.zkey')
const FINAL = path.join(ART, 'arcanum_final.zkey')
const VKEY = path.join(ART, 'verification_key.json')

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const die = (msg: string): never => { console.error(`\n✗ ${msg}\n`); process.exit(1) }

async function main() {
  console.log(`Finalizing the Arcanum ceremony from ${HOST}\n`)

  // 1 — status
  const status = await fetch(`${HOST}/v1/ceremony`).then((r) => r.json()).catch(() => null)
  if (!status) die(`could not reach ${HOST}/v1/ceremony`)
  if (status.phase !== 'open') die(`ceremony is '${status.phase}', not 'open' — nothing to finalize`)
  if (!status.chain?.length) die('the chain is empty — no contributions to finalize')
  const head: string = status.headHash
  console.log(`  chain: ${status.chain.length} contribution(s), head ${head.slice(0, 16)}…`)

  // 2 — capture the head (the last contribution)
  const res = await fetch(`${HOST}/v1/ceremony/current.zkey`)
  if (!res.ok) die(`current.zkey → ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const got = sha256(bytes)
  if (got !== head) die(`downloaded head hash ${got.slice(0, 16)}… != published ${head.slice(0, 16)}…`)
  writeFileSync(CAPTURED, bytes)
  console.log(`  captured ${bytes.length} bytes → ${path.relative(process.cwd(), CAPTURED)}\n`)

  // 3 — beacon + export (reuse the existing coordinator script)
  console.log('  applying public random beacon (scripts/arcanum-trusted-setup.sh --finalize)…\n')
  execFileSync('bash', ['scripts/arcanum-trusted-setup.sh', '--finalize', CAPTURED], { stdio: 'inherit' })

  if (!existsSync(FINAL)) die(`expected ${FINAL} after finalize — check the script output above`)
  const finalHash = sha256(readFileSync(FINAL))

  // 4 — the paste-ready next steps
  console.log('\n' + '─'.repeat(64))
  console.log('✓ Ceremony finalized. Final proving-key hash:\n')
  console.log(`    ${finalHash}\n`)
  console.log('Next steps:')
  console.log(`  1. Commit ${path.relative(process.cwd(), VKEY)} — the server auto-loads it`)
  console.log('     and turns on real ZK spend verification.')
  console.log(`  2. Host ${path.relative(process.cwd(), FINAL)} for clients and set ARCANUM_ZKEY_URL.`)
  console.log('  3. Flip the ceremony page to "complete" — set this in the env and restart:\n')
  console.log(`    CEREMONY_FINALIZE=${finalHash}\n`)
  console.log('─'.repeat(64))
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
