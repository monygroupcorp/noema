#!/usr/bin/env -S npx tsx
// guard-weight-addresses — ask every download address in the model registry whether it names a
// real file, the same way a pod would ask.
//
// The registry is the only thing that says where a weight lives: `Compiler._resolveModels` looks
// an id up and, for any record carrying a source, OVERWRITES the workflow manifest's url with
// `sources[0].uri`. Nothing downstream re-checks it. So a wrong address is invisible until a pod
// has been rented, provisioned, and has pulled every OTHER weight — then `wget` 404s and the run
// dies having spent the whole cost of the job.
//
// `catalogIntegrity` holds the manifests and the registry to each other, which is a real check and
// a blind one: two files can agree perfectly about an address that exists nowhere. That is exactly
// how the four Wan 2.2 unets sat pointing at Wan-AI's own repos — which publish bf16 diffusers
// shards and no fp8_scaled file at all — through every green run of the hermetic suite.
//
// HOW IT ASKS. The pod downloader (`comfyrunner.py`) fetches with plain unauthenticated wget, so
// this probes anonymously too: what this script can reach is what a pod can reach. HEAD first,
// falling back to a one-byte ranged GET for hosts that refuse HEAD.
//
// WHAT IT REFUSES. A 404/410 is `dead` — the address names nothing, and that is the failure this
// guard exists to make loud. Exit 1, naming each one.
//
// WHAT IT WARNS ABOUT. A 401/403 is `gated`: the file is there, but an anonymous pull is refused,
// so a pod cannot fetch it either. That is a real problem with a different fix (mirror it to R2
// and make that `sources[0]` — the established auth-free pattern), and at least one registry entry
// is knowingly in that state with its remedy already written beside it. Folding it into this
// guard's red would mean the guard could never be switched on, so it warns by default and fails
// under `--strict-gated`.
//
// THE OFFLINE STORY. A guard that cannot reach the network must not report that every weight in
// the catalogue is dead — that is the failure mode that teaches people to ignore it. Only an HTTP
// answer is evidence; a DNS failure, a refused connection or a timeout is `unknown`, and so are
// 429 and 5xx after retries, because they are the host declining to answer rather than answering
// "no". By default unknowns are reported and do not fail the run, so this is usable on a laptop on
// a train. CI passes `--require-network`, where an unknown IS a failure: on a runner that is
// supposed to have an uplink, "I could not tell" is a broken guard, and a broken guard should be
// red rather than quietly green.

import { readFileSync } from 'node:fs'
import { CANONICAL_INTELLAE } from '../src/crystal/seeds/intellae.js'

type Verdict = 'live' | 'dead' | 'gated' | 'unknown'

interface Probe {
  id: string
  uri: string
  /** Index into the record's `sources` — 0 is the one the compiler actually hands the pod. */
  rank: number
  verdict: Verdict
  /** HTTP status, or the transport error, whichever answered. */
  detail: string
}

const ATTEMPTS = 3
const CONCURRENCY = 6

/** What an HTTP status means for a pod holding no credentials. */
export function classify(status: number): Verdict {
  if (status >= 200 && status < 300) return 'live'
  if (status === 401 || status === 403) return 'gated'
  if (status === 404 || status === 410) return 'dead'
  return 'unknown'
}

/** A status worth asking again about: the host declined to answer, it did not answer "no". */
function retryable(status: number): boolean {
  return status === 429 || status >= 500
}

async function probe(id: string, uri: string, rank: number): Promise<Probe> {
  let detail = 'no attempt made'
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 2)))
    try {
      let res = await fetch(uri, { method: 'HEAD', redirect: 'follow' })
      // Some object stores answer HEAD with 405/501 and serve the same file to GET. Ask for one
      // byte rather than pulling a 14 GB weight to learn that it is there.
      if (res.status === 405 || res.status === 501) {
        res = await fetch(uri, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } })
        await res.body?.cancel()
      }
      detail = `HTTP ${res.status}`
      if (retryable(res.status) && attempt < ATTEMPTS) continue
      return { id, uri, rank, verdict: classify(res.status), detail }
    } catch (err) {
      // No HTTP answer at all — DNS, connection refused, TLS, timeout. Never evidence about
      // the address itself.
      detail = err instanceof Error ? err.message : String(err)
    }
  }
  return { id, uri, rank, verdict: 'unknown', detail }
}

