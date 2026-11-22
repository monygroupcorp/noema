#!/usr/bin/env npx tsx
/**
 * ceremony-rehearsal.ts — run the whole contributor flow on a throwaway ceremony, at full
 * scale, against the real circuit, before asking anyone to contribute to a real one.
 *
 * The unit tests cover this flow with tiny synthetic zkeys, and the real-key test only
 * PROVES with the committed key. Neither walks the path a contributor's browser actually
 * walks: download a 5MB head, fold randomness into it, upload it, and have the sequencer
 * deep-verify it against arcanum.r1cs and the Hermez ptau. That is the part that is
 * expensive, that is slow, and that nobody wants to discover is broken after asking
 * friends to spend their evening on it. So run this first.
 *
 * The first contributor here is the page's own client module, imported and driven rather
 * than imitated, so "the browser path works" is something this script observes instead of
 * something a reader infers from a CLI invocation that resembles it.
 *
 * Usage:
 *   npm run ceremony:rehearse
 *
 * Requires the large artifacts the ceremony itself needs, in src/arcanum/circuit/artifacts:
 *   arcanum_0000.zkey   the Phase-2 root the chain starts from
 *   arcanum.r1cs        the compiled circuit
 *   pot20_final.ptau    the Hermez Phase-1 output (~1.2GB)
 * All three come from scripts/arcanum-trusted-setup.sh --init. Without the ptau the
 * sequencer accepts contributions WITHOUT deep verification, and this script fails rather
 * than reporting a pass it did not earn.
 *
 * Nothing here touches a live ceremony, the deployed site, or the committed proving key:
 * the store is in memory, custody is a temp dir, and every artifact it writes is deleted.
 * Exits 0 only if every check passed.
 */

import http from 'node:http'
import express from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { mountCeremony, ceremonyCustodyDir } from '../src/api/arcanum/mountCeremony.js'
import { createArcanumRouter, REPO_ZKEY_PATH } from '../src/api/arcanum/arcanumRouter.js'
import { MemoryCeremoniaStore } from '../src/arcanum/CeremoniaStore.js'
import { LocalZkeyCustody } from '../src/arcanum/CeremoniaCustody.js'
import { createProvingKeySource } from '../src/arcanum/ProvingKeySource.js'
import type { ArcanumIssuer } from '../src/ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../src/arcanum/ArcanumTree.js'

const REPO = process.cwd()
const ARTIFACTS = path.join(REPO, 'src/arcanum/circuit/artifacts')
const SNARKJS = path.join(REPO, 'node_modules/.bin/snarkjs')
const ROOT_ZKEY = path.join(ARTIFACTS, 'arcanum_0000.zkey')
const R1CS = path.join(ARTIFACTS, 'arcanum.r1cs')
const PTAU = process.env.ARCANUM_PTAU_PATH ?? path.join(ARTIFACTS, 'pot20_final.ptau')
const WASM = path.join(ARTIFACTS, 'arcanum.wasm')

let failures = 0
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const ok = (s: string): void => console.log(`  \x1b[32mPASS\x1b[0m ${s}`)
const bad = (s: string): void => { console.log(`  \x1b[31mFAIL\x1b[0m ${s}`); failures++ }
const step = (s: string): void => console.log(`\n\x1b[1m${s}\x1b[0m`)
const secs = (t: number): string => `${((Date.now() - t) / 1000).toFixed(1)}s`

function snarkjs(args: string[]): void {
  execFileSync(SNARKJS, args, { stdio: 'pipe', maxBuffer: 1 << 28 })
}

interface Contributor { name: string; cookie?: string }

