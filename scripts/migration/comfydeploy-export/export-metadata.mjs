#!/usr/bin/env node
/**
 * ComfyUI Deploy — metadata + manifest archiver (Build #1 of the pre-migration archive).
 *
 * Pulls EVERYTHING that the ComfyDeploy dashboard API will give us as JSON, to HDD:
 *   - all deployments (list + per-id detail)
 *   - all workflows (list + per-id detail + every workflow_version, incl. full graph JSON)
 *   - all machines (list + per-id detail/snapshot)
 *   - the full private-model volume manifest (821 files, ~489 GB — METADATA only; bytes are
 *     NOT downloadable through any CD endpoint, see project_comfydeploy_archive memory)
 *   - the search/model catalogue
 *
 * Read-only against ComfyDeploy. Does NOT boot the app or touch Mongo (avoids prod DB creds).
 * Idempotent: re-running overwrites the JSON files in place.
 *
 * Usage:
 *   node scripts/archive/comfydeploy/export-metadata.mjs [--out <dir>]
 *   ARCHIVE_DIR=/mnt/hdd/comfydeploy-archive node scripts/archive/comfydeploy/export-metadata.mjs
 *
 * Default output dir: ./comfydeploy-archive (override with --out or $ARCHIVE_DIR).
 */

import fs from 'fs';
import path from 'path';

// ---- config / env -----------------------------------------------------------
function loadEnv(envPath) {
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
const BASE = env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com';
const KEY = env.COMFY_DEPLOY_API_KEY;
if (!KEY) { console.error('FATAL: COMFY_DEPLOY_API_KEY not found in .env or environment'); process.exit(1); }

const argOut = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : null; })();
const OUT = path.resolve(argOut || env.ARCHIVE_DIR || path.join(repoRoot, 'comfydeploy-archive'));

const H = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' };

// ---- helpers ----------------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(p, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${BASE}${p}`, { headers: H });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      if (!r.ok) return { ok: false, status: r.status, error: txt.slice(0, 300) };
      try { return { ok: true, status: r.status, json: JSON.parse(txt) }; }
      catch { return { ok: true, status: r.status, json: txt }; }
    } catch (e) {
      if (attempt === retries) return { ok: false, status: 0, error: e.message };
      await sleep(1000 * (attempt + 1));
    }
  }
}

function writeJson(rel, data) {
  const fp = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  return fp;
}

const log = (...a) => console.log(...a);
const gb = (n) => (n / 1e9).toFixed(2) + ' GB';

// ---- main -------------------------------------------------------------------
const summary = { archivedAt: new Date().toISOString(), base: BASE, out: OUT, counts: {}, errors: [] };
fs.mkdirSync(OUT, { recursive: true });
log(`Archiving ComfyDeploy metadata -> ${OUT}\n`);

// 1. DEPLOYMENTS
{
  const r = await api('/api/deployments?is_deleted=false');
  if (!r.ok) { summary.errors.push(['deployments', r.error]); log('deployments FAILED', r.error); }
  else {
    const list = r.json;
    writeJson('deployments/_list.json', list);
    summary.counts.deployments = list.length;
    log(`deployments: ${list.length} -> fetching details`);
    for (const d of list) {
      const id = d.id || d.deployment_id;
      if (!id) continue;
      const det = await api(`/api/deployment/${id}`);
      if (det.ok) writeJson(`deployments/${id}.json`, det.json);
      else summary.errors.push([`deployment/${id}`, det.error]);
    }
  }
}

// 2. WORKFLOWS (+ versions, full graph JSON)
{
  const r = await api('/api/workflows');
  if (!r.ok) { summary.errors.push(['workflows', r.error]); log('workflows FAILED', r.error); }
  else {
    const list = r.json;
    writeJson('workflows/_list.json', list);
    summary.counts.workflows = list.length;
    let versionCount = 0;
    log(`workflows: ${list.length} -> fetching details + versions`);
    for (const w of list) {
      const id = w.id || w.workflow_id;
      if (!id) continue;
      const det = await api(`/api/workflow/${id}`);
      if (!det.ok) { summary.errors.push([`workflow/${id}`, det.error]); continue; }
      writeJson(`workflows/${id}/workflow.json`, det.json);
      // The workflow detail already embeds each version's full graph (workflow + workflow_api
      // + snapshot + dependencies + comfyui_snapshot). The standalone /api/workflow_version/{id}
      // endpoint 404s, so write the embedded versions directly — no extra fetch needed.
      const versions = det.json?.workflow_versions || det.json?.versions || [];
      for (const v of versions) {
        if (!v?.id) continue;
        writeJson(`workflows/${id}/version-${v.version ?? v.version_number ?? v.id}.json`, v);
        versionCount++;
      }
    }
    summary.counts.workflow_versions = versionCount;
  }
}

// 3. MACHINES
{
  const r = await api('/api/machines?is_deleted=false');
  if (!r.ok) { summary.errors.push(['machines', r.error]); log('machines FAILED', r.error); }
  else {
    const list = r.json;
    writeJson('machines/_list.json', list);
    summary.counts.machines = list.length;
    log(`machines: ${list.length} -> fetching details`);
    for (const m of list) {
      const id = m.id || m.machine_id;
      if (!id) continue;
      const det = await api(`/api/machine/${id}`);
      if (det.ok) writeJson(`machines/${id}.json`, det.json);
      else summary.errors.push([`machine/${id}`, det.error]);
    }
  }
}

// 4. PRIVATE MODEL VOLUME MANIFEST (metadata only — bytes not API-downloadable)
{
  const r = await api('/api/volume/private-models');
  if (!r.ok) { summary.errors.push(['private-models', r.error]); log('private-models FAILED', r.error); }
  else {
    const list = Array.isArray(r.json) ? r.json : [];
    writeJson('volume/private-models.manifest.json', list);
    const files = list.filter(x => x.type === 1);
    const totalBytes = files.reduce((s, x) => s + (x.size || 0), 0);
    // category rollup by top-level path segment
    const byCat = {};
    for (const x of files) {
      const cat = (x.path || '').split('/')[0] || 'root';
      (byCat[cat] = byCat[cat] || { files: 0, bytes: 0 }).files++;
      byCat[cat].bytes += x.size || 0;
    }
    const rollup = Object.entries(byCat)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([cat, v]) => ({ cat, files: v.files, gb: +(v.bytes / 1e9).toFixed(3) }));
    writeJson('volume/private-models.rollup.json', { totalEntries: list.length, totalFiles: files.length, totalGB: +(totalBytes / 1e9).toFixed(2), byCategory: rollup });
    summary.counts.volume_entries = list.length;
    summary.counts.volume_files = files.length;
    summary.volume_total_gb = +(totalBytes / 1e9).toFixed(2);
    log(`volume manifest: ${list.length} entries, ${files.length} files, ${gb(totalBytes)}`);
  }
}

// 5. SEARCH/MODEL CATALOGUE
{
  const r = await api('/api/search/model?query=&provider=all');
  if (!r.ok) { summary.errors.push(['search/model', r.error]); log('search/model FAILED', r.error); }
  else {
    const models = Array.isArray(r.json?.models) ? r.json.models : (Array.isArray(r.json) ? r.json : []);
    writeJson('catalogue/search-model.json', r.json);
    summary.counts.search_models = models.length;
    log(`search catalogue: ${models.length} models`);
  }
}

writeJson('_summary.json', summary);
log(`\nDone. ${summary.errors.length} error(s). Summary -> ${path.join(OUT, '_summary.json')}`);
if (summary.errors.length) log('errors:', JSON.stringify(summary.errors.slice(0, 10), null, 2));
