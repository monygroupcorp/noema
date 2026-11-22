#!/usr/bin/env -S npx tsx
// =============================================================================
// fire-example.ts — fire ONE real gpt-image run through the real crystal
// dispatch path, and re-host its output at a durable public R2 URL.
// =============================================================================
//
// WHY
//   The examples-of-our-own gallery needs real, noema-generated media (not
//   copied, not mocked). This fires `modus.gpt-image` through the SAME
//   `dispatchInceptio` every `/v1/runs` request runs — `Compiler`/`RunPodCursor`
//   never load, so the ONLY live side effects are: a real OpenAI image-generation
//   call, and a real write to the R2 outputs bucket. Mirrors the pattern
//   `spike-koh-remote.ts` and `scripts/crystal/seed-canon.ts` already use for
//   "drive the real pipeline against a scratch DB" dev harnesses.
//
// DB SAFETY
//   Targets `CRYSTAL_DB` (default `noemaplane_stage`, the house scratch DB —
//   see `seed-canon.ts`). Refuses `noema`/`noemaplane`. Run `seed-canon.ts`
//   against the same DB first so `modus.gpt-image` exists there.
//
// COST
//   One OpenAI image-generation call per invocation (gpt-image-1, a few cents).
//   `DEV_FREE_EXECUTION=1` is set here so a fresh, unfunded showcase anima
//   isn't balance-gated — it does NOT fake the provider call.
//
// USAGE
//   OPENAI_API_KEY=... MONGODB_URI=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
//   R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... R2_PUBLIC_URL=... \
//     npx tsx scripts/examples-gallery/fire-example.ts \
//       --prompt "..." --id make-01 [--size 1024x1024] [--quality high]
//
//   Any modus reachable through an openai-ministerium cursor OR a host-side cursor
//   (ffmpeg, composite — createContainer always registers those, no pod needed)
//   works the same way: pass --modus and --aditus '<json>' instead of --prompt. e.g.
//   assembling a "video" example from frames already fired (no RunPod, no GPU):
//     npx tsx scripts/examples-gallery/fire-example.ts --id video-01 \
//       --modus modus.frames-to-video \
//       --aditus '{"frames":["https://.../a.png","https://.../b.png"],"fps":8}'
//
// Prints one JSON line to stdout: {id, modusId, aditus, mediaUrl, actumId}.
// =============================================================================

import { MongoClient } from 'mongodb'
import { createContainer, type ContainerConfig } from '../../src/container.js'
import { dispatchInceptio } from '../../src/execution/dispatchInceptio.js'
import { OPENAI_PROVIDER } from '../../src/crystal/apiProviders.js'
import { R2Uploader } from '../../src/crystal/R2Uploader.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI
const DB = process.env.CRYSTAL_DB ?? 'noemaplane_stage'
if (DB === 'noema' || DB === 'noemaplane') {
  console.error(`[fire-example] Refusing to fire into protected DB '${DB}'. Set CRYSTAL_DB.`)
  process.exit(1)
}
if (!URI) { console.error('[fire-example] MONGODB_URI (or MONGO_PASS) is required'); process.exit(1) }

// Only the openai-ministerium path (modus.gpt-image and friends) needs this key — a
// host-side dispatch (ffmpeg/composite) never touches apiProviders, so it stays optional
// and the container gets a harmless placeholder instead of refusing to start.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? process.env.OPENAI_API

type Args = { id: string; prompt?: string; size?: string; quality?: string; modusId: string; aditus?: string }

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = { modusId: 'modus.gpt-image' }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    const need = (): string => { if (value === undefined) throw new Error(`${flag} needs a value`); i++; return value }
    switch (flag) {
      case '--id': a.id = need(); break
      case '--prompt': a.prompt = need(); break
      case '--size': a.size = need(); break
      case '--quality': a.quality = need(); break
      case '--modus': a.modusId = need(); break
      case '--aditus': a.aditus = need(); break
      default: throw new Error(`unknown argument '${flag}'`)
    }
  }
  if (!a.id || (!a.prompt && !a.aditus)) {
    throw new Error(
      'usage: --id <slug> (--prompt "<text>" [--size WxH] [--quality q] | --aditus \'<json>\') [--modus modus.gpt-image]',
    )
  }
  return a as Args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  process.env.DEV_FREE_EXECUTION = '1'

  const mongo = new MongoClient(URI!)
  await mongo.connect()
  console.error(`[fire-example] connected; DB=${DB}`)

  const config: ContainerConfig = {
    mongoUri: URI!,
    dbName: DB,
    // Never reached: 'modus.gpt-image' resolves to ApiCursor (ministerium:'openai'),
    // not RunPodCursor, so `compile` is dead code for this script's only path.
    compile: async () => { throw new Error('compile not needed — openai/ffmpeg/composite ministeria only') },
    apiProviders: [{ provider: OPENAI_PROVIDER, apiKey: OPENAI_API_KEY ?? 'unset' }],
  }
  const ring = createContainer(mongo, config)

  const anima = await ring.animae.create({ nomen: `showcase:${args.id}` })
  console.error(`[fire-example] anima=${anima.id}`)

  const aditus: Record<string, unknown> = args.aditus ? JSON.parse(args.aditus) : { prompt: args.prompt }
  if (args.size) aditus.size = args.size
  if (args.quality) aditus.quality = args.quality

  const { actum, exitus } = await dispatchInceptio(
    {
      inceptor: ring.inceptor,
      modorum: ring.modorum,
      cursorum: ring.cursorum,
      completor: ring.completor,
      actumIndex: ring.actumIndex,
      compositusCursor: ring.compositusCursor,
    },
    { modusId: args.modusId, aditus, by: { animaId: anima.id } },
  )

  if (!exitus) throw new Error(`actum ${actum.id} did not complete synchronously — exitus missing`)
  // modus.gpt-image's exitus carries `image`; modus.frames-to-video's carries `video` —
  // whichever the modus declares in its `exitus` schema is the one this picks up.
  const exitusRecord = exitus as Record<string, unknown>
  const rawMedia = exitusRecord.image ?? exitusRecord.video
  if (typeof rawMedia !== 'string') throw new Error(`no string image/video in exitus: ${JSON.stringify(exitus)}`)

  let mediaUrl: string
  if (rawMedia.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(rawMedia)
    if (!match) throw new Error('data: URI did not match the expected base64 shape')
    const [, contentType, b64] = match
    const bytes = Buffer.from(b64, 'base64')
    const ext = contentType.split('/')[1] || 'png'
    const accountId = process.env.R2_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    const bucket = process.env.R2_OUTPUTS_BUCKET ?? process.env.R2_BUCKET_NAME
    const publicUrl = process.env.R2_PUBLIC_URL
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME are required to re-host a data: URI')
    }
    const uploader = new R2Uploader({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      accessKeyId, secretAccessKey, bucket, publicUrl,
    })
    mediaUrl = await uploader.put(`showcase/${args.id}.${ext}`, bytes, contentType)
  } else {
    mediaUrl = rawMedia
  }

  console.log(JSON.stringify({ id: args.id, modusId: args.modusId, aditus, mediaUrl, actumId: actum.id }))
  await mongo.close()
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
