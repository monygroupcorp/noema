#!/usr/bin/env node
// Harvest high-res public-domain / free-license Passion imagery from Wikimedia Commons.
// Run: DATASET_CONTACT=you@example.com node scripts/dataset/passion-commons-fetch.mjs [--limit-per-query N] [--dry]
//
// Output: $DATASET_OUT/<bucket>/<safe-name>.<ext> (default dataset_raw/, gitignored) plus a
// matching .txt sidecar with source URL, title, artist, license, and seed tags for captioning.
//
// Wikimedia's user-agent policy wants a real contact for a bulk reader, so DATASET_CONTACT is
// required rather than defaulted: an anonymous harvester gets throttled or blocked.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.DATASET_OUT ?? join(ROOT, 'dataset_raw');
const CONTACT = process.env.DATASET_CONTACT;
if (!CONTACT) {
  console.error('DATASET_CONTACT is required: Wikimedia asks bulk readers to identify a contact.');
  process.exit(1);
}
const UA = `NoemaPassionDataset/1.0 (art-historical ML dataset; contact: ${CONTACT})`;
const MIN_DIM = 1024;
const MAX_BYTES = 90 * 1024 * 1024;
const argLimit = process.argv.includes('--limit-per-query')
  ? Number(process.argv[process.argv.indexOf('--limit-per-query') + 1])
  : 60;
const DRY = process.argv.includes('--dry');

// bucket -> search queries (Commons fulltext search, File namespace)
const QUERIES = {
  subject_statues: [
    'Cristo atado a la columna escultura',
    'Señor de la Columna escultura',
    'Cristo de la Caña',
    'Ecce Homo madera policromada',
    'Ecce Homo escultura barroca',
    'Cristo yacente Gregorio Fernández',
    'Gregorio Fernández Cristo',
    'Flagelación escultura Quito',
    'Escuela quiteña Cristo',
    'Cristo flagelado imagen procesional',
    'Semana Santa Zamora Cristo flagelado',
    'Semana Santa paso flagelación',
    'Cristo de la Sangre escultura',
    'Nazareno policromado sangre',
    'Pestkreuz',
    'Gabelkreuz Kruzifix',
    'Kruzifix St. Maria im Kapitol',
    'Coesfeld Kreuz',
    'Gothic crucifix polychrome wounds',
    'Cristo yacente heridas policromía',
  ],
  subject_paintings: [
    'Flagellation of Christ Caravaggio',
    'Flagellation of Christ painting baroque',
    'Cristo en la columna pintura',
    'Isenheim Altarpiece crucifixion',
    'Grünewald crucifixion detail',
    'Ribera flagelación',
    'Ribera martyrdom painting',
    'Christ at the column tenebrism',
    'Ecce Homo painting tenebrism',
    'Man of Sorrows painting wounds',
    'Christ crowned with thorns painting baroque',
  ],
  style_woodcuts: [
    'Flagellation woodcut Dürer',
    'Passion of Christ engraving Schongauer',
    'Kleine Passion Dürer',
    'Passion woodcut 15th century',
    'Ecce Homo engraving',
  ],
};

const seenHashes = new Set();
const seenPageIds = new Set();

// preload hashes from any previous run so reruns dedupe
for (const bucket of Object.keys(QUERIES)) {
  const dir = join(OUT, bucket);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.txt')) continue;
    try {
      seenHashes.add(createHash('md5').update(readFileSync(join(dir, f))).digest('hex'));
    } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    format: 'json', origin: '*', ...params,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.json();
    } catch {}
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

async function search(query, limit) {
  const out = [];
  let cont = {};
  while (out.length < limit) {
    const data = await api({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata|mime',
      ...cont,
    });
    if (!data?.query?.pages) break;
    out.push(...Object.values(data.query.pages));
    if (!data.continue) break;
    cont = data.continue;
  }
  return out.slice(0, limit);
}

function meta(page) {
  const ii = page.imageinfo?.[0];
  const em = ii?.extmetadata ?? {};
  const strip = (s) => (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return {
    url: ii?.url,
    descUrl: ii?.descriptionurl,
    width: ii?.width ?? 0,
    height: ii?.height ?? 0,
    mime: ii?.mime ?? '',
    title: strip(em.ObjectName?.value) || page.title.replace(/^File:/, ''),
    artist: strip(em.Artist?.value),
    license: strip(em.LicenseShortName?.value),
    description: strip(em.ImageDescription?.value).slice(0, 500),
  };
}

const OK_LICENSE = /public domain|pd|cc0|cc by(?!.*nd)/i;

async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length <= MAX_BYTES) return buf;
        return null; // too big
      }
      if (res.status === 429) await sleep(5000);
    } catch {}
    await sleep(2000 * (attempt + 1));
  }
  return null;
}

const TAG_SEED = {
  subject_statues: 'polychrome wood sculpture, passion of christ, scourged christ, blood-saturated skin, deep lacerations, baroque hyperrealism, processional statue',
  subject_paintings: 'baroque painting, tenebrism, flagellation of christ, flesh trauma, high contrast shadows, passion of christ',
  style_woodcuts: 'woodcut, engraving, line art, passion of christ, medieval print, dense hatching',
};

let saved = 0, skippedSmall = 0, skippedDup = 0, skippedLicense = 0, failed = 0;

for (const [bucket, queries] of Object.entries(QUERIES)) {
  const dir = join(OUT, bucket);
  mkdirSync(dir, { recursive: true });
  for (const q of queries) {
    const pages = await search(q, argLimit);
    console.log(`[${bucket}] "${q}" -> ${pages.length} results`);
    for (const page of pages) {
      if (seenPageIds.has(page.pageid)) continue;
      seenPageIds.add(page.pageid);
      const m = meta(page);
      if (!m.url || !/image\/(jpeg|png|tiff)/.test(m.mime)) continue;
      if (m.width < MIN_DIM || m.height < MIN_DIM) { skippedSmall++; continue; }
      if (m.license && !OK_LICENSE.test(m.license)) { skippedLicense++; continue; }
      if (DRY) { saved++; continue; }

      const buf = await download(m.url);
      if (!buf) { failed++; continue; }
      const hash = createHash('md5').update(buf).digest('hex');
      if (seenHashes.has(hash)) { skippedDup++; continue; }
      seenHashes.add(hash);

      const ext = m.mime.includes('png') ? 'png' : m.mime.includes('tiff') ? 'tif' : 'jpg';
      const safe = page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '')
        .normalize('NFKD').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 120);
      const base = `${safe}_${hash.slice(0, 8)}`;
      writeFileSync(join(dir, `${base}.${ext}`), buf);
      writeFileSync(join(dir, `${base}.txt`), [
        `Source URL: ${m.descUrl ?? m.url}`,
        `Title/Artist: ${m.title}${m.artist ? ' — ' + m.artist : ''}`,
        `License: ${m.license || 'unspecified (verify)'}`,
        `Dimensions: ${m.width}x${m.height}`,
        m.description ? `Description: ${m.description}` : '',
        `Tags: ${TAG_SEED[bucket]}`,
      ].filter(Boolean).join('\n') + '\n');
      saved++;
      await sleep(300); // politeness
    }
  }
}

console.log(`\nDONE saved=${saved} dup=${skippedDup} small=${skippedSmall} badLicense=${skippedLicense} failed=${failed}`);
