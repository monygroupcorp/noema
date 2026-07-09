// MeExporter — the GDPR self-export assembler. These tests are the safety gate the plan
// (noema-024) demands: the assembler is STRICTLY self-scoped and can never return another
// user's rows, the money collections are fetched with the caller's own key (never the
// unfiltered list), the platform revenue book (Reditus) is absent, and no password hash leaks.

import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MeExporter, type MeExporterDeps } from '../../../src/crystal/MeExporter.js'
import { MongoCredentum } from '../../../src/crystal/MongoCredentum.js'
import { MongoProvinciarum } from '../../../src/crystal/MongoProvinciarum.js'
import { MongoDepositum } from '../../../src/crystal/MongoDepositum.js'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'

const A = { animaId: 'anima-A' } as const
const B = { animaId: 'anima-B' } as const

let client: MongoClient
let credenta: MongoCredentum, provinciae: MongoProvinciarum, deposita: MongoDepositum, signorum: MongoSignorum
let credCol: Collection, provCol: Collection, depCol: Collection, sigCol: Collection

// In-memory ObjectStore that records what it hosts. Enough for exportForCaller.
function fakeStore() {
  const puts: Array<{ key: string; bytes: Buffer; contentType: string }> = []
  return {
    puts,
    async put(key: string, bytes: Buffer, contentType: string) { puts.push({ key, bytes, contentType }); return `https://public.example/${key}` },
    async del() {},
    async getSignedDownloadUrl(key: string, opts?: { expiresIn?: number }) { return `https://signed.example/${key}?exp=${opts?.expiresIn ?? 0}` },
  }
}

// Deps whose collections we are NOT asserting in a given test — inert, return empty. Records
// nothing. Real scoping of these finders is covered by their own store tests.
function inertReads(overrides: Partial<MeExporterDeps> = {}): MeExporterDeps {
  const base = {
    store: fakeStore(),
    consuetudinum: { async resolveAppearance() { return undefined }, async resolveGeneratio() { return undefined }, async listBindings() { return [] } },
    personae: { async findByAnimaId() { return [] } },
    credenta: { async findByAnimaId() { return null } },
    provinciae: { async listByOwner() { return [] } },
    actumIndex: { async findFor() { return [] } },
    intellae: { async listByOwner() { return [] } },
    editiones: { async listByAuthor() { return [] } },
    memoriae: { async findByAnima() { return null } },
    colloquia: { async findByAnima() { return [] } },
    dicta: { async listByColloquium() { return [] } },
    vestigiorum: { async forIdentity() { return [] } },
    bursarium: { async listByOwner() { return [] }, async findByToken() { return null } },
    signorum: { async history() { return [] } },
    deposita: { async list() { return [] } },
  }
  return { ...base, ...overrides } as unknown as MeExporterDeps
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  credCol = client.db(DB).collection('meexport_credenta')
  provCol = client.db(DB).collection('meexport_provinciae')
  depCol = client.db(DB).collection('meexport_deposita')
  sigCol = client.db(DB).collection('meexport_signa')
  credenta = new MongoCredentum(credCol)
  provinciae = new MongoProvinciarum(provCol)
  deposita = new MongoDepositum(depCol)
  signorum = new MongoSignorum(sigCol)
})
afterEach(async () => { await Promise.all([credCol, provCol, depCol, sigCol].map(c => c.deleteMany({}))) })
after(async () => {
  await Promise.all([credCol, provCol, depCol, sigCol].map(c => client.db(DB).dropCollection(c.collectionName).catch(() => {})))
  await client.close()
})

