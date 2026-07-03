#!/usr/bin/env node
/**
 * ComfyUI Deploy — LoRA reconciliation (Build #2 of the pre-migration archive).
 *
 * The 296 `loras/*.safetensors` on the CD volume (~74 GB) are our trained models and the
 * only uniquely at-risk data (CD has no byte-download API). This crosses each one against
 * our `loraModels` records + their published HuggingFace / Cloudflare-R2 copies, VERIFIES
 * those copies actually still exist (HEAD), and emits the true orphan set that needs
 * recovery via ComfyDeploy support / a Modal volume dump.
 *
 * Join key: a CD lora filename `loras/<slug>.safetensors` matches `loraModels.slug`
 * (records are slugged `<name>-<6hex>`, same shape as the filenames). Falls back to
 * matching the basename of publishedTo.modelFileUrl / huggingfaceUrl / cloudflareUrl.
 *
 * SAFETY: pins to the `noemaplane` DB. Refuses to touch prod `noema` unless ALLOW_PROD=1.
 * Read-only on Mongo. No app boot.
 *
 * Usage:
 *   node scripts/migration/comfydeploy-export/reconcile-loras.mjs \
 *       [--manifest <path>] [--out <path>] [--no-verify]
 */

import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

// ---- env / args -------------------------------------------------------------
function loadEnv(p) {
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; };
const VERIFY = !process.argv.includes('--no-verify');
const MANIFEST = path.resolve(arg('--manifest', path.join(repoRoot, 'comfydeploy-archive/volume/private-models.manifest.json')));
const OUT = path.resolve(arg('--out', path.join(repoRoot, 'comfydeploy-archive/loras.reconciliation.json')));

const DB = env.RECON_DB || 'noemaplane';
if (DB === 'noema' && env.ALLOW_PROD !== '1') {
  console.error('REFUSING to query prod `noema`. Set RECON_DB or ALLOW_PROD=1 to override.'); process.exit(1);
}
const URI = env.MONGODB_URI;
if (!URI) { console.error('FATAL: MONGODB_URI not set'); process.exit(1); }

// ---- helpers ----------------------------------------------------------------
const base = (p) => (p || '').split('/').pop();
const stripExt = (f) => f.replace(/\.safetensors$/i, '');
async function head(url) {
  try {
    // HF private/gated repos 401 without auth -> attach token so existence checks are real
    const headers = {};
    if (/huggingface\.co/.test(url) && env.HF_TOKEN) headers.Authorization = `Bearer ${env.HF_TOKEN}`;
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers });
    return { exists: r.ok, status: r.status, size: +(r.headers.get('content-length') || 0) || null };
  } catch (e) { return { exists: false, status: 0, error: e.message }; }
}