/** Run `jobs` with a bounded number in flight, preserving input order in the result. */
async function pooled<T>(jobs: Array<() => Promise<T>>, width: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(width, jobs.length) }, async () => {
    for (let i = next++; i < jobs.length; i = next++) out[i] = await jobs[i]()
  })
  await Promise.all(workers)
  return out
}

/**
 * The addresses to probe. Default: every source of every canonical registry record. `--sources
 * <file>` reads a JSON array of `{ id, uri, rank? }` instead, which is how the hermetic test
 * drives this script against a loopback server rather than the real hub.
 */
function targets(argv: string[]): Array<{ id: string; uri: string; rank: number }> {
  const at = argv.indexOf('--sources')
  if (at !== -1) {
    const file = argv[at + 1]
    if (!file) throw new Error('--sources needs a path to a JSON array of { id, uri }')
    const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<{ id: string; uri: string; rank?: number }>
    return rows.map((r, i) => ({ id: r.id, uri: r.uri, rank: r.rank ?? i }))
  }
  return CANONICAL_INTELLAE.flatMap(intella =>
    (intella.sources ?? []).map((s, rank) => ({ id: intella.id, uri: s.uri, rank })),
  )
}

export async function run(argv: string[]): Promise<number> {
  const requireNetwork = argv.includes('--require-network')
  const strictGated = argv.includes('--strict-gated')

  const rows = targets(argv)
  if (rows.length === 0) {
    console.error('guard-weight-addresses: no sources to probe — the registry is empty, which is itself wrong')
    return 1
  }

  const results = await pooled(rows.map(r => () => probe(r.id, r.uri, r.rank)), CONCURRENCY)

  const dead = results.filter(r => r.verdict === 'dead')
  const gated = results.filter(r => r.verdict === 'gated')
  const unknown = results.filter(r => r.verdict === 'unknown')
  const live = results.filter(r => r.verdict === 'live')

  // Every single probe failed at the transport layer: this machine has no route to anything, and
  // the catalogue is not what is broken. Say that, and say it in the words a reader needs.
  const offline = unknown.length === results.length && unknown.every(r => !r.detail.startsWith('HTTP '))
  if (offline) {
    console.error(`guard-weight-addresses: no host answered any of ${results.length} probes — this machine could not reach the network.`)
    console.error(`  first error: ${unknown[0].detail}`)
    console.error(requireNetwork
      ? '  --require-network was passed, so "could not tell" is a failure here.'
      : '  Nothing is claimed about the catalogue. Re-run with a working uplink.')
    return requireNetwork ? 1 : 0
  }

  for (const r of dead) {
    console.error(`DEAD    ${r.id} (sources[${r.rank}]) ${r.detail}\n        ${r.uri}`)
  }
  for (const r of gated) {
    console.error(`GATED   ${r.id} (sources[${r.rank}]) ${r.detail} — the file is there, an anonymous pull is not; a pod fetches anonymously\n        ${r.uri}`)
  }
  for (const r of unknown) {
    console.error(`UNKNOWN ${r.id} (sources[${r.rank}]) ${r.detail}\n        ${r.uri}`)
  }

  console.error(
    `\nguard-weight-addresses: ${results.length} source(s) probed — ` +
    `${live.length} live, ${dead.length} dead, ${gated.length} gated, ${unknown.length} unanswered`,
  )

  if (dead.length > 0) {
    console.error(`\n${dead.length} address(es) name no file. A pod sent to one dies at wget after the weights pull is already paid for.`)
    console.error('Check each against its own repo — never copy a path from a sibling repo, which is how these get written wrong.')
    return 1
  }
  if (strictGated && gated.length > 0) return 1
  if (requireNetwork && unknown.length > 0) {
    console.error('\n--require-network: an unanswered address is a failure here. A runner with an uplink that cannot tell is a broken guard.')
    return 1
  }
  return 0
}

// Entry-point guard: `tsx` evaluates `import.meta` for real, so this is live under the npm script
// and inert when the hermetic test imports `run`.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code })
}
