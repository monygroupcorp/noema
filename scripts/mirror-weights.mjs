// Mirror upstream model weights → our R2 (models bucket) so the pod downloads auth-free from our CDN
// and we own custody. Streams HF → R2 via multipart upload (no full-file buffering, no local disk),
// and is idempotent: a key already present at the right size is skipped.
//
// Run: ./scripts/run-with-env.sh node scripts/mirror-weights.mjs [filter]
//   filter — optional substring; only manifest entries whose key contains it are mirrored.
//
// Env (loaded by run-with-env.sh): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
// Bucket defaults to `models` (→ https://models.miladystation2.net/<key>); override with MODELS_BUCKET.
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { Readable } from 'node:stream'

// The Krea 2 Turbo + Z-Image Turbo ComfyUI stacks. key = R2 path = ComfyUI dest = public CDN path.
// Z-Image reuses the already-mirrored flux ae.safetensors VAE, so it is not re-listed here.
const MANIFEST = [
  { key: 'diffusion_models/z_image_turbo_bf16.safetensors',     url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors' },
  { key: 'clip/qwen_3_4b.safetensors',                          url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors' },
  { key: 'diffusion_models/krea2_turbo_fp8_scaled.safetensors', url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors' },
  { key: 'clip/qwen3vl_4b_fp8_scaled.safetensors',              url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors' },
  { key: 'vae/qwen_image_vae.safetensors',                      url: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors' },
]

const filter = process.argv[2]
const bucket = process.env.MODELS_BUCKET ?? 'models'
const account = process.env.R2_ACCOUNT_ID
if (!account || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (load via run-with-env.sh).')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})

const fmtGb = (n) => `${(n / 1e9).toFixed(2)} GB`

async function upstreamSize(url) {
  const r = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  if (!r.ok) throw new Error(`HEAD ${r.status} ${r.statusText}`)
  const len = r.headers.get('content-length')
  return len ? Number(len) : undefined
}

async function r2Size(key) {
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return h.ContentLength
  } catch { return undefined }
}

async function mirrorOne({ key, url }) {
  const want = await upstreamSize(url)
  const have = await r2Size(key)
  if (have !== undefined && want !== undefined && have === want) {
    console.log(`✓ skip  ${key}  (already present, ${fmtGb(have)})`)
    return
  }
  if (have !== undefined && have !== want) {
    console.log(`↻ re-up ${key}  (size mismatch: r2=${have} upstream=${want})`)
  }
  console.log(`→ mirror ${key}  (${want ? fmtGb(want) : 'unknown size'}) …`)
  const dl = await fetch(url, { redirect: 'follow' })
  if (!dl.ok || !dl.body) throw new Error(`download ${url}: ${dl.status} ${dl.statusText}`)

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket, Key: key,
      Body: Readable.fromWeb(dl.body),
      ContentType: 'application/octet-stream',
      ...(want ? { ContentLength: want } : {}),
    },
    queueSize: 4,                 // 4 parts in flight
    partSize: 64 * 1024 * 1024,   // 64 MB parts
  })
  let lastPct = -1
  upload.on('httpUploadProgress', (p) => {
    if (!want || !p.loaded) return
    const pct = Math.floor((p.loaded / want) * 100)
    if (pct >= lastPct + 5) { lastPct = pct; process.stdout.write(`   ${key}: ${pct}% (${fmtGb(p.loaded)})\n`) }
  })
  await upload.done()
  const final = await r2Size(key)
  if (want !== undefined && final !== want) throw new Error(`post-check size ${final} != upstream ${want} for ${key}`)
  console.log(`✓ done  https://models.miladystation2.net/${key}  (${fmtGb(final ?? 0)})`)
}

const work = MANIFEST.filter((m) => !filter || m.key.includes(filter))
console.log(`Mirroring ${work.length}/${MANIFEST.length} weight(s) → r2://${bucket}\n`)
let failed = 0
for (const item of work) {
  try { await mirrorOne(item) }
  catch (e) { failed++; console.error(`✗ FAIL  ${item.key}: ${e.message}`) }
}
console.log(`\nDone. ${work.length - failed}/${work.length} ok${failed ? `, ${failed} failed` : ''}.`)
process.exit(failed ? 1 : 0)
