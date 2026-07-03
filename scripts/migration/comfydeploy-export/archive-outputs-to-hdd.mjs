#!/usr/bin/env node
/**
 * ComfyUI Deploy — generation-output → HDD training-corpus archiver.
 *
 * Downloads every generation image/video (mostly on CD's dying `comfy-deploy-output` S3
 * bucket) to local disk, PAIRED WITH ITS PROMPT as a sidecar caption + rich metadata, so
 * the result is a ready-to-train corpus (image.png + image.txt) for a future StationThisBot
 * canon checkpoint/merge.
 *
 * Layout under --out:
 *   media/<genId>__<n>.<ext>     the image/video bytes
 *   media/<genId>__<n>.txt       the prompt (caption), if any
 *   index.jsonl                  one line per media file: {file, genId, tool, prompt, loras, seed, dims, date, ratings, srcUrl}
 *   _state.json                  resumable progress (downloaded genIds)
 *
 * SAFETY: read-only on Mongo (prod noema — outputs live only there; ALLOW_PROD=1 required).
 * Resumable: skips media already on disk. Does NOT modify any DB record.
 *
 * Usage:
 *   ALLOW_PROD=1 node scripts/migration/comfydeploy-export/archive-outputs-to-hdd.mjs \
 *       --out /mnt/hdd/stationthis-corpus [--limit N] [--concurrency 8]
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { MongoClient } from 'mongodb';

function loadEnv(p) { const e = {}; if (!fs.existsSync(p)) return e;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

const DB = env.OUTPUTS_DB || 'noema';
if (DB === 'noema' && env.ALLOW_PROD !== '1') { console.error('Refusing prod noema without ALLOW_PROD=1'); process.exit(1); }
const OUT = path.resolve(arg('--out', path.join(repoRoot, 'comfydeploy-archive/outputs-corpus')));
const LIMIT = +arg('--limit', 0) || Infinity;
const CONC = +arg('--concurrency', 8);
const MEDIA_RE = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|avi|gltf|glb|wav|mp3|flac|ogg)(\?|$)/i;
const URL_RE = /https?:\/\/[^\s"'\\)]+/g;

const mediaDir = path.join(OUT, 'media');
fs.mkdirSync(mediaDir, { recursive: true });
const indexPath = path.join(OUT, 'index.jsonl');
const statePath = path.join(OUT, '_state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { doneGenIds: [] };
const done = new Set(state.doneGenIds);

// ---- extraction helpers -----------------------------------------------------
function extractPrompt(rp) {
  if (!rp || typeof rp !== 'object') return null;
  return rp.input_prompt || rp.prompt || rp.input_text || rp.positive || rp.text || null;
}
function extractLoras(prompt) {
  if (!prompt) return [];
  return [...String(prompt).matchAll(/<lora:([^:>]+)(?::[^>]*)?>/gi)].map(m => m[1]);
}
function extractMediaUrls(responsePayload) {
  const urls = new Set();
  for (const u of (JSON.stringify(responsePayload || '').match(URL_RE) || [])) {
    if (MEDIA_RE.test(u)) urls.add(u.replace(/\\u0026/g, '&'));
  }
  return [...urls];
}
const extOf = (u) => { const m = u.match(MEDIA_RE); return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'bin'; };

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
  return fs.statSync(dest).size;
}

// ---- main -------------------------------------------------------------------
const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const col = client.db(DB).collection('generationOutputs');
console.log(`db=${DB} -> archiving outputs to ${OUT}\n(resuming: ${done.size} genIds already done)\n`);

const indexFd = fs.openSync(indexPath, 'a');
let scanned = 0, mediaFiles = 0, bytes = 0, errors = 0, skipped = 0;
const queue = [];
async function flush() {
  const batch = queue.splice(0, queue.length);
  await Promise.all(batch.map(async (job) => {
    try {
      const size = await download(job.url, job.dest);
      bytes += size; mediaFiles++;
      if (job.prompt) fs.writeFileSync(job.txt, job.prompt);
      fs.writeSync(indexFd, JSON.stringify(job.index) + '\n');
    } catch (e) { errors++; fs.appendFileSync(path.join(OUT, '_errors.log'), `${job.url}\t${e.message}\n`); }
  }));
}

const cursor = col.find({ responsePayload: { $nin: [null, []] } },
  { projection: { responsePayload: 1, requestPayload: 1, toolId: 1, toolDisplayName: 1, serviceName: 1,
                  requestTimestamp: 1, responseTimestamp: 1, masterAccountId: 1, ratings: 1, metadata: 1 } });

for await (const d of cursor) {
  if (scanned >= LIMIT) break;
  scanned++;
  const genId = String(d._id);
  if (done.has(genId)) { skipped++; continue; }
  const urls = extractMediaUrls(d.responsePayload);
  if (!urls.length) { done.add(genId); continue; }
  const rp = d.requestPayload || {};
  const prompt = extractPrompt(rp);
  const loras = extractLoras(prompt);
  urls.forEach((url, n) => {
    const stem = `${genId}__${n}`;
    const dest = path.join(mediaDir, `${stem}.${extOf(url)}`);
    if (fs.existsSync(dest)) { skipped++; return; }
    queue.push({ url, dest, txt: path.join(mediaDir, `${stem}.txt`), prompt,
      index: { file: path.basename(dest), genId, idx: n, tool: d.toolDisplayName || d.toolId,
        service: d.serviceName, prompt: prompt || null, loras,
        seed: rp.input_seed ?? rp.seed ?? null, width: rp.input_width ?? null, height: rp.input_height ?? null,
        date: d.responseTimestamp || d.requestTimestamp || null, maid: String(d.masterAccountId || ''),
        ratings: d.ratings ? { beautiful: (d.ratings.beautiful || []).length, funny: (d.ratings.funny || []).length, sad: (d.ratings.sad || []).length } : null,
        srcUrl: url } });
  });
  done.add(genId);
  if (queue.length >= CONC) await flush();
  if (scanned % 500 === 0) { fs.writeFileSync(statePath, JSON.stringify({ doneGenIds: [...done] }));
    process.stdout.write(`  scanned ${scanned} | media ${mediaFiles} | ${(bytes / 1e9).toFixed(1)}GB | err ${errors}\r`); }
}
await flush();
fs.closeSync(indexFd);
fs.writeFileSync(statePath, JSON.stringify({ doneGenIds: [...done] }));
await client.close();
console.log(`\n\nDONE. scanned ${scanned} docs | downloaded ${mediaFiles} media files | ${(bytes / 1e9).toFixed(2)} GB | skipped ${skipped} | errors ${errors}`);
console.log(`corpus: ${OUT}\n  media/  index.jsonl  (image+caption pairs)`);