async function seedTwoUsers() {
  // Credential rows (username + a passwordHash that MUST NOT leak).
  await credenta.create({ username: 'alice', passwordHash: 'scrypt$AAA$secretA', animaId: A.animaId })
  await credenta.create({ username: 'bob', passwordHash: 'scrypt$BBB$secretB', animaId: B.animaId })
  // Projects.
  await provinciae.create({ animaId: A.animaId, nomen: 'A-proj', datasetIds: [], modelIds: [], collectionIds: [] })
  await provinciae.create({ animaId: B.animaId, nomen: 'B-proj', datasetIds: [], modelIds: [], collectionIds: [] })
  // Credit ledger (Signum).
  await signorum.issue({ animaId: A.animaId, forma: 'minted', valor: 111n })
  await signorum.issue({ animaId: B.animaId, forma: 'minted', valor: 222n })
  // Deposits — the collection whose finder MUST be list({animaId}), never the unfiltered list().
  await deposita.create({ chainId: 1, transactioHash: '0xA', ab: '0xa', ad: '0xv', valor: 10n, confirmationes: 3, status: 'processatum', animaId: A.animaId })
  await deposita.create({ chainId: 1, transactioHash: '0xB', ab: '0xb', ad: '0xv', valor: 20n, confirmationes: 3, status: 'processatum', animaId: B.animaId })
}

test('SELF-SCOPING: A\'s export contains ALL of A\'s rows and NONE of B\'s', async () => {
  await seedTwoUsers()
  const exporter = new MeExporter(inertReads({ credenta, provinciae, deposita, signorum }))
  const bundle = await exporter.assemble(A)

  // Projects: only A's.
  assert.equal(bundle.projects.length, 1)
  assert.equal(bundle.projects[0].animaId, A.animaId)
  assert.ok(!bundle.projects.some(p => p.animaId === B.animaId), 'no B project leaked')

  // Credit ledger: only A's.
  assert.equal(bundle.signa.length, 1)
  assert.equal(bundle.signa[0].animaId, A.animaId)

  // Deposits: only A's — the list({animaId}) invariant (B\'s deposit must never appear).
  assert.equal(bundle.deposita.length, 1)
  assert.equal(bundle.deposita[0].animaId, A.animaId)
  assert.ok(!bundle.deposita.some(d => d.animaId === B.animaId), 'B deposit leaked into A export')

  // Credential: A\'s username, and the passwordHash is stripped.
  assert.equal(bundle.credentum?.username, 'alice')
  assert.ok(!('passwordHash' in (bundle.credentum as Record<string, unknown>)), 'passwordHash must not be exported')
})

test('B\'s export is the mirror — only B\'s rows (no cross-contamination either direction)', async () => {
  await seedTwoUsers()
  const exporter = new MeExporter(inertReads({ credenta, provinciae, deposita, signorum }))
  const bundle = await exporter.assemble(B)
  assert.equal(bundle.deposita.length, 1)
  assert.equal(bundle.deposita[0].animaId, B.animaId)
  assert.equal(bundle.signa[0].animaId, B.animaId)
  assert.equal(bundle.credentum?.username, 'bob')
})

test('the platform revenue book (Reditus) is NOT a key in the bundle', async () => {
  const exporter = new MeExporter(inertReads())
  const bundle = await exporter.assemble(A)
  assert.ok(!('reditus' in (bundle as Record<string, unknown>)), 'Reditus must never appear')
  assert.ok(!('redituum' in (bundle as Record<string, unknown>)))
})

test('MongoCredentum.findByAnimaId returns the caller\'s own row WITHOUT passwordHash', async () => {
  await credenta.create({ username: 'carol', passwordHash: 'scrypt$CCC$secret', animaId: 'anima-C' })
  const row = await credenta.findByAnimaId('anima-C')
  assert.equal(row?.username, 'carol')
  assert.equal(row?.animaId, 'anima-C')
  assert.ok(!('passwordHash' in (row as Record<string, unknown>)))
  assert.equal(await credenta.findByAnimaId('anima-nobody'), null)
})

test('GUARD: deposita is fetched with { animaId } exactly — never the unfiltered list()', async () => {
  let seen: unknown = 'NOT_CALLED'
  const deps = inertReads({ deposita: { async list(filter?: unknown) { seen = filter; return [] } } as unknown as MeExporterDeps['deposita'] })
  await new MeExporter(deps).assemble(A)
  assert.deepEqual(seen, { animaId: A.animaId })
})

