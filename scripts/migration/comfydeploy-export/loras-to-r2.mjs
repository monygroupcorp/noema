#!/usr/bin/env node
/**
 * Consolidate LoRA weights onto Cloudflare R2 (the `models` bucket) — the carry-forward store.
 *
 * Two modes (combine freely):
 *   --online        Pull the LoRAs that are still fetchable online and push to R2:
 *                     SAFE (verified HuggingFace copy) and RECOVERABLE_EXTERNAL whose source
 *                     URL is a direct HF resolve link. (Civitai *page* URLs need manual
 *                     version-id resolution — flagged, not auto-pulled.)
 *   --from-dir <d>  Scan a local directory (recursively) for *.safetensors, match each to the
 *                     reconciliation by filename, and upload to R2. Use this for CD-only weights
 *                     you locate on your own machines.
 *
 * Target: R2 bucket `models`, key `loras/<filename>`. Idempotent (skips keys already on R2).
 * Reads comfydeploy-archive/loras.reconciliation.json for the worklist + source URLs.
 * Writes comfydeploy-archive/loras-r2-manifest.jsonl (one line per uploaded/attempted file).
 *
 * Usage:
 *   node scripts/migration/comfydeploy-export/loras-to-r2.mjs --online
 *   node scripts/migration/comfydeploy-export/loras-to-r2.mjs --from-dir "/mnt/whatever/loras"
 */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

function loadEnv(p) { const e = {}; if (!fs.existsSync(p)) return e;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const ONLINE = process.argv.includes('--online');
const FROM_DIR = arg('--from-dir', null);
const BUCKET = env.R2_MODELS_BUCKET || 'models';
const KEY_PREFIX = 'loras/';
if (!ONLINE && !FROM_DIR) { console.error('Specify --online and/or --from-dir <dir>'); process.exit(1); }

const recon = JSON.parse(fs.readFileSync(path.join(repoRoot, 'comfydeploy-archive/loras.reconciliation.json'), 'utf8'));
const byFilename = new Map(recon.results.map(r => [r.filename, r]));
const manifestFd = fs.openSync(path.join(repoRoot, 'comfydeploy-archive/loras-r2-manifest.jsonl'), 'a');

const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });

async function existsOnR2(key) { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; } catch { return false; } }
async function uploadStream(key, body, contentLength) {
  const up = new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/octet-stream' } });
  await up.done();
  return `r2://${BUCKET}/${key}`;
}
function record(o) { fs.writeSync(manifestFd, JSON.stringify({ ...o, at: new Date().toISOString() }) + '\n'); }
const hfHeaders = () => env.HF_TOKEN ? { Authorization: `Bearer ${env.HF_TOKEN}` } : {};

let ok = 0, skip = 0, fail = 0, flagged = 0;

async function pushFromUrl(filename, url) {
  const key = KEY_PREFIX + filename;
  if (await existsOnR2(key)) { skip++; console.log(`  skip (on R2): ${filename}`); return; }
  const headers = /huggingface\.co/.test(url) ? hfHeaders() : {};
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok || !r.body) { fail++; record({ filename, source: url, status: 'FETCH_FAIL', code: r.status }); console.log(`  FAIL ${r.status}: ${filename}`); return; }
  const u = await uploadStream(key, Readable.fromWeb(r.body));
  ok++; record({ filename, source: url, status: 'UPLOADED', r2: u }); console.log(`  ✓ ${filename} -> ${u}`);
}

if (ONLINE) {
  const online = recon.results.filter(r => r.status === 'SAFE' || r.status === 'RECOVERABLE_EXTERNAL');
  console.log(`\n[--online] ${online.length} candidates (SAFE + RECOVERABLE_EXTERNAL) -> R2 ${BUCKET}/${KEY_PREFIX}\n`);
  for (const r of online) {
    // prefer a direct HF resolve url; civitai *page* urls can't be fetched directly
    const hf = r.hf && /huggingface\.co\/.+\/resolve\//.test(r.hf) ? r.hf : null;
    const ext = r.externalUrl || '';
    let url = hf;
    if (!url && /huggingface\.co\/.+\/resolve\//.test(ext)) url = ext;
    if (!url) { flagged++; record({ filename: r.filename, source: ext || r.hf || null, status: 'NEEDS_MANUAL', reason: 'no direct download url (civitai page / unknown)' }); console.log(`  ⚠ manual: ${r.filename} (${r.importedSource || '?'})`); continue; }
    try { await pushFromUrl(r.filename, url); } catch (e) { fail++; record({ filename: r.filename, source: url, status: 'ERROR', error: e.message }); console.log(`  ERR ${r.filename}: ${e.message}`); }
  }
}

if (FROM_DIR) {
  const dir = path.resolve(FROM_DIR);
  console.log(`\n[--from-dir] scanning ${dir} for *.safetensors\n`);
  const found = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) walk(fp); else if (/\.safetensors$/i.test(e.name)) found.push(fp); } })(dir);
  console.log(`  found ${found.length} .safetensors locally`);
  let matched = 0;
  for (const fp of found) {
    const filename = path.basename(fp);
    const known = byFilename.has(filename);
    if (!known) continue; // only upload ones that are in our CD inventory
    matched++;
    const key = KEY_PREFIX + filename;
    if (await existsOnR2(key)) { skip++; console.log(`  skip (on R2): ${filename}`); continue; }
    try {
      const size = fs.statSync(fp).size;
      const u = await uploadStream(key, fs.createReadStream(fp), size);
      ok++; record({ filename, source: fp, status: 'UPLOADED_LOCAL', r2: u, bytes: size }); console.log(`  ✓ ${filename} (${(size/1e6).toFixed(0)}MB) -> ${u}`);
    } catch (e) { fail++; record({ filename, source: fp, status: 'ERROR', error: e.message }); console.log(`  ERR ${filename}: ${e.message}`); }
  }
  console.log(`  matched ${matched}/${found.length} local files to CD inventory`);
}

fs.closeSync(manifestFd);
console.log(`\nDONE. uploaded ${ok} | skipped ${skip} | failed ${fail} | needs-manual ${flagged}`);
console.log(`manifest -> comfydeploy-archive/loras-r2-manifest.jsonl`);
