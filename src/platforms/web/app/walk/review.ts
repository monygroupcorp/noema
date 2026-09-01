// walk/review.ts — look at a run, or at what changed between two.
//
// The walker captures every route; this is how a person actually sees them. One run builds a
// contact sheet. Two runs build a diff: every shot compared pixel for pixel, sorted by how much
// moved, so a design change is reviewed as a list of what it touched rather than trusted.
//
//   npm run walk:review -- baseline            → contact sheet of one run
//   npm run walk:review -- baseline phase1      → what phase1 changed, against baseline
//
// The comparison runs in the browser Playwright already provides rather than pulling in an image
// library. This codebase avoids new npm dependencies where a platform primitive will do (see
// Mailer.ts for the same call), and a canvas is a perfectly good pixel differ.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const shotsDir = (run: string) => resolve(HERE, 'shots', run);
const reportDir = (run: string) => resolve(HERE, 'report', run);

interface Shot { route: string; viewport: string; file: string; bytes: number }
interface Manifest {
  run: string; capturedAt: string; revision: string; baseUrl: string;
  authenticated: boolean; routes: number; shots: Shot[];
  failed?: { route: string; error: string }[];
}

function manifest(run: string): Manifest {
  const f = resolve(reportDir(run), 'manifest.json');
  if (!existsSync(f)) {
    throw new Error(`no manifest for run "${run}" — capture it first:  npm run walk -- --run ${run}`);
  }
  return JSON.parse(readFileSync(f, 'utf8')) as Manifest;
}

const dataUrl = (p: string) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const PAGE_CSS = `
  :root{color-scheme:dark}
  body{margin:0;background:#08090A;color:#e7eaef;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
  header{padding:28px 32px;border-bottom:1px solid #1c2024;position:sticky;top:0;
    background:#08090Aee;backdrop-filter:blur(6px);z-index:2}
  h1{margin:0 0 6px;font-size:20px;font-weight:600;letter-spacing:-.02em}
  .meta{color:#8b929c;font:12px ui-monospace,monospace}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px;padding:28px 32px}
  figure{margin:0;border:1px solid #1c2024;border-radius:4px;overflow:hidden;background:#0c0e10}
  figcaption{padding:9px 12px;font:12px ui-monospace,monospace;color:#8b929c;
    border-bottom:1px solid #1c2024;display:flex;justify-content:space-between;gap:10px}
  figure img{display:block;width:100%;height:auto}
  .scroll{max-height:420px;overflow:auto}
  .n{color:#5b8cff}
  .changed{color:#d8a657}
  .gone{color:#e5484d}
  table{width:100%;border-collapse:collapse;font:12px ui-monospace,monospace}
  td,th{text-align:left;padding:7px 32px;border-bottom:1px solid #15181b}
  th{color:#8b929c;font-weight:400}
  a{color:inherit}
`;

