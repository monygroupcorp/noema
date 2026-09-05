#!/usr/bin/env node
// Modern-media Passion style refs: Openverse (CC), Internet Archive, Danbooru, Bandcamp.
// Run: DATASET_CONTACT=you@example.com node scripts/dataset/passion-modern-fetch.mjs \
//        [--dry] [--source openverse|ia|danbooru|bandcamp]
//
// Output: $DATASET_OUT/<bucket>/ (default dataset_raw/, gitignored) with .txt sidecars and MD5
// dedupe across every bucket already on disk, so a rerun tops up rather than re-downloads.
// Point DATASET_OUT at a scratch volume for a large harvest.
//
// The danbooru and bandcamp sources fetch in-copyright work as style reference; each sidecar
// records that. Choose them deliberately with --source, and check the terms before a bulk run.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.DATASET_OUT ?? join(ROOT, 'dataset_raw');
const CONTACT = process.env.DATASET_CONTACT;
if (!CONTACT) {
  console.error('DATASET_CONTACT is required: these APIs ask a bulk reader to identify a contact.');
  process.exit(1);
}
const UA = `NoemaPassionDataset/1.0 (art-reference ML dataset; contact: ${CONTACT})`;
const MIN_DIM = 1024;
const MAX_BYTES = 60 * 1024 * 1024;
const DRY = process.argv.includes('--dry');
const ONLY = process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seenHashes = new Set();
const seenUrls = new Set();

// preload hashes from entire existing dataset
if (existsSync(OUT)) {
  for (const bucket of readdirSync(OUT)) {
    const dir = join(OUT, bucket);
    let files; try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (f.endsWith('.txt')) continue;
      try { seenHashes.add(createHash('md5').update(readFileSync(join(dir, f))).digest('hex')); } catch {}
    }
  }
}

async function getJson(url, opts = {}) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers ?? {}) }, ...opts });
      if (res.ok) return await res.json();
      if (res.status === 429) await sleep(8000);
    } catch {}
    await sleep(2000 * (a + 1));
  }
  return null;
}

async function download(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length <= MAX_BYTES ? buf : null;
      }
      if (res.status === 429) await sleep(8000);
      else if (res.status >= 400 && res.status < 500) return null;
    } catch {}
    await sleep(2000 * (a + 1));
  }
  return null;
}

let saved = 0, dup = 0, small = 0, failed = 0;

async function save(bucket, name, buf, sidecar) {
  const hash = createHash('md5').update(buf).digest('hex');
  if (seenHashes.has(hash)) { dup++; return false; }
  seenHashes.add(hash);
  const dir = join(OUT, bucket);
  mkdirSync(dir, { recursive: true });
  const safe = name.normalize('NFKD').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 110) || 'img';
  const ext = buf[0] === 0x89 ? 'png' : 'jpg';
  const base = `${safe}_${hash.slice(0, 8)}`;
  writeFileSync(join(dir, `${base}.${ext}`), buf);
  writeFileSync(join(dir, `${base}.txt`), sidecar.filter(Boolean).join('\n') + '\n');
  saved++;
  return true;
}

function dims(buf) {
  // minimal PNG/JPEG dimension sniff
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return { w: 0, h: 0 };
}

// ---------- Openverse (CC-licensed aggregate) ----------
async function openverse() {
  const runs = [
    ['style_digital', 'christ crucifixion dark art'],
    ['style_digital', 'jesus christ digital painting'],
    ['style_digital', 'crucifixion gothic artwork'],
    ['style_digital', 'ecce homo modern art'],
    ['style_popart', 'jesus pop art'],
    ['style_popart', 'christ halftone print'],
    ['style_popart', 'sacred heart screen print'],
    ['style_metal', 'death metal album cover'],
    ['style_metal', 'black metal artwork crucifix'],
  ];
  for (const [bucket, q] of runs) {
    for (let page = 1; page <= 6; page++) {
      const data = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&size=large&page_size=20&page=${page}`);
      if (!data?.results?.length) break;
      console.log(`[openverse:${bucket}] "${q}" p${page} -> ${data.results.length}`);
      for (const r of data.results) {
        if (seenUrls.has(r.url) || !r.url) continue;
        seenUrls.add(r.url);
        if ((r.width && r.width < MIN_DIM) || (r.height && r.height < MIN_DIM)) { small++; continue; }
        if (DRY) { saved++; continue; }
        const buf = await download(r.url);
        if (!buf) { failed++; continue; }
        const d = dims(buf);
        if (d.w < MIN_DIM || d.h < MIN_DIM) { small++; continue; }
        await save(bucket, r.title ?? 'openverse', buf, [
          `Source URL: ${r.foreign_landing_url ?? r.url}`,
          `Title/Artist: ${r.title ?? ''}${r.creator ? ' — ' + r.creator : ''}`,
          `License: ${r.license} ${r.license_version ?? ''} (${r.license_url ?? ''})`,
          `Dimensions: ${d.w}x${d.h}`,
          `Query: ${q}`,
        ]);
        await sleep(400);
      }
      await sleep(1200);
    }
  }
}

// ---------- Internet Archive ----------
async function ia() {
  const runs = [
    ['style_metal', '(crucifixion OR golgotha OR "ecce homo" OR flagellation) AND subject:("death metal" OR "black metal")'],
    ['style_metal', 'title:(crucified OR scourged OR golgotha) AND mediatype:audio AND subject:metal'],
  ];
  for (const [bucket, q] of runs) {
    const data = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=80&output=json`);
    const docs = data?.response?.docs ?? [];
    console.log(`[ia:${bucket}] "${q.slice(0, 50)}..." -> ${docs.length} items`);
    for (const doc of docs) {
      const md = await getJson(`https://archive.org/metadata/${doc.identifier}`);
      const imgs = (md?.files ?? []).filter((f) => /\.(jpe?g|png)$/i.test(f.name) && Number(f.size) > 200_000)
        .sort((a, b) => Number(b.size) - Number(a.size)).slice(0, 2);
      for (const f of imgs) {
        const url = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(f.name)}`;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        if (DRY) { saved++; continue; }
        const buf = await download(url);
        if (!buf) { failed++; continue; }
        const d = dims(buf);
        if (d.w < MIN_DIM || d.h < MIN_DIM) { small++; continue; }
        await save(bucket, `${doc.identifier}_${f.name.replace(/\.[^.]+$/, '')}`, buf, [
          `Source URL: https://archive.org/details/${doc.identifier}`,
          `Title/Artist: ${doc.title ?? doc.identifier}${doc.creator ? ' — ' + doc.creator : ''}`,
          `License: ${doc.licenseurl ?? 'unspecified (archive.org item)'}`,
          `Dimensions: ${d.w}x${d.h}`,
        ]);
        await sleep(400);
      }
      await sleep(600);
    }
  }
}

