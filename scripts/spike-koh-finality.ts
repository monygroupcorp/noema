// Finality-only: the koh training already produced output/koh/koh.safetensors.
// Run JUST Slice B against it — host in R2 + register the Intella + read it back.
// (Used after the training spike to verify finality without retraining.)
//   node --env-file=.env --import tsx scripts/spike-koh-finality.ts
import { MongoClient } from 'mongodb'
import { R2Uploader } from '../src/crystal/R2Uploader.js'
import { MongoIntella } from '../src/crystal/MongoIntella.js'
import { makeTrainingFinalizer, fsLoraReader } from '../src/crystal/trainingFinalizer.js'
import type { Actum } from '../src/types/actum.js'

const AITK = '/home/rth/projects/ai/training/ai-toolkit-klein'
const FAMILIA = 'flux2-klein'
const TRIGGER = 'koh'
const OWNER = 'spike-anima'
const r = (n: string): string => { const v = process.env[n]; if (!v) throw new Error(`missing ${n}`); return v }

async function main(): Promise<void> {
  const R2 = {
    endpoint: `https://${r('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: r('R2_ACCESS_KEY_ID'), secretAccessKey: r('R2_SECRET_ACCESS_KEY'),
    bucket: r('R2_BUCKET_NAME'), publicUrl: process.env.R2_PUBLIC_URL,
  }
  const mongo = new MongoClient(r('MONGODB_URI'))
  await mongo.connect()
  const intellae = new MongoIntella(mongo.db('noemaplane_test').collection('intellae'))

  const finalize = makeTrainingFinalizer({ reader: fsLoraReader(`${AITK}/output`), store: new R2Uploader(R2), intellae })
  const actum = { id: 'spike-koh', aditus: { jobId: 'koh', triggerWord: TRIGGER, familia: FAMILIA, baseModel: FAMILIA, ownerAnimaId: OWNER, name: 'koh spike LoRA' } } as unknown as Actum

  console.log('[finality] hosting + registering koh.safetensors …')
  const exitus = await finalize(actum, { status: 'completed', lastStep: 500 })
  console.log('[finality] EXITUS', JSON.stringify(exitus, null, 2))

  const found = await intellae.find(String(exitus.loraId))
  console.log('[finality] Intella.find:', found ? `${found.id} familia=${found.familia} trigger=${found.trigger} sizeGb=${found.sizeGb} access=${found.access}` : 'NOT FOUND')
  const map = await intellae.triggerMap(FAMILIA, OWNER)
  console.log(`[finality] triggerMap(${FAMILIA},${OWNER}) resolves '${TRIGGER}':`, map.get(TRIGGER)?.some(i => i.id === exitus.loraId) ? 'YES ✓' : 'no')

  await mongo.close()
  console.log('[finality] done.')
}

main().then(() => process.exit(0)).catch((err) => { console.error('[finality] FAILED:', err); process.exit(1) })