// ---- load CD volume LoRAs ---------------------------------------------------
if (!fs.existsSync(MANIFEST)) { console.error(`Manifest not found: ${MANIFEST}\nRun export-metadata.mjs first.`); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const cdLoras = manifest
  .filter(r => r.type === 1 && /^loras\/.+\.safetensors$/i.test(r.path || ''))
  .map(r => ({ path: r.path, filename: base(r.path), slug: stripExt(base(r.path)), size: r.size || 0 }));
console.log(`CD volume: ${cdLoras.length} lora .safetensors files, ${(cdLoras.reduce((s, x) => s + x.size, 0) / 1e9).toFixed(2)} GB\n`);

// ---- load loraModels from noemaplane ----------------------------------------
const client = new MongoClient(URI);
await client.connect();
console.log(`Connected; querying db="${DB}" collection="loraModels" (read-only)`);
const docs = await client.db(DB).collection('loraModels')
  .find({}, { projection: { slug: 1, name: 1, visibility: 1, publishedTo: 1, importedFrom: 1 } }).toArray();
await client.close();
console.log(`loraModels records in ${DB}: ${docs.length}\n`);

// index by slug and by any published filename basename
const bySlug = new Map();
const byFile = new Map();
for (const d of docs) {
  if (d.slug) bySlug.set(d.slug.toLowerCase(), d);
  const p = d.publishedTo || {};
  // most authoritative: publishedTo.comfyDeployPath = `loras/<slug>.safetensors`
  if (p.comfyDeployPath) byFile.set(stripExt(base(p.comfyDeployPath)).toLowerCase(), d);
  for (const u of [p.modelFileUrl, p.huggingfaceUrl, p.cloudflareUrl, p.huggingfaceRepo, d.importedFrom?.modelFileUrl]) {
    const b = stripExt(base(u || '')).toLowerCase();
    if (b) byFile.set(b, d);
  }
}

// ---- reconcile --------------------------------------------------------------
const results = [];
for (const lora of cdLoras) {
  const key = lora.slug.toLowerCase();
  const doc = bySlug.get(key) || byFile.get(key);
  const p = doc?.publishedTo || {};
  const hfRepo = p.huggingfaceRepo || (doc?.importedFrom?.source === 'huggingface' ? doc.importedFrom.url : null);
  const hfUrl = p.modelFileUrl?.includes('huggingface') ? p.modelFileUrl
    : (hfRepo ? `https://huggingface.co/${String(hfRepo).replace(/^https?:\/\/huggingface\.co\//, '')}/resolve/main/${lora.filename}` : null);
  const r2Url = p.cloudflareUrl || (p.modelFileUrl && !p.modelFileUrl.includes('huggingface') ? p.modelFileUrl : null);

  const claimsBackup = !!(hfUrl || r2Url);
  const src = doc?.importedFrom?.source || null;
  const extUrl = doc?.importedFrom?.url || null;
  // civitai/huggingface imports with a source URL can be re-downloaded from origin (not CD-dependent)
  const externalRecoverable = !!extUrl && /civitai|huggingface/i.test(src || '');
  const rec = { ...lora, matched: !!doc, recordSlug: doc?.slug || null, name: doc?.name || null,
                visibility: doc?.visibility || null, importedSource: src, externalUrl: extUrl,
                claimsBackup, hf: hfUrl || null, r2: r2Url || null, hfOk: null, r2Ok: null, status: null };
  if (VERIFY) {
    if (hfUrl) rec.hfOk = (await head(hfUrl)).exists;
    if (r2Url) rec.r2Ok = (await head(r2Url)).exists;
  }
  const backedUp = (rec.hfOk === true) || (rec.r2Ok === true) || (!VERIFY && claimsBackup);
  rec.status = backedUp ? 'SAFE'                          // verified HF/R2 copy exists
    : claimsBackup ? 'BACKUP_URL_DEAD'                    // record claims a copy but HEAD failed
    : externalRecoverable ? 'RECOVERABLE_EXTERNAL'        // re-downloadable from civitai/HF origin
    : !doc ? 'ORPHAN_NO_RECORD'                           // no DB record at all -> CD-only
    : 'CD_ONLY';                                          // record exists, no backup & no origin -> CD is sole copy
  results.push(rec);
  process.stdout.write(rec.status === 'SAFE' ? '.' : 'X');
}
process.stdout.write('\n\n');

// ---- summary ----------------------------------------------------------------
const by = {};
for (const r of results) (by[r.status] = by[r.status] || { n: 0, gb: 0 }).n++, (by[r.status].gb += r.size);
const order = ['SAFE', 'RECOVERABLE_EXTERNAL', 'BACKUP_URL_DEAD', 'CD_ONLY', 'ORPHAN_NO_RECORD'];
console.log('status'.padEnd(22), 'files'.padStart(6), 'size'.padStart(10));
for (const s of order) if (by[s]) console.log(s.padEnd(22), String(by[s].n).padStart(6), ((by[s].gb / 1e9).toFixed(2) + ' GB').padStart(10));
// "must recover from CD" = the bytes exist nowhere else: CD_ONLY + ORPHAN_NO_RECORD + dead backups
const mustRecover = results.filter(r => ['CD_ONLY', 'ORPHAN_NO_RECORD', 'BACKUP_URL_DEAD'].includes(r.status));
console.log('-'.repeat(40));
console.log(`MUST RECOVER FROM CD (sole copy): ${mustRecover.length} files, ${(mustRecover.reduce((s, r) => s + r.size, 0) / 1e9).toFixed(2)} GB`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  reconciledAt: new Date().toISOString(), db: DB, verified: VERIFY,
  cdLoraCount: cdLoras.length, loraModelRecords: docs.length,
  summary: Object.fromEntries(order.filter(s => by[s]).map(s => [s, { files: by[s].n, gb: +(by[s].gb / 1e9).toFixed(2) }])),
  mustRecover: mustRecover.map(r => ({ filename: r.filename, gb: +(r.size / 1e9).toFixed(3), status: r.status, name: r.name, importedSource: r.importedSource })),
  recoverableExternal: results.filter(r => r.status === 'RECOVERABLE_EXTERNAL').map(r => ({ filename: r.filename, name: r.name, source: r.importedSource, url: r.externalUrl })),
  results,
}, null, 2));
console.log(`\nFull report -> ${OUT}`);
