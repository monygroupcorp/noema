// One-off: mint a FUNDED /v1 API key on noemaplane (STAGING) for live training/publish
// verification. Hard-targets 'noemaplane' and REFUSES 'noema' (prod). Creates the full
// chain the api-key acceptor walks: user(_id=accountId).apiKeys[] → 'api' persona
// (externusId=accountId) → activeAnimaId → minted signa balance.
//
// Run: node --env-file=.env --import tsx scripts/mint-staging-key.ts
import { MongoClient } from 'mongodb'
import { MongoAnima } from '../src/crystal/MongoAnima.js'
import { MongoPersona } from '../src/crystal/MongoPersona.js'
import { MongoSignorum } from '../src/crystal/MongoSignorum.js'
import { generateApiKeyMaterial, appendApiKeyRecord } from '../src/crystal/apiKeys.js'

const DB = 'noemaplane'                                  // hard target — never prod 'noema'
if ((DB as string) === 'noema') throw new Error('refuse to seed prod')

const ACCOUNT = process.env.MINT_ACCOUNT ?? 'koh-trainer-acct'
const VALOR = BigInt(process.env.MINT_VALOR ?? '1000000000')   // 1e9 — ample for a billed training run

async function main(): Promise<void> {
const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) throw new Error('no MONGODB_URI in env')

const { apiKey, keyPrefix, keyHash } = generateApiKeyMaterial()  // ms2_<48 hex>

const client = new MongoClient(uri)
await client.connect()
const db = client.db(DB)

const animae = new MongoAnima(db.collection('animae'))
const personae = new MongoPersona(db.collection('personae'))
// MongoSignorum requires the client as well as the collection: `settle` spans two writes inside a
// Mongo transaction, which it opens on the client. Constructed without it, that path has nothing to
// open a session on.
const signorum = new MongoSignorum(db.collection('signa'), client)

// Reuse an existing 'api' persona for this account if present (idempotent re-run); else mint.
const existing = await personae.findByExternus('api', ACCOUNT)
let animaId: string
if (existing && existing.activeAnimaId) {
  animaId = existing.activeAnimaId
} else {
  const anima = await animae.create({ nomen: `api:${ACCOUNT}` })
  await personae.findOrCreate('api', ACCOUNT, { animaId: anima.id })
  animaId = anima.id
}

// Append the api key to the user doc keyed by _id = accountId (verifyApiKeyToAccountId).
await appendApiKeyRecord(db.collection('users'), ACCOUNT, { keyPrefix, keyHash, status: 'active' })

// Fund the anima.
await signorum.issue({ forma: 'minted', valor: VALOR, animaId, auctor: 'system:koh-train-seed' } as any)
const balance = await signorum.balance({ animaId })

await client.close()
console.log(JSON.stringify({ db: DB, account: ACCOUNT, apiKey, keyPrefix, animaId, balance: balance.toString() }, null, 2))
}

main().catch((err) => { console.error('mint failed:', err); process.exit(1) })