test('GUARD: an anon bursaToken caller triggers NO identified (animaId-keyed) finder', async () => {
  const called: string[] = []
  const spy = (name: string, ret: unknown) => async () => { called.push(name); return ret }
  const deps = inertReads({
    personae: { findByAnimaId: spy('personae', []) } as unknown as MeExporterDeps['personae'],
    credenta: { findByAnimaId: spy('credenta', null) } as unknown as MeExporterDeps['credenta'],
    provinciae: { listByOwner: spy('provinciae', []) } as unknown as MeExporterDeps['provinciae'],
    memoriae: { findByAnima: spy('memoriae', null) } as unknown as MeExporterDeps['memoriae'],
    colloquia: { findByAnima: spy('colloquia', []) } as unknown as MeExporterDeps['colloquia'],
    deposita: { list: spy('deposita', []) } as unknown as MeExporterDeps['deposita'],
    vestigiorum: { forIdentity: spy('vestigiorum', []) } as unknown as MeExporterDeps['vestigiorum'],
    signorum: { history: spy('signorum', []) } as unknown as MeExporterDeps['signorum'],
    editiones: { listByAuthor: spy('editiones', []) } as unknown as MeExporterDeps['editiones'],
  })
  await new MeExporter(deps).assemble({ bursaToken: 'tok-xyz' })
  // vestigiorum/editiones/signorum/deposita are animaId|commitment keyed → must be skipped for bursaToken.
  assert.deepEqual(called.sort(), [], `no identified finder should run for a bursaToken caller, ran: ${called}`)
})

test('GUARD: a commitment caller scopes editions + signa by { commitment } and skips animaId-only finders', async () => {
  let editionBy: unknown = null, signumBy: unknown = null
  const called: string[] = []
  const deps = inertReads({
    editiones: { async listByAuthor(by: unknown) { editionBy = by; return [] } } as unknown as MeExporterDeps['editiones'],
    signorum: { async history(by: unknown) { signumBy = by; return [] } } as unknown as MeExporterDeps['signorum'],
    provinciae: { async listByOwner() { called.push('provinciae'); return [] } } as unknown as MeExporterDeps['provinciae'],
    deposita: { async list() { called.push('deposita'); return [] } } as unknown as MeExporterDeps['deposita'],
  })
  await new MeExporter(deps).assemble({ commitment: 'cmt-123' })
  assert.deepEqual(editionBy, { commitment: 'cmt-123' })
  assert.deepEqual(signumBy, { commitment: 'cmt-123' })
  assert.deepEqual(called, [], 'animaId-only finders must not run for a commitment caller')
})

test('exportForCaller hosts the bundle under an owner-scoped key and returns an expiring signed URL', async () => {
  const store = fakeStore()
  const exporter = new MeExporter(inertReads({ store: store as unknown as MeExporterDeps['store'] }))
  const res = await exporter.exportForCaller(A, { expiresIn: 600 })
  assert.equal(store.puts.length, 1)
  assert.match(store.puts[0].key, /^exports\/[0-9a-f]{16}\/[0-9a-f-]{36}\.json$/, 'owner-scoped, unguessable key')
  assert.ok(!store.puts[0].key.includes('anima-A'), 'raw animaId must not appear in the object key')
  assert.equal(store.puts[0].contentType, 'application/json')
  assert.ok(res.url.startsWith('https://signed.example/'), 'returns the signed URL, not the public path')
  assert.equal(res.expiresIn, 600)
  // The hosted bytes are the assembled bundle.
  const parsed = JSON.parse(store.puts[0].bytes.toString('utf8'))
  assert.equal(parsed.manifest.kind, 'noema-account-export')
  assert.equal(parsed.manifest.scopedBy, 'animaId')
})