function contactSheet(run: string): string {
  const m = manifest(run);
  const cards = m.shots.map((s) => `
    <figure>
      <figcaption><span>${esc(s.route)}</span><span class="n">${esc(s.viewport)}</span></figcaption>
      <div class="scroll"><img loading="lazy" src="../../shots/${esc(run)}/${esc(s.file)}" alt="${esc(s.route)} at ${esc(s.viewport)}"></div>
    </figure>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>walk · ${esc(run)}</title><style>${PAGE_CSS}</style>
<header><h1>walk · ${esc(run)}</h1>
<div class="meta">${m.shots.length} shots over ${m.routes} routes · ${esc(m.revision)} · ${esc(m.baseUrl)} · ${m.authenticated ? 'signed in' : 'anonymous'} · ${esc(m.capturedAt)}</div>
${(m.failed ?? []).length ? `<div class="meta gone">unreachable: ${(m.failed ?? []).map((f) => esc(f.route)).join(', ')}</div>` : ''}</header>
<div class="grid">${cards}</div>`;
}

/** The comparison, as source rather than as a closure.
 *
 *  This runs in the browser, and the TypeScript loader that runs this file rewrites function
 *  values with a `__name` helper that does not exist over there — a closure handed to `evaluate`
 *  arrives referencing something undefined. So the two images are put into the page and this is
 *  evaluated as a plain expression against them. It is honest about the boundary too: everything
 *  in this string executes somewhere else.
 *
 *  Images of unlike size are compared on the union canvas, so a page that got taller counts the
 *  new region as changed — which it is. The threshold ignores antialiasing shimmer and catches
 *  real repaints. */
const COMPARE_JS = `(function () {
  const ia = document.getElementById('a'), ib = document.getElementById('b');
  const w = Math.max(ia.naturalWidth, ib.naturalWidth);
  const h = Math.max(ia.naturalHeight, ib.naturalHeight);
  const draw = function (img) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, w, h).data;
  };
  const da = draw(ia), db = draw(ib);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const mask = octx.createImageData(w, h);
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
    const changed = d > 24;
    if (changed) diff++;
    mask.data[i] = changed ? 216 : 12;
    mask.data[i+1] = changed ? 166 : 14;
    mask.data[i+2] = changed ? 87 : 16;
    mask.data[i+3] = 255;
  }
  octx.putImageData(mask, 0, 0);
  return {
    ratio: diff / (w * h),
    dims: { a: [ia.naturalWidth, ia.naturalHeight], b: [ib.naturalWidth, ib.naturalHeight] },
    mask: out.toDataURL('image/png'),
  };
})()`;

interface Compared { ratio: number; dims: { a: number[]; b: number[] }; mask: string }

async function comparePair(page: import('playwright').Page, aPath: string, bPath: string): Promise<Compared> {
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><img id="a" src="${dataUrl(aPath)}"><img id="b" src="${dataUrl(bPath)}">`,
  );
  await page.waitForFunction(
    'document.getElementById("a").complete && document.getElementById("b").complete',
  );
  return page.evaluate(COMPARE_JS) as Promise<Compared>;
}

async function diffRuns(a: string, b: string): Promise<string> {
  const ma = manifest(a), mb = manifest(b);
  const key = (s: Shot) => `${s.route}|${s.viewport}`;
  const byKeyA = new Map(ma.shots.map((s) => [key(s), s]));
  const outDir = resolve(reportDir(b), `diff-from-${a}`);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const rows: { route: string; viewport: string; ratio: number; note: string; mask?: string }[] = [];

  for (const s of mb.shots) {
    const prev = byKeyA.get(key(s));
    if (!prev) { rows.push({ route: s.route, viewport: s.viewport, ratio: 1, note: 'new — not in baseline' }); continue; }
    const ap = resolve(shotsDir(a), prev.file), bp = resolve(shotsDir(b), s.file);
    if (!existsSync(ap) || !existsSync(bp)) { rows.push({ route: s.route, viewport: s.viewport, ratio: 1, note: 'shot missing on disk' }); continue; }
    const r = await comparePair(page, ap, bp);
    const name = `${s.route === '/' ? 'root' : s.route.replace(/^\//, '').replace(/[/:]/g, '-')}-${s.viewport}.png`;
    writeFileSync(resolve(outDir, name), Buffer.from(r.mask.split(',')[1], 'base64'));
    const grew = r.dims.a[1] !== r.dims.b[1] ? ` · height ${r.dims.a[1]}→${r.dims.b[1]}` : '';
    rows.push({ route: s.route, viewport: s.viewport, ratio: r.ratio, note: `${(r.ratio * 100).toFixed(2)}% of pixels${grew}`, mask: name });
    process.stdout.write(`  ${(r.ratio * 100).toFixed(2).padStart(6)}%  ${s.route} ${s.viewport}${grew}\n`);
  }
  for (const s of ma.shots) if (!mb.shots.some((x) => key(x) === key(s))) {
    rows.push({ route: s.route, viewport: s.viewport, ratio: 1, note: 'gone — was in baseline, not in this run' });
  }
  await browser.close();

  rows.sort((x, y) => y.ratio - x.ratio);
  const table = rows.map((r) => `<tr><td>${esc(r.route)}</td><td class="n">${esc(r.viewport)}</td>
    <td class="${r.ratio > 0.001 ? 'changed' : ''}">${esc(r.note)}</td>
    <td>${r.mask ? `<a href="diff-from-${esc(a)}/${esc(r.mask)}">mask</a>` : ''}</td></tr>`).join('');
  const moved = rows.filter((r) => r.ratio > 0.001).length;
  return `<!doctype html><meta charset="utf-8"><title>walk diff · ${esc(a)} → ${esc(b)}</title><style>${PAGE_CSS}</style>
<header><h1>walk diff · ${esc(a)} → ${esc(b)}</h1>
<div class="meta">${esc(ma.revision)} → ${esc(mb.revision)} · ${moved} of ${rows.length} shots moved · sorted by how much</div></header>
<table><tr><th>route</th><th>viewport</th><th>change</th><th></th></tr>${table}</table>`;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length === 0) throw new Error('usage: walk:review -- <run> [<run-to-compare-against-it>]');
  if (args.length === 1) {
    const out = resolve(reportDir(args[0]), 'index.html');
    writeFileSync(out, contactSheet(args[0]));
    console.log(`contact sheet: ${out}`);
    return;
  }
  const [a, b] = args;
  console.log(`comparing ${a} → ${b}`);
  const out = resolve(reportDir(b), `diff-from-${a}.html`);
  writeFileSync(out, await diffRuns(a, b));
  console.log(`\ndiff report: ${out}`);
}

main().catch((err) => { console.error(String(err instanceof Error ? err.message : err)); process.exit(1); });
