#!/usr/bin/env node
/**
 * Recover specific LoRAs from Civitai and upload to R2 `models` under their canonical CD filename.
 * Args: one or more `<civitaiModelId>=<canonicalFilename.safetensors>` pairs.
 *   node recover-from-civitai-to-r2.mjs 667693=darkcoreflux.safetensors 812092=legoflux.safetensors
 *
 * Resolves the model's primary version download URL via the Civitai API (CIVITAI_API_KEY in .env),
 * streams it to R2, idempotent (skips keys already on R2). Appends to loras-r2-manifest.jsonl.
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
const pairs = process.argv.slice(2).map(a => { const [id, name] = a.split('='); return { id: id.replace(/\D/g, ''), name }; }).filter(p => p.id && p.name);
if (!pairs.length) { console.error('Args: <modelId>=<filename.safetensors> ...'); process.exit(1); }
const TOK = env.CIVITAI_API_KEY, H = TOK ? { Authorization: `Bearer ${TOK}` } : {};
const BUCKET = env.R2_MODELS_BUCKET || 'models';
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
const manifestFd = fs.openSync(path.join(repoRoot, 'comfydeploy-archive/loras-r2-manifest.jsonl'), 'a');
const onR2 = async (k) => { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })); return true; } catch { return false; } };

let ok = 0, fail = 0;
for (const { id, name } of pairs) {
  const key = `loras/${name}`;
  if (await onR2(key)) { console.log(`skip (on R2): ${name}`); continue; }
  try {
    const meta = await (await fetch(`https://civitai.com/api/v1/models/${id}`, { headers: H })).json();
    const v = (meta.modelVersions || [])[0];
    const dl = v?.downloadUrl || (v?.files || [])[0]?.downloadUrl;
    if (!dl) { fail++; console.log(`  no download url for ${id} (${meta.name})`); continue; }
    const r = await fetch(dl, { headers: H, redirect: 'follow' });
    if (!r.ok || !r.body) { fail++; console.log(`  FAIL ${r.status}: ${id} ${name}`); continue; }
    await new Upload({ client: s3, params: { Bucket: BUCKET, Key: key, Body: Readable.fromWeb(r.body), ContentType: 'application/octet-stream' } }).done();
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    ok++;
    fs.writeSync(manifestFd, JSON.stringify({ filename: name, source: `https://civitai.com/models/${id}`, status: 'RECOVERED_FROM_CIVITAI', r2: `r2://${BUCKET}/${key}`, bytes: h.ContentLength, at: new Date().toISOString() }) + '\n');
    console.log(`  ✓ ${name} <- civitai ${id} "${meta.name}" (${(h.ContentLength / 1e6).toFixed(1)}MB)`);
  } catch (e) { fail++; console.log(`  ERR ${id} ${name}: ${e.message}`); }
}
fs.closeSync(manifestFd);
console.log(`\nDONE. recovered ${ok} | failed ${fail}`);
