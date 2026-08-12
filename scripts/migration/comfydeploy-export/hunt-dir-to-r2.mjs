#!/usr/bin/env node
/**
 * Hunt a directory (or mounted drive) for still-missing CD LoRA weights and push matches to R2.
 *
 * Recursively finds *.safetensors (excluding latent-cache / dataset intermediates / toolkit keymaps /
 * base-model dirs), normalized-matches them against the current still-missing CD LoRA list
 * (handling -epoch and -hash suffix / case / punctuation variants), validates each is a real
 * safetensors, and uploads matches to R2 `models` bucket under the canonical CD filename.
 *
 * Idempotent (skips keys already on R2). Run --dry first to preview matches.
 *
 * Usage:
 *   node scripts/migration/comfydeploy-export/hunt-dir-to-r2.mjs "/path/to/mounted/drive" --dry
 *   node scripts/migration/comfydeploy-export/hunt-dir-to-r2.mjs "/path/to/mounted/drive"
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

function loadEnv(p) { const e = {}; if (!fs.existsSync(p)) return e;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
const DIR = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!DIR) { console.error('Usage: hunt-dir-to-r2.mjs <dir> [--dry]'); process.exit(1); }
const BUCKET = env.R2_MODELS_BUCKET || 'models';

const norm = s => String(s).toLowerCase().replace(/\.safetensors$/, '').replace(/-0*\d{4,6}$/, '').replace(/-[0-9a-f]{6}$/, '').replace(/[^a-z0-9]/g, '');

// current still-missing list (regenerate from manifest so repeated runs stay accurate)
const onR2set = new Set(fs.readFileSync(path.join(repoRoot, 'comfydeploy-archive/loras-r2-manifest.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(j => j.r2).map(j => norm(j.filename)));
const ranked = fs.readFileSync(path.join(repoRoot, 'comfydeploy-archive/loras-ranked.tsv'), 'utf8').trim().split('\n').slice(1).map(l => { const p = l.split('\t'); return { importance: +p[0], filename: p[5] }; });
const missing = ranked.filter(r => !onR2set.has(norm(r.filename)));
const missByNorm = new Map(missing.map(r => [norm(r.filename), r]));

// find candidate weight files on the drive
let files = [];
try { files = execSync(`find ${JSON.stringify(DIR)} -type f -iname '*.safetensors' 2>/dev/null`, { maxBuffer: 1 << 28 }).toString().trim().split('\n').filter(Boolean); }
catch (e) { console.error('find failed:', e.message); process.exit(1); }
const EXCLUDE = /_latent_cache|\/dataset\/|\/[0-9]+_data\/|toolkit\/keymaps|\/models\/(checkpoints|diffusion_models|vae|unet|clip|controlnet|ipadapter)\//;
files = files.filter(f => !EXCLUDE.test(f));
console.log(`scanned ${DIR}: ${files.length} candidate weight files | ${missing.length} CD LoRAs still missing\n`);

// match: normalized filename -> missing entry; prefer non-epoch / shortest path
const localBest = new Map();
for (const f of files) { const base = path.basename(f); const k = norm(base);
  if (!missByNorm.has(k)) continue;
  const isEpoch = /-0*\d{4,6}\.safetensors$/i.test(base);
  const cur = localBest.get(k);
  if (!cur || (cur.isEpoch && !isEpoch) || (cur.isEpoch === isEpoch && base.length < path.basename(cur.f).length)) localBest.set(k, { f, isEpoch });
}
const matches = [...localBest.entries()].map(([k, v]) => ({ ...missByNorm.get(k), localPath: v.f })).sort((a, b) => b.importance - a.importance);
console.log(`MATCHES: ${matches.length}`);
matches.forEach(m => console.log(`  ${String(m.importance).padStart(6)}  ${m.filename.padEnd(34)} <- ${path.basename(m.localPath)}`));
if (!matches.length) { console.log('\n(no still-missing LoRAs found here)'); process.exit(0); }
if (DRY) { console.log('\n--dry: no uploads. Re-run without --dry to push these to R2.'); process.exit(0); }

// upload
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const manifestFd = fs.openSync(path.join(repoRoot, 'comfydeploy-archive/loras-r2-manifest.jsonl'), 'a');
const onR2 = async (k) => { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })); return true; } catch { return false; } };
function valid(fp) { try { const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(9); fs.readSync(fd, b, 0, 9, 0); fs.closeSync(fd); const n = Number(b.readBigUInt64LE(0)); return b[8] === 0x7b && n > 0 && n < 1e8 && fs.statSync(fp).size > 1e6; } catch { return false; } }

let ok = 0, skip = 0, bad = 0, fail = 0, bytes = 0;
console.log('\nuploading...');
for (const m of matches) {
  const key = `loras/${m.filename}`;
  if (!valid(m.localPath)) { bad++; console.log(`  ⚠ invalid: ${m.filename}`); continue; }
  if (await onR2(key)) { skip++; console.log(`  skip (on R2): ${m.filename}`); continue; }
  try { const size = fs.statSync(m.localPath).size;
    await new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: fs.createReadStream(m.localPath), ContentType: 'application/octet-stream' } }).done();
    ok++; bytes += size;
    fs.writeSync(manifestFd, JSON.stringify({ filename: m.filename, source: m.localPath, status: 'UPLOADED_LOCAL', r2: `r2://${BUCKET}/${key}`, importance: m.importance, bytes: size, at: new Date().toISOString() }) + '\n');
    console.log(`  ✓ ${m.filename} (${(size/1e6).toFixed(0)}MB, imp ${m.importance})`);
  } catch (e) { fail++; console.log(`  ERR ${m.filename}: ${e.message}`); }
}
fs.closeSync(manifestFd);
console.log(`\nDONE. uploaded ${ok} (${(bytes/1e9).toFixed(2)}GB) | skipped ${skip} | invalid ${bad} | failed ${fail}`);
