// Read-only: find existing funded test commitments in noemaplane (STAGING). Never touches prod.
import { MongoClient } from 'mongodb'
const DB = 'noemaplane'
if (DB === 'noema') throw new Error('refuse to read prod here')
const uri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!uri) throw new Error('no MONGODB_URI in env')
const client = new MongoClient(uri)
await client.connect()
const col = client.db(DB).collection('signa')
const docs = await col.find({ forma: 'arcanum', status: 'valid' }).toArray()
// group balance by commitment (testis)
const byCommit = {}
for (const d of docs) byCommit[d.testis] = (byCommit[d.testis] ?? 0n) + BigInt(d.valor ?? '0')
await client.close()
const out = Object.entries(byCommit).map(([commitment, bal]) => ({ commitment, balance: bal.toString() }))
console.log(JSON.stringify({ db: DB, count: out.length, commitments: out }, null, 2))