async function main(): Promise<void> {
  for (const [what, where] of [['root zkey', ROOT_ZKEY], ['r1cs', R1CS], ['ptau', PTAU], ['wasm', WASM]]) {
    if (!existsSync(where)) {
      console.error(`missing ${what}: ${where}\nRun scripts/arcanum-trusted-setup.sh --init first.`)
      process.exit(2)
    }
  }
  const work = mkdtempSync(path.join(tmpdir(), 'ceremony-rehearsal-'))

  // Boot the sequencer exactly as index.ts does, on a throwaway store and custody dir.
  process.env.CEREMONY_ZKEY_DIR = path.join(work, 'custody')
  process.env.ARCANUM_PTAU_PATH = PTAU
  process.env.CEREMONY_OPEN = '1'
  delete process.env.CEREMONY_FINALIZE
  delete process.env.CEREMONY_FINAL_ZKEY

  const store = new MemoryCeremoniaStore()
  const app = express()
  await mountCeremony(app, store)
  const custody = new LocalZkeyCustody(ceremonyCustodyDir())
  app.use('/arcanum', createArcanumRouter(
    {} as unknown as ArcanumIssuer,
    {} as unknown as ArcanumTreeStore,
    {
      anonPurseEnabled: false,
      provingKey: createProvingKeySource({ store, custody, repoZkeyPath: REPO_ZKEY_PATH }),
    },
  ))
  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  // The web client addresses its own origin with root-relative URLs, because in a tab that
  // is what the site is. Point those at this server so the client can be driven here
  // unmodified — the whole value of running it is that it is not a copy of itself.
  // node's fetch keeps no cookie jar either, so the session cookie the sequencer sets is
  // caught on the way past; step 3 needs it to prove a second contribution is refused.
  const realFetch = globalThis.fetch
  let lastSetCookie: string | null = null
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? base + input : input
    const r = await realFetch(url, init)
    const sc = r.headers.get('set-cookie')
    if (sc) lastSetCookie = sc.split(';')[0]
    return r
  }) as typeof fetch
  const { ceremony: webClient } = await import('../src/platforms/web/app/src/lib/ceremony.js')

  const status = async (): Promise<Record<string, unknown>> =>
    (await fetch(`${base}/v1/ceremony`)).json() as Promise<Record<string, unknown>>

  /** GET current.zkey — what the page hands a contributor to build on. */
  async function fetchHead(): Promise<{ bytes: Buffer; hash: string }> {
    const r = await fetch(`${base}/v1/ceremony/current.zkey`)
    if (!r.ok) throw new Error(`current.zkey answered ${r.status}`)
    return { bytes: Buffer.from(await r.arrayBuffer()), hash: String(r.headers.get('x-zkey-hash')) }
  }

  /** The in-browser half: fold fresh randomness into the head. */
  function contributeTo(headBytes: Buffer, name: string): Buffer {
    const inFile = path.join(work, `in-${name}.zkey`)
    const outFile = path.join(work, `out-${name}.zkey`)
    writeFileSync(inFile, headBytes)
    snarkjs(['zkey', 'contribute', inFile, outFile, `--name=${name}`, `-e=${randomBytes(32).toString('hex')}`])
    return readFileSync(outFile)
  }

  /** POST the result back, exactly as the page does. */
  async function upload(bytes: Buffer, basedOn: string, c: Contributor): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-based-on': basedOn,
      'x-contributor-name': c.name,
    }
    if (c.cookie) headers.cookie = c.cookie
    const r = await fetch(`${base}/v1/ceremony/contributions`,
      { method: 'POST', headers, body: new Uint8Array(bytes) })
    const setCookie = r.headers.get('set-cookie')
    if (setCookie && !c.cookie) c.cookie = setCookie.split(';')[0]
    return r
  }

  const errorOf = async (r: Response): Promise<string> =>
    (await r.json() as { error?: string }).error ?? '(no error field)'

  try {
    step('1. the ceremony opens from the Phase-2 root')
    const s0 = await status()
    const root = sha(readFileSync(ROOT_ZKEY))
    console.log(`  root  ${s0.rootHash}\n  phase ${s0.phase}`)
    s0.phase === 'open' ? ok('phase is open') : bad(`phase is ${String(s0.phase)}`)
    s0.rootHash === root ? ok('rootHash is arcanum_0000.zkey') : bad('rootHash is not the root zkey')

    // Two contributors, two roads to the same sequencer. The first is the contributor's
    // own code — src/platforms/web/app/src/lib/ceremony.ts, the module their tab loads —
    // driven here unmodified. It folds entropy in through snarkjs's in-memory API, on
    // buffers, which is a different path through snarkjs than the CLI takes on files; a
    // rehearsal that only ever shells out to the CLI leaves the code a friend actually
    // runs untested, and that is the code whose failure costs them their evening. The
    // second keeps the CLI road, because step 3 needs bytes in hand to build the refusals
    // out of, and because the two roads landing the same chain is itself worth seeing.
    const contributors: Contributor[] = [{ name: 'rehearsal-one' }, { name: 'rehearsal-two' }]

    step('2.1 rehearsal-one contributes through the web client the page loads')
    {
      const c = contributors[0]
      const t0 = Date.now()
      const before = await fetchHead()
      let landed: Record<string, unknown> | null = null
      try {
        landed = await webClient.contribute({
          name: c.name,
          entropy: randomBytes(32).toString('hex'),
          onPhase: (p) => console.log(`  client: ${p}`),
        }) as unknown as Record<string, unknown>
      } catch (err) {
        bad(`the web client's contribute() threw: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (landed) {
        console.log(`  built on ${before.hash.slice(0, 16)}…, round trip ${secs(t0)}`)
        c.cookie = lastSetCookie ?? undefined
        ok('accepted')
        landed.deepVerified === true
          ? ok('DEEP-VERIFIED against arcanum.r1cs + the Hermez ptau')
          : bad('accepted WITHOUT deep verification — the ptau was not read')
        const chain = landed.chain as { name: string; outputHash: string }[] | undefined
        chain?.at(-1)?.name === c.name && landed.headHash === chain?.at(-1)?.outputHash
          ? ok('the chain head is now their key')
          : bad('head is not their key')
        c.cookie ? ok('the sequencer gave the tab a session') : bad('no session cookie came back')
      }
    }

    step('2.2 rehearsal-two contributes through the raw route, as a script would')
    {
      const c = contributors[1]
      const head = await fetchHead()
      console.log(`  downloaded head ${head.hash.slice(0, 16)}… (${head.bytes.length} bytes)`)
      const t0 = Date.now()
      const out = contributeTo(head.bytes, c.name)
      console.log(`  contributed in ${secs(t0)}`)
      const t1 = Date.now()
      const r = await upload(out, head.hash, c)
      console.log(`  sequencer answered ${r.status} in ${secs(t1)}`)
      if (r.status !== 201) {
        bad(`rejected: ${await errorOf(r)}`)
      } else {
        ok('accepted')
        const body = await r.json() as Record<string, unknown>
        body.deepVerified === true
          ? ok('DEEP-VERIFIED against arcanum.r1cs + the Hermez ptau')
          : bad('accepted WITHOUT deep verification — the ptau was not read')
        body.headHash === sha(out) ? ok('the chain head is now their key') : bad('head is not their key')
      }
    }
    const chain = (await status()).chain as { name: string }[]
    chain.length === contributors.length
      ? ok(`chain reads ${chain.map((c) => c.name).join(' → ')}`)
      : bad(`chain holds ${chain.length} contributions, expected ${contributors.length}`)

    step('3. the refusals a contributor will actually hit')
    // Build on a head, then let someone else land first, so this one is genuinely stale.
    const stale = await fetchHead()
    const raced = contributeTo(stale.bytes, 'racer')
    const jumper: Contributor = { name: 'lands-first' }
    const jh = await fetchHead()
    await upload(contributeTo(jh.bytes, jumper.name), jh.hash, jumper)
    const rStale = await upload(raced, stale.hash, { name: 'racer' })
    rStale.status === 409
      ? ok(`a contribution built on a moved head is refused (409: ${await errorOf(rStale)})`)
      : bad(`a stale head got ${rStale.status}, expected 409`)

    const dupHead = await fetchHead()
    const rDup = await upload(contributeTo(dupHead.bytes, 'again'), dupHead.hash, contributors[0])
    rDup.status === 409
      ? ok(`a second contribution from one session is refused (409: ${await errorOf(rDup)})`)
      : bad(`a duplicate got ${rDup.status}, expected 409`)

    const now = await fetchHead()
    const rJunk = await upload(Buffer.from(randomBytes(4096)), now.hash, { name: 'junk' })
    rJunk.status === 400
      ? ok(`garbage bytes are refused (400: ${await errorOf(rJunk)})`)
      : bad(`garbage got ${rJunk.status}, expected 400`)

    const rEcho = await upload(now.bytes, now.hash, { name: 'echo' })
    rEcho.status === 400
      ? ok(`re-uploading the head unchanged is refused (400: ${await errorOf(rEcho)})`)
      : bad(`an unchanged upload got ${rEcho.status}, expected 400`)

    step('4. the coordinator caps the chain with a beacon')
    const last = await fetchHead()
    const headFile = path.join(work, 'head.zkey')
    const finalFile = path.join(work, 'final.zkey')
    writeFileSync(headFile, last.bytes)
    snarkjs(['zkey', 'beacon', headFile, finalFile,
      '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', '10',
      '-n=Final beacon contribution'])
    const finalBytes = readFileSync(finalFile)
    const finalHash = sha(finalBytes)
    console.log(`  final key ${finalHash.slice(0, 16)}… (${finalBytes.length} bytes)`)

    step('5. and verifies the whole chain before publishing any of it')
    const t2 = Date.now()
    snarkjs(['zkey', 'verify', R1CS, PTAU, finalFile])
    ok(`snarkjs zkey verify passes on the finalized key (${secs(t2)})`)

    step('6. the site then serves that key, and says it is the ceremony\'s')
    await custody.put(finalHash, finalBytes)
    await store.finalize(finalHash)
    const config = await (await fetch(`${base}/arcanum/config`)).json() as Record<string, unknown>
    console.log(`  /arcanum/config ${JSON.stringify(config)}`)
    config.zkeySource === 'ceremony' ? ok('zkeySource is ceremony') : bad(`zkeySource is ${String(config.zkeySource)}`)
    config.ready === true ? ok('ready is true') : bad('ready is false')
    config.zkeyHash === (await status()).finalHash
      ? ok('the served hash IS the transcript finalHash')
      : bad('the served hash is not the transcript finalHash')
    const served = Buffer.from(await (await fetch(`${base}/arcanum/circuit/zkey`)).arrayBuffer())
    sha(served) === finalHash
      ? ok(`/arcanum/circuit/zkey streams those exact bytes (${served.length})`)
      : bad('the streamed bytes are not the final key')

    step('7. the point of all of it: a proof made with that key verifies')
    const vkFile = path.join(work, 'vk.json')
    snarkjs(['zkey', 'export', 'verificationkey', finalFile, vkFile])
    const { generateNote, generateSpendProof, computeRecipient } = await import('../src/arcanum/prover.js')
    const { MemoryArcanumTree } = await import('../src/arcanum/ArcanumTree.js')
    const { ArcanumVerifier, makeSnarkjsVerifier } = await import('../src/arcanum/ArcanumVerifier.js')
    const { computeCommitment } = await import('../src/arcanum/poseidon.js')

    const note = generateNote(500n)
    const tree = new MemoryArcanumTree()
    const { leafIndex } = await tree.insert(await computeCommitment(note.nullifier, note.secret), note.valor)
    note.leafIndex = leafIndex
    const recipient = computeRecipient('mod-rehearsal', { prompt: 'a rehearsal prompt' })
    const t3 = Date.now()
    const spend = await generateSpendProof(note, await tree.getProof(leafIndex), recipient,
      { wasmPath: WASM, zkeyPath: finalFile })
    console.log(`  proof generated in ${secs(t3)}`)
    const result = await new ArcanumVerifier({
      tree, verify: makeSnarkjsVerifier(JSON.parse(readFileSync(vkFile, 'utf8'))),
    }).verify(spend)
    result.nullifierHash === spend.publicSignals.nullifierHash && result.valor === note.valor
      ? ok('the proof verifies — the whole path works with a key this ceremony produced')
      : bad('the verifier did not accept a proof made with this ceremony\'s own key')

    // The pair must be bound: a proof from THIS ceremony must not verify under another
    // ceremony's key. If it did, the vkey would not be pinning anything.
    await new ArcanumVerifier({
      tree, verify: makeSnarkjsVerifier(JSON.parse(readFileSync(path.join(ARTIFACTS, 'verification_key.json'), 'utf8'))),
    }).verify(spend).then(
      () => bad('the proof ALSO verified under an unrelated verification key'),
      () => ok('and it does not verify under a different ceremony\'s key — the pair is bound'),
    )
  } catch (err) {
    bad(`threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
    rmSync(work, { recursive: true, force: true })
    console.log(failures === 0
      ? '\n\x1b[32mREHEARSAL CLEAN\x1b[0m — the contribution flow works end to end.'
      : `\n\x1b[31m${failures} FAILURE(S)\x1b[0m — do not open the ceremony until these are understood.`)
    process.exit(failures === 0 ? 0 : 1)
  }
}

void main()