// ---------- Danbooru (anime refs; anon API, 2-tag limit) ----------
async function danbooru() {
  const runs = [
    ['style_anime', 'jesus', 'anime depiction of christ'],
    ['style_anime', 'crucifixion rating:g,s,q', 'anime crucifixion'],
    ['style_anime', 'emphasis_lines rating:g,s', 'impact frame / emphasis lines style ref'],
    ['style_anime', 'stigmata rating:g,s,q', 'stigmata motif'],
  ];
  for (const [bucket, tags, note] of runs) {
    for (let page = 1; page <= 4; page++) {
      const data = await getJson(`https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(tags)}&limit=100&page=${page}`);
      if (!Array.isArray(data) || !data.length) break;
      console.log(`[danbooru:${bucket}] "${tags}" p${page} -> ${data.length}`);
      for (const p of data) {
        if (!p.file_url || !/\.(jpe?g|png)$/i.test(p.file_url)) continue;
        if (p.image_width < MIN_DIM || p.image_height < MIN_DIM) { small++; continue; }
        if (p.rating === 'e') continue;
        if (seenUrls.has(p.file_url)) continue;
        seenUrls.add(p.file_url);
        if (DRY) { saved++; continue; }
        const buf = await download(p.file_url);
        if (!buf) { failed++; continue; }
        await save(bucket, `danbooru_${p.id}_${(p.tag_string_character || p.tag_string_copyright || '').split(' ')[0]}`, buf, [
          `Source URL: https://danbooru.donmai.us/posts/${p.id}`,
          `Title/Artist: ${p.tag_string_artist || 'unknown'}`,
          `License: fan art, in-copyright (style reference; ${note})`,
          `Dimensions: ${p.image_width}x${p.image_height}`,
          `Tags: ${p.tag_string_general?.slice(0, 400) ?? ''}`,
        ]);
        await sleep(500);
      }
      await sleep(1200);
    }
  }
}

// ---------- Bandcamp (album art, publicly served originals) ----------
async function bandcamp() {
  const terms = ['crucified', 'flagellation', 'golgotha', 'scourged', 'ecce homo', 'calvary', 'via dolorosa', 'passion of christ', 'inri', 'gethsemane'];
  for (const term of terms) {
    const data = await getJson('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_text: term, search_filter: 'a', fan_id: null, full_page: false }),
    });
    const results = (data?.auto?.results ?? []).filter((r) => r.type === 'a' && r.art_id);
    console.log(`[bandcamp:style_metal] "${term}" -> ${results.length} albums`);
    for (const r of results) {
      const url = `https://f4.bcbits.com/img/a${r.art_id}_0.jpg`; // _0 = original upload
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      if (DRY) { saved++; continue; }
      const buf = await download(url);
      if (!buf) { failed++; continue; }
      const d = dims(buf);
      if (d.w < MIN_DIM || d.h < MIN_DIM) { small++; continue; }
      await save('style_metal', `bandcamp_${r.band_name}_${r.name}`, buf, [
        `Source URL: ${r.item_url_root ?? ''}`,
        `Title/Artist: ${r.name} — ${r.band_name}`,
        `License: in-copyright album art (style reference)`,
        `Dimensions: ${d.w}x${d.h}`,
        `Query: ${term}`,
      ]);
      await sleep(500);
    }
    await sleep(1000);
  }
}

const sources = { openverse, ia, danbooru, bandcamp };
for (const [name, fn] of Object.entries(sources)) {
  if (ONLY && name !== ONLY) continue;
  console.log(`\n=== ${name} ===`);
  try { await fn(); } catch (e) { console.log(`[${name}] source failed: ${e.message}`); }
}
console.log(`\nDONE saved=${saved} dup=${dup} small=${small} failed=${failed}`);
