#!/usr/bin/env node
/**
 * Recover CD-only LoRAs that turn out to live on the `ms2stationthis` HuggingFace org
 * (present on HF but never recorded in loraModels.publishedTo) and push them to R2 `models`.
 *
 * For each HF repo matching one of our 212 CD-only filenames: find the .safetensors in the repo,
 * stream it HF -> R2 under loras/<our-canonical-CD-filename>. Idempotent. Read-only on HF.
 *
 * Usage: node scripts/migration/comfydeploy-export/recover-from-hf-to-r2.mjs
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
const HF = env.HF_TOKEN ? { Authorization: `Bearer ${env.HF_TOKEN}` } : {};
const BUCKET = env.R2_MODELS_BUCKET || 'models';
const ORG = 'ms2stationthis';

const norm = s => String(s || '').toLowerCase().replace(/\.safetensors$/, '').replace(/-[0-9a-f]{6}$/, '').replace(/[^a-z0-9]/g, '');
const ranked = fs.readFileSync(path.join(repoRoot, 'comfydeploy-archive/loras-ranked.tsv'), 'utf8').trim().split('\n').slice(1)
  .map(l => { const p = l.split('\t'); return { importance: +p[0], filename: p[5], name: p[6] }; });
const wantBy = {}; for (const r of ranked) { wantBy[norm(r.filename)] = r; if (r.name) wantBy[norm(r.name)] = r; }

const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const manifestFd = fs.openSync(path.join(repoRoot, 'comfydeploy-archive/loras-r2-manifest.jsonl'), 'a');
const onR2 = async (k) => { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })); return true; } catch { return false; } };

const repos = JSON.parse(fs.readFileSync(path.join(repoRoot, 'comfydeploy-archive/hf-org-repos.json'), 'utf8'));
const matches = repos.map(repo => ({ repo, want: wantBy[norm(repo.split('/').pop())] })).filter(m => m.want);
console.log(`${matches.length} HF repos match CD-only LoRAs -> R2 ${BUCKET}/loras/\n`);

let ok = 0, skip = 0, fail = 0, nofile = 0, bytes = 0;
for (const { repo, want } of matches.sort((a, b) => b.want.importance - a.want.importance)) {
  const key = `loras/${want.filename}`;
  if (await onR2(key)) { skip++; console.log(`  skip (on R2): ${want.filename}`); continue; }
  // find the .safetensors file inside the repo
  let files = [];
  try { const r = await fetch(`https://huggingface.co/api/models/${repo}?full=true`, { headers: HF });
    const j = await r.json(); files = (j.siblings || []).map(s => s.rfilename).filter(f => /\.safetensors$/i.test(f)); }
  catch (e) { fail++; console.log(`  ERR list ${repo}: ${e.message}`); continue; }
  if (!files.length) { nofile++; fs.writeSync(manifestFd, JSON.stringify({ filename: want.filename, repo, status: 'HF_NO_SAFETENSORS', at: new Date().toISOString() }) + '\n'); console.log(`  ⚠ no .safetensors in ${repo}`); continue; }
  // prefer the file matching the repo/lora name, else the largest/first
  const pick = files.find(f => norm(f) === norm(repo.split('/').pop())) || files.find(f => /lora/i.test(f)) || files[0];
  const url = `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(pick)}`;
  try {
    const r = await fetch(url, { headers: HF, redirect: 'follow' });
    if (!r.ok || !r.body) { fail++; console.log(`  FAIL ${r.status}: ${repo}/${pick}`); continue; }
    const up = new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: Readable.fromWeb(r.body), ContentType: 'application/octet-stream' } });
    await up.done();
    const len = +(r.headers.get('content-length') || 0); bytes += len; ok++;
    fs.writeSync(manifestFd, JSON.stringify({ filename: want.filename, source: url, status: 'RECOVERED_FROM_HF', r2: `r2://${BUCKET}/${key}`, importance: want.importance, at: new Date().toISOString() }) + '\n');
    console.log(`  ✓ ${want.filename}  (imp ${want.importance}, ${(len/1e6).toFixed(0)}MB) <- ${repo}`);
  } catch (e) { fail++; console.log(`  ERR ${repo}: ${e.message}`); }
}
fs.closeSync(manifestFd);
console.log(`\nDONE. recovered ${ok} (${(bytes/1e9).toFixed(2)} GB) | skipped ${skip} | no-file ${nofile} | failed ${fail}`);
console.log(`These ${ok} no longer need local-hunt/CD-dump. Remaining CD-dependent = 212 - 14(safe) - ${ok}.`);
