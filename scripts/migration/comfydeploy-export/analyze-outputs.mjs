#!/usr/bin/env node
/**
 * ComfyUI Deploy — generation-output archive sizing (read-only).
 *
 * Scans generationOutputs.responsePayload, tallies output-media URLs by host + media type,
 * and HEAD-samples the ComfyDeploy-S3 URLs to project total bytes that must move to R2
 * before CD's `comfy-deploy-output` bucket disappears.
 *
 * SAFETY: read-only. Pins to a DB (default noema, since outputs live only in prod).
 * Guard: refuses prod unless ALLOW_PROD=1.
 *
 * Usage: ALLOW_PROD=1 node scripts/migration/comfydeploy-export/analyze-outputs.mjs [--sample N] [--out path]
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

function loadEnv(p) { const e = {}; if (!fs.existsSync(p)) return e;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const DB = env.OUTPUTS_DB || 'noema';
if (DB === 'noema' && env.ALLOW_PROD !== '1') { console.error('Refusing prod noema without ALLOW_PROD=1'); process.exit(1); }
const HEAD_SAMPLE = +arg('--sample', 150);
const OUT = path.resolve(arg('--out', path.join(repoRoot, 'comfydeploy-archive/outputs.sizing.json')));

const URL_RE = /https?:\/\/[^\s"'\\)]+/g;
const MEDIA_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|gltf|glb|obj|safetensors|wav|mp3|flac|ogg)(\?|$)/i;
const host = (u) => { try { return new URL(u).host; } catch { return 'invalid'; } };
const ext = (u) => { const m = u.match(MEDIA_RE); return m ? m[1].toLowerCase() : null; };

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const col = client.db(DB).collection('generationOutputs');
console.log(`db=${DB} collection=generationOutputs (read-only)\n`);

const byHost = {}, byExt = {}, byStatusHasMedia = {};
let docs = 0, docsWithMedia = 0, totalMediaUrls = 0;
const cdSample = []; // sample of CD-S3 media URLs for HEAD sizing

const cursor = col.find({ responsePayload: { $nin: [null, []] } }, { projection: { responsePayload: 1, status: 1 } });
for await (const d of cursor) {
  docs++;
  const blob = JSON.stringify(d.responsePayload || '');
  const urls = (blob.match(URL_RE) || []).filter(u => MEDIA_RE.test(u));
  if (urls.length) { docsWithMedia++; byStatusHasMedia[d.status] = (byStatusHasMedia[d.status] || 0) + 1; }
  const seen = new Set();
  for (const u of urls) {
    if (seen.has(u)) continue; seen.add(u);
    totalMediaUrls++;
    const h = host(u); byHost[h] = (byHost[h] || 0) + 1;
    const e = ext(u); if (e) byExt[e] = (byExt[e] || 0) + 1;
    if (/comfy-deploy-output/.test(h) && cdSample.length < HEAD_SAMPLE * 4) cdSample.push(u);
  }
  if (docs % 5000 === 0) process.stdout.write(`  scanned ${docs}\r`);
}
await client.close();
console.log(`scanned ${docs} docs; ${docsWithMedia} have media; ${totalMediaUrls} unique media URLs\n`);

// HEAD-sample CD-S3 URLs (evenly spread) to estimate average bytes
const step = Math.max(1, Math.floor(cdSample.length / HEAD_SAMPLE));
const picks = []; for (let i = 0; i < cdSample.length && picks.length < HEAD_SAMPLE; i += step) picks.push(cdSample[i]);
let okN = 0, okBytes = 0, dead = 0;
await Promise.all(picks.map(async u => {
  try { const r = await fetch(u, { method: 'HEAD' }); const cl = +(r.headers.get('content-length') || 0);
    if (r.ok && cl) { okN++; okBytes += cl; } else dead++; } catch { dead++; }
}));
const avg = okN ? okBytes / okN : 0;

const cdHosts = Object.entries(byHost).filter(([h]) => /comfy-deploy-output/.test(h));
const cdUrlCount = cdHosts.reduce((s, [, n]) => s + n, 0);
const projGB = (avg * cdUrlCount) / 1e9;

console.log('=== media URLs by host ===');
for (const [h, n] of Object.entries(byHost).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String(n).padStart(8), h);
console.log('\n=== by media type ===');
for (const [e, n] of Object.entries(byExt).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(8), e);
console.log('\n=== CD-S3 byte projection ===');
console.log(`HEAD sample: ${okN} ok / ${dead} dead of ${picks.length}; avg=${(avg / 1e6).toFixed(2)} MB/file`);
console.log(`ComfyDeploy-S3 media URLs: ${cdUrlCount}`);
console.log(`PROJECTED total to move to R2: ~${projGB.toFixed(1)} GB  (avg × count)`);
if (dead > okN) console.log('WARNING: many dead HEADs — CD bucket may already be expiring URLs.');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ analyzedAt: new Date().toISOString(), db: DB,
  docsScanned: docs, docsWithMedia, totalMediaUrls, byHost, byExt, byStatusHasMedia,
  headSample: { tried: picks.length, ok: okN, dead, avgBytes: Math.round(avg) },
  cdS3: { urlCount: cdUrlCount, projectedGB: +projGB.toFixed(1) } }, null, 2));
console.log(`\nReport -> ${OUT}`);
