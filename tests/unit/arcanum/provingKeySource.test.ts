// The served proving key follows the ceremony transcript.
//
// The failure this guards against is not a crash: it is the site publishing a finished
// ceremony while handing clients a key that is not its output. So the cases that matter
// are the ones where the two disagree — finalized with the key missing, and finalized
// with custody holding the wrong bytes — and in both the answer must be "serve nothing",
// never "serve the committed key".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProvingKeySource } from '../../../src/arcanum/ProvingKeySource.js'
import { MemoryCeremoniaStore, type CeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import type { ZkeyCustody } from '../../../src/arcanum/CeremoniaCustody.js'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

class MemoryCustody implements ZkeyCustody {
  private m = new Map<string, Buffer>()
  async get(h: string) { return this.m.get(h) ?? null }
  async put(h: string, b: Buffer) { this.m.set(h, b) }
}

/** A stand-in for the committed arcanum_final.zkey — only its bytes matter here. */
function repoKeyFile(): { file: string; bytes: Buffer } {
  const dir = mkdtempSync(path.join(tmpdir(), 'arcanum-zkey-'))
  const bytes = randomBytes(2048)
  const file = path.join(dir, 'arcanum_final.zkey')
  writeFileSync(file, bytes)
  return { file, bytes }
}

/** A ceremony wound forward to finalized on `finalHash`. */
async function finalized(finalHash: string): Promise<MemoryCeremoniaStore> {
  const store = new MemoryCeremoniaStore()
  await store.open('00'.repeat(32), null)
  await store.finalize(finalHash)
  return store
}

test('before the ceremony finalizes, the committed key is served, named by its own hash', async () => {
  const { file, bytes } = repoKeyFile()
  const store = new MemoryCeremoniaStore()
  await store.open('00'.repeat(32), null)
  const source = createProvingKeySource({ store, custody: new MemoryCustody(), repoZkeyPath: file })

  const key = await source()
  assert.equal(key.origin, 'repo')
  assert.equal(key.hash, sha(bytes))
  assert.equal(key.path, file)
})

test('once finalized, the key the transcript names is served out of custody', async () => {
  const { file } = repoKeyFile()
  const final = randomBytes(4096)
  const finalHash = sha(final)
  const custody = new MemoryCustody()
  await custody.put(finalHash, final)
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody, repoZkeyPath: file,
  })

  const key = await source()
  assert.equal(key.origin, 'ceremony')
  assert.equal(key.hash, finalHash)
  assert.ok(key.bytes?.equals(final))
})

test('finalized with the key absent from custody serves nothing — never the committed key', async () => {
  const { file } = repoKeyFile()
  const finalHash = sha(randomBytes(4096))
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody: new MemoryCustody(), repoZkeyPath: file,
  })

  const key = await source()
  assert.equal(key.origin, 'none')
  // The hash is still reported: we know which key belongs here, we just do not have it.
  assert.equal(key.hash, finalHash)
  assert.equal(key.bytes, undefined)
  assert.equal(key.path, undefined)
  assert.match(key.reason ?? '', /not published on this server/)
})

test('custody bytes that do not hash to the published final key are refused', async () => {
  const { file } = repoKeyFile()
  const finalHash = sha(randomBytes(4096))
  const custody = new MemoryCustody()
  await custody.put(finalHash, randomBytes(4096)) // wrong bytes under the right name
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody, repoZkeyPath: file,
  })

  const key = await source()
  assert.equal(key.origin, 'none')
  assert.equal(key.hash, finalHash)
})

test('an unreadable ceremony record falls back to the committed key rather than serving none', async () => {
  const { file, bytes } = repoKeyFile()
  const store = {
    async status() { throw new Error('mongo is down') },
  } as unknown as CeremoniaStore
  const source = createProvingKeySource({ store, custody: new MemoryCustody(), repoZkeyPath: file })

  const key = await source()
  assert.equal(key.origin, 'repo')
  assert.equal(key.hash, sha(bytes))
})

test('a missing committed key is reported without a hash — nothing to serve, nothing to name', async () => {
  const store = new MemoryCeremoniaStore()
  const source = createProvingKeySource({
    store, custody: new MemoryCustody(), repoZkeyPath: path.join(tmpdir(), 'no-such-arcanum.zkey'),
  })

  const key = await source()
  assert.equal(key.origin, 'none')
  assert.equal(key.hash, null)
})
