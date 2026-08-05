#!/usr/bin/env node
/**
 * Upload locally-located LoRA weight files to R2 under their canonical CD filename.
 * Input: a JSON array of { filename (CD canonical), localPath } (e.g. /tmp/local-matches.json,
 * produced by normalized-matching still-missing CD LoRAs against on-disk training outputs).
 *
 * Verifies each local file looks like a real safetensors (size + magic header) before upload.
 * Target R2 `models` bucket, key loras/<filename>. Idempotent. Appends to loras-r2-manifest.jsonl.
 *
 * Usage: node scripts/migration/comfydeploy-export/upload-matched-loras.mjs /tmp/local-matches.json
 */
import fs from 'fs';
import path from 'path';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

function loadEnv(p) { const e = {}; if (!fs.existsSync(p)) return e;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
const BUCKET = env.R2_MODELS_BUCKET || 'models';
const input = process.argv[2] || '/tmp/local-matches.json';
const matches = JSON.parse(fs.readFileSync(input, 'utf8'));

const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const manifestFd = fs.openSync(path.join(repoRoot, 'comfydeploy-archive/loras-r2-manifest.jsonl'), 'a');
const onR2 = async (k) => { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })); return true; } catch { return false; } };

// a safetensors starts with an 8-byte little-endian header length, then a JSON header beginning with '{'
function looksLikeSafetensors(fp) {
  try { const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(9); fs.readSync(fd, buf, 0, 9, 0); fs.closeSync(fd);
    const hdrLen = Number(buf.readBigUInt64LE(0)); return buf[8] === 0x7b /* { */ && hdrLen > 0 && hdrLen < 1e8; }
  catch { return false; }
}

let ok = 0, skip = 0, bad = 0, fail = 0, bytes = 0;
console.log(`uploading ${matches.length} matched LoRAs -> R2 ${BUCKET}/loras/\n`);
for (const m of matches.sort((a, b) => (b.importance || 0) - (a.importance || 0))) {
  const key = `loras/${m.filename}`;
  if (!fs.existsSync(m.localPath)) { fail++; console.log(`  MISSING local: ${m.localPath}`); continue; }
  const size = fs.statSync(m.localPath).size;
  if (size < 1e6 || !looksLikeSafetensors(m.localPath)) { bad++; console.log(`  ⚠ not a valid weight (${(size/1e6).toFixed(1)}MB): ${m.filename}`); continue; }
  if (await onR2(key)) { skip++; console.log(`  skip (on R2): ${m.filename}`); continue; }
  try {
    const up = new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: fs.createReadStream(m.localPath), ContentType: 'application/octet-stream' } });
    await up.done(); ok++; bytes += size;
    fs.writeSync(manifestFd, JSON.stringify({ filename: m.filename, source: m.localPath, status: 'UPLOADED_LOCAL', r2: `r2://${BUCKET}/${key}`, importance: m.importance, bytes: size, at: new Date().toISOString() }) + '\n');
    console.log(`  ✓ ${m.filename} (${(size/1e6).toFixed(0)}MB, imp ${m.importance ?? '?'})`);
  } catch (e) { fail++; console.log(`  ERR ${m.filename}: ${e.message}`); }
}
fs.closeSync(manifestFd);
console.log(`\nDONE. uploaded ${ok} (${(bytes/1e9).toFixed(2)}GB) | skipped ${skip} | invalid ${bad} | failed ${fail}`);
