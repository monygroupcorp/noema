// One-off: mirror a CivitAI file → R2 (so the pod downloads auth-free from our CDN).
// Run: MODELS_BUCKET=models ./scripts/run-with-env.sh node scripts/mirror-civitai.mjs <versionId> <r2key>
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const versionId = process.argv[2] ?? '1165788'
const r2Key     = process.argv[3] ?? 'loras/armored_dress_V02.safetensors'
const bucket    = process.env.MODELS_BUCKET ?? 'models'
const account   = process.env.R2_ACCOUNT_ID
const endpoint  = `https://${account}.r2.cloudflarestorage.com`

console.log(`→ downloading CivitAI version ${versionId} …`)
const dl = await fetch(`https://civitai.com/api/download/models/${versionId}`, {
  headers: { Authorization: `Bearer ${process.env.CIVITAI_API_KEY}`, 'User-Agent': 'noema-mirror/1' },
  redirect: 'follow',
})
if (!dl.ok) { console.error(`CivitAI download failed: ${dl.status} ${dl.statusText}`); process.exit(1) }
const ct = dl.headers.get('content-type') ?? ''
const buf = Buffer.from(await dl.arrayBuffer())
console.log(`  got ${(buf.length / 1e6).toFixed(2)} MB, content-type=${ct}`)
if (buf.length < 1_000_000 || ct.includes('text/html')) {
  console.error('Looks like an auth/redirect page, not the weights. First 200 bytes:')
  console.error(buf.subarray(0, 200).toString('utf8'))
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto', endpoint,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})
console.log(`→ uploading to r2://${bucket}/${r2Key} …`)
try {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: r2Key, Body: buf, ContentType: 'application/octet-stream' }))
} catch (e) {
  console.error(`R2 upload failed (${e.name}): ${e.message}`)
  console.error('→ likely the creds are bucket-scoped and lack write to this bucket, or the bucket name is wrong.')
  process.exit(2)
}
await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key }))
console.log(`✓ uploaded. public URL → https://models.miladystation2.net/${r2Key}`)
