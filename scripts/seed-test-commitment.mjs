// One-off: seed a funded arcanum commitment into noemaplane (STAGING) for live API
// verification. Hardcodes the DB to 'noemaplane' and REFUSES anything else — the
// .env MONGO_DB_NAME is 'noema' (prod) and must never be the target here.
import { MongoClient } from 'mongodb'
import { randomBytes, randomUUID } from 'node:crypto'

const DB = 'noemaplane'                       // hard target — never prod 'noema'
if (DB === 'noema') throw new Error('refuse to seed prod')

const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) throw new Error('no MONGODB_URI in env')

const commitment = '0x' + randomBytes(32).toString('hex')
const valor = '100000'                        // ~enough to cover an sd1-5 run

const client = new MongoClient(uri)
await client.connect()
const col = client.db(DB).collection('signa')
const doc = {
  id: randomUUID(),
  forma: 'arcanum',
  testis: commitment,
  valor,
  // Numeric sort-mirror of valor (ledger-hardening Debt #1) — MongoSignorum.reserve selects via
  // .sort({ valorNum: 1 }); a direct insert must write it too, else this seeded coin sorts as null
  // (below all numbers) and gets mis-picked ahead of smaller coins. Mirrors toDoc's Number(v).
  valorNum: Number(BigInt(valor)),
  auctor: 'test:api-live-verification',
  natum: new Date(),
  status: 'valid',
}
await col.insertOne(doc)
// sanity: sum the live balance for this commitment in noemaplane
const docs = await col.find({ testis: commitment, forma: 'arcanum', status: 'valid' }).toArray()
const bal = docs.reduce((s, d) => s + BigInt(d.valor), 0n)
await client.close()

console.log(JSON.stringify({ db: DB, commitment, valor, signumId: doc.id, balanceInDb: bal.toString() }))
