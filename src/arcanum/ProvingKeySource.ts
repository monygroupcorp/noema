import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import type { CeremoniaStore } from './CeremoniaStore.js'
import type { ZkeyCustody } from './CeremoniaCustody.js'
import { sha256Hex } from './CeremoniaCustody.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('arcanum:provingkey')

// Which Groth16 proving key this server hands to clients, and where it came from.
//
// The ceremony publishes a chain of hashes ending in a beacon'd final key, and the
// /ceremony page shows that transcript to the world. The key clients actually prove with
// used to be something else entirely: whatever arcanum_final.zkey the image was built
// with. So the transcript could read "ceremony complete, final key <hash>" while
// /arcanum/circuit/zkey handed out a key that was not its output — and from outside there
// was no way to tell, because the served bytes were never named by a hash anywhere.
//
// Here the served key follows the transcript. Once the ceremony is finalized the site
// serves the key the transcript names, checked byte-for-byte against that hash, or it
// serves nothing at all and says why. Before the ceremony concludes it serves the key
// committed to the repo, which is what it has always been and what the page does not
// claim otherwise about.

export type ProvingKeyOrigin =
  /** The finalized ceremony's key, out of ceremony custody. */
  | 'ceremony'
  /** The key committed to the repo — pre-ceremony, and what the dev setup produces. */
  | 'repo'
  /** Nothing to serve. `reason` says why. */
  | 'none'

export interface ServedProvingKey {
  origin: ProvingKeyOrigin
  /**
   * sha256 of the key that should be served. For 'ceremony' this is the transcript's
   * `finalHash`, so a client can check the bytes it proves with against the public
   * ceremony record. Non-null with origin 'none' means we know which key belongs here
   * and do not have it — a gap on this server, not a missing artifact.
   */
  hash: string | null
  /** Bytes to serve, when the key is held in ceremony custody. */
  bytes?: Buffer
  /** File to stream, when the key is the one committed to the repo. */
  path?: string
  /** Why nothing is served (origin 'none' only). */
  reason?: string
}

export type ProvingKeySource = () => Promise<ServedProvingKey>

/** sha256 a file without holding it in memory — the prod ceremony key is large. */
function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (c) => h.update(c))
    stream.on('error', reject)
    stream.on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * The key committed to the repo and nothing else — the pre-ceremony source, and what a
 * router wired without a ceremony store serves.
 */
export function createRepoProvingKeySource(repoZkeyPath: string): ProvingKeySource {
  let cached: ServedProvingKey | null = null
  return async () => {
    if (cached) return cached
    if (!existsSync(repoZkeyPath)) {
      return { origin: 'none', hash: null, reason: 'zkey not found — run arcanum-trusted-setup.sh' }
    }
    cached = { origin: 'repo', hash: await hashFile(repoZkeyPath), path: repoZkeyPath }
    return cached
  }
}

export interface ProvingKeySourceOpts {
  /** The ceremony's own record — its phase and the final key's published hash. */
  store: CeremoniaStore
  /** Where the ceremony's zkey chain lives, keyed by sha256. */
  custody: ZkeyCustody
  /** The proving key committed to the repo, served until the ceremony concludes. */
  repoZkeyPath: string
}

/**
 * Resolve the proving key to serve, re-reading the ceremony's phase on every call so a
 * finalize lands without a restart. Both keys are immutable once identified, so the bytes
 * (ceremony) and the hash (repo) are computed once and kept.
 */
export function createProvingKeySource(opts: ProvingKeySourceOpts): ProvingKeySource {
  let ceremonyKey: ServedProvingKey | null = null
  const fromRepo = createRepoProvingKeySource(opts.repoZkeyPath)

  async function fromCeremony(finalHash: string): Promise<ServedProvingKey> {
    if (ceremonyKey?.hash === finalHash) return ceremonyKey
    const missing: ServedProvingKey = {
      origin: 'none',
      hash: finalHash,
      reason: 'the ceremony is finalized but its proving key is not published on this server',
    }
    let bytes: Buffer | null = null
    try {
      bytes = await opts.custody.get(finalHash)
    } catch (err) {
      log.error('ceremony custody read failed', { finalHash, error: String(err) })
      return missing
    }
    if (!bytes) {
      log.error('ceremony finalized but the final proving key is absent from custody — ' +
        'serving no key. Set CEREMONY_FINAL_ZKEY to publish it, or ARCANUM_ZKEY_URL to host it.',
        { finalHash })
      return missing
    }
    // Custody is content-addressed, so this can only fail on a corrupt or hand-placed
    // file — exactly the case where serving the bytes anyway would be a lie about which
    // key the client is proving with.
    const got = sha256Hex(bytes)
    if (got !== finalHash) {
      log.error('custody bytes do not hash to the published final key — serving no key',
        { finalHash, got })
      return missing
    }
    ceremonyKey = { origin: 'ceremony', hash: finalHash, bytes }
    log.info('serving the ceremony final proving key', { finalHash, bytes: bytes.length })
    return ceremonyKey
  }

  return async () => {
    let finalHash: string | null = null
    try {
      const status = await opts.store.status()
      if (status.phase === 'finalized') finalHash = status.finalHash
    } catch (err) {
      // The ceremony record is unreadable: fall back to the repo key rather than take the
      // proving key offline over a database blip. The hash in /config still names exactly
      // what is being served, so nothing here can be mistaken for the ceremony's key.
      log.error('ceremony status unreadable — falling back to the committed key', { error: String(err) })
    }
    return finalHash ? fromCeremony(finalHash) : fromRepo()
  }
}
