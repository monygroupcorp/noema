#!/usr/bin/env node
/**
 * Legacy `stationthisbot.gens` → HDD training-corpus archiver (users-era 2024 corpus).
 *
 * The legacy DB holds ~110k generations from when the bot had real users — the most precious
 * corpus. Images live on the (still-alive) ComfyDeploy `comfy-deploy-output.s3.amazonaws.com`
 * bucket and die when CD is cancelled. Schema differs from noema.generationOutputs:
 *   - media URLs in BOTH `urls[].url` AND nested in `outputs[].data` (ComfyUI node format)
 *   - prompt + rich metadata in `promptObj` (prompt, userPrompt, negativePrompt, seed, loras, checkpoint)
 *
 * Mirrors archive-outputs-to-hdd.mjs layout: media/<genId>__<n>.<ext> + .txt caption + index.jsonl.
 * Read-only on Mongo (legacy `stationthisbot` DB — not prod noema). Resumable.
 *
 * Usage:
 *   node scripts/migration/comfydeploy-export/archive-legacy-gens-to-hdd.mjs \
 *       --out "$CORPUS_ROOT/legacy" [--limit N] [--concurrency 10]
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

const DB = env.LEGACY_DB || 'stationthisbot';
const OUT = path.resolve(arg('--out', path.join(repoRoot, 'comfydeploy-archive/outputs-corpus-legacy')));
const LIMIT = +arg('--limit', 0) || Infinity;
const CONC = +arg('--concurrency', 10);
const MEDIA_RE = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv)(\?|$)/i;
const URL_RE = /https?:\/\/[^\s"'\\)]+/g;

const mediaDir = path.join(OUT, 'media');
fs.mkdirSync(mediaDir, { recursive: true });
const indexFd = fs.openSync(path.join(OUT, 'index.jsonl'), 'a');
const statePath = path.join(OUT, '_state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { doneGenIds: [] };
const done = new Set(state.doneGenIds);

function mediaUrls(d) {
  const set = new Set();
  for (const u of (d.urls || [])) if (u && typeof u.url === 'string' && MEDIA_RE.test(u.url)) set.add(u.url);
  for (const m of (JSON.stringify(d.outputs || []).match(URL_RE) || [])) if (MEDIA_RE.test(m)) set.add(m.replace(/\\u0026/g, '&'));
  return [...set];
}
const extOf = (u) => { const m = u.match(MEDIA_RE); return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'bin'; };
async function download(url, dest) {
  const r = await fetch(url); if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest)); return fs.statSync(dest).size;
}

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const gens = client.db(DB).collection('gens');
console.log(`db=${DB}.gens -> ${OUT}  (resuming ${done.size} done)\n`);

let scanned = 0, files = 0, bytes = 0, errors = 0, skipped = 0;
const queue = [];
async function flush() {
  const batch = queue.splice(0, queue.length);
  await Promise.all(batch.map(async (j) => {
    try { const size = await download(j.url, j.dest); bytes += size; files++;
      if (j.prompt) fs.writeFileSync(j.txt, j.prompt);
      fs.writeSync(indexFd, JSON.stringify(j.index) + '\n');
    } catch (e) { errors++; fs.appendFileSync(path.join(OUT, '_errors.log'), `${j.url}\t${e.message}\n`); }
  }));
}

const cursor = gens.find({}, { projection: { urls: 1, outputs: 1, promptObj: 1, timestamp: 1, status: 1, run_id: 1 } });
for await (const d of cursor) {
  if (scanned >= LIMIT) break;
  scanned++;
  const genId = String(d._id);
  if (done.has(genId)) { skipped++; continue; }
  const urls = mediaUrls(d);
  if (!urls.length) { done.add(genId); continue; }
  const po = d.promptObj || {};
  const prompt = po.prompt || po.userPrompt || po.basePrompt || null;
  const loras = Array.isArray(po.loras) ? po.loras : [];
  urls.forEach((url, n) => {
    const stem = `${genId}__${n}`;
    const dest = path.join(mediaDir, `${stem}.${extOf(url)}`);
    if (fs.existsSync(dest)) { skipped++; return; }
    queue.push({ url, dest, txt: path.join(mediaDir, `${stem}.txt`), prompt,
      index: { file: path.basename(dest), genId, idx: n, era: 'legacy', type: po.type || null,
        prompt: prompt || null, negativePrompt: po.negativePrompt || null, loras,
        seed: po.seed ?? po.lastSeed ?? null, checkpoint: po.checkpoint || null,
        userId: po.userId ?? null, run_id: d.run_id || null,
        date: d.timestamp ? new Date(d.timestamp).toISOString() : null, srcUrl: url } });
  });
  done.add(genId);
  if (queue.length >= CONC) await flush();
  if (scanned % 1000 === 0) { fs.writeFileSync(statePath, JSON.stringify({ doneGenIds: [...done] }));
    process.stdout.write(`  scanned ${scanned} | media ${files} | ${(bytes / 1e9).toFixed(1)}GB | err ${errors}\r`); }
}
await flush();
fs.closeSync(indexFd);
fs.writeFileSync(statePath, JSON.stringify({ doneGenIds: [...done] }));
await client.close();
console.log(`\n\nDONE. scanned ${scanned} | downloaded ${files} media | ${(bytes / 1e9).toFixed(2)} GB | skipped ${skipped} | errors ${errors}`);
console.log(`corpus: ${OUT}`);
