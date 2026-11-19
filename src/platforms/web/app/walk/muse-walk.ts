// walk/muse-walk.ts — the populated, mobile-390 muse walk noema/muse-is-the-jewel's clause 1
// asks for. Narrower than `walk.ts` the same way `collection-walk.ts` is narrower than it: just
// the muse routes, against a local fixture server (`muse-fixture-server.ts`) instead of a real
// backend, so the screens render their ordinary POPULATED state — a floor with live and
// disabled fragments, a nozzle carrying a model, a stream of settled pieces and one still
// generating — rather than staging's empty one or a sign-in gate. See `muse-fixtures.ts` for
// what "populated" means here.
//
// 390×844 only — "at 390px first" is this goal's own words, and the chrome it exists to name
// is a phone-width question; a desktop pass is `walk.ts`'s to cover later if wanted.
//
//   npx tsx walk/muse-walk.ts                  capture into shots/<run=muse>/, report/<run=muse>/
//   npx tsx walk/muse-walk.ts --run before      a named run (this goal's before/after pack)
//
// Own ports (MUSE_WALK_VITE_PORT / MUSE_FIXTURE_PORT), distinct from vite.config.ts's default
// (5174) and from collection-walk.ts's own (5185/4185), so any of the three can run alongside
// the others without clobbering a dev server.

import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startFixtureServer } from './muse-fixture-server.ts';
import { DATASET_ID } from './muse-fixtures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const FIXTURE_PORT = Number(process.env.MUSE_FIXTURE_PORT ?? '4186');
const VITE_PORT = Number(process.env.MUSE_WALK_VITE_PORT ?? '5186');
const BASE_URL = `http://127.0.0.1:${VITE_PORT}`;
const VIEWPORT = { name: 'mobile', width: 390, height: 844 } as const;

function runName(): string {
  const i = process.argv.indexOf('--run');
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v && !/^[a-z0-9][a-z0-9._-]*$/i.test(v)) throw new Error(`--run "${v}" is not a usable directory name`);
  return v ?? 'muse';
}
const RUN = runName();
const SHOTS_DIR = resolve(HERE, 'shots', RUN);
const REPORT_DIR = resolve(HERE, 'report', RUN);
const MANIFEST_FILE = resolve(REPORT_DIR, 'manifest.json');

function revision(): string {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}
function slug(label: string): string { return label.replace(/^\//, '').replace(/[/:]/g, '-'); }

// --- settle, identical in spirit to walk.ts / collection-walk.ts's own copies ----------------
const QUIET_MS = 700;
const SETTLE_CAP_MS = 12_000;
const SETTLE_JS = `new Promise(function (resolve) {
  let timer;
  const done = function () { observer.disconnect(); clearTimeout(hard); resolve(); };
  const observer = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(done, ${QUIET_MS}); });
  const hard = setTimeout(done, ${SETTLE_CAP_MS});
  timer = setTimeout(done, ${QUIET_MS});
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
})`;
async function settle(page: Page): Promise<void> {
  await page.evaluate(SETTLE_JS).catch(() => {});
}

const GROW_CAP_PX = 12_000;
const SCROLLER_JS = `(function () {
  let best = null;
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('.rail')) continue;
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    const hidden = el.scrollHeight - el.clientHeight;
    if (hidden <= 1) continue;
    if (!best || hidden > best.hidden) best = { hidden: hidden };
  }
  return best;
})()`;
async function growToContent(page: Page, vp: { width: number; height: number }): Promise<void> {
  let height = vp.height;
  for (let step = 0; step < 4; step++) {
    const found = await page.evaluate(SCROLLER_JS).catch(() => null) as { hidden: number } | null;
    if (!found) return;
    const want = Math.min(height + found.hidden, GROW_CAP_PX);
    if (want <= height) return;
    height = want;
    await page.setViewportSize({ width: vp.width, height });
    await settle(page);
  }
}

// `route` matches the literal App.tsx template, for the same reason collection-walk.ts's does:
// several states here share one template and still need to cite the right REFERENCES.md row.
interface ShotSpec {
  route: string;
  label: string;
  path: string;
  act?: (page: Page) => Promise<void>;
}

const MUSE_PATH = `/datasets/${DATASET_ID}/muse`;
const SESSIONS_PATH = `/datasets/${DATASET_ID}/muse/sessions`;

// The launch banner folds to one row by default (noema-286) — "show the rest" is the one
// press that unfolds it, and the floor/nozzle controls only exist in the unfolded DOM.
async function expandBanner(page: Page): Promise<void> {
  const rest = page.getByRole('button', { name: 'show the rest' });
  if (await rest.count()) await rest.click();
}

const SPECS: ShotSpec[] = [
  { route: '/datasets/:id/muse', label: 'resting', path: MUSE_PATH },
  {
    route: '/datasets/:id/muse', label: 'banner-expanded', path: MUSE_PATH,
    act: async (page) => { await expandBanner(page); },
  },
  {
    route: '/datasets/:id/muse', label: 'floor-open', path: MUSE_PATH,
    act: async (page) => {
      await expandBanner(page);
      await page.getByRole('button', { name: 'open the floor' }).click();
    },
  },
  {
    route: '/datasets/:id/muse', label: 'nozzle-open', path: MUSE_PATH,
    act: async (page) => {
      await expandBanner(page);
      await page.locator('.muse-lora').getByRole('button', { name: /change|choose a model/ }).click();
    },
  },
  { route: '/datasets/:id/muse/sessions', label: 'sessions-list', path: SESSIONS_PATH },
];

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not answer within ${timeoutMs}ms`);
}

function startVite(): ChildProcess {
  const bin = resolve(APP, 'node_modules/.bin/vite');
  const child = spawn(bin, ['--port', String(VITE_PORT), '--strictPort'], {
    cwd: APP,
    env: { ...process.env, API_ORIGIN: `http://127.0.0.1:${FIXTURE_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  return child;
}

async function main(): Promise<void> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  console.log(`fixture server — 127.0.0.1:${FIXTURE_PORT}`);
  const fixture = await startFixtureServer(FIXTURE_PORT);

  console.log(`vite dev server — ${BASE_URL} (API_ORIGIN -> fixture, so nothing it proxies leaves the box)`);
  const vite = startVite();
  let browser: Browser | undefined;

  const shots: {
    route: string; viewport: string; file: string; foldFile: string; bytes: number; state: string;
  }[] = [];
  const failed: { route: string; viewport: string; error: string }[] = [];

  try {
    await waitForServer(BASE_URL, 30_000);
    browser = await chromium.launch();

    for (const spec of SPECS) {
      const ctx = await browser.newContext({ viewport: { width: VIEWPORT.width, height: VIEWPORT.height } });
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE_URL}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('load').catch(() => {});
        await settle(page);
        // The still-generating tile resolves its per-piece SSE snapshot on a short delay
        // (muse-fixture-server.ts); give every shot the same beat so "resting" already
        // shows every settled piece's image, not a transient "running" placeholder.
        await page.waitForTimeout(900);
        await settle(page);
        if (spec.act) { await spec.act(page); await settle(page); }

        const dir = resolve(SHOTS_DIR, slug(spec.label));
        mkdirSync(dir, { recursive: true });

        // The first fold — exactly what a thumb sees before it scrolls, at the viewport's
        // own height, taken BEFORE growToContent stretches the window to the page's full
        // scroll height for the second shot below.
        const foldFile = resolve(dir, `${VIEWPORT.name}-fold.png`);
        await page.screenshot({ path: foldFile, fullPage: false });

        const file = resolve(dir, `${VIEWPORT.name}.png`);
        await growToContent(page, VIEWPORT);
        await page.screenshot({ path: file, fullPage: true });
        shots.push({
          route: spec.route, viewport: VIEWPORT.name,
          file: `${slug(spec.label)}/${VIEWPORT.name}.png`,
          foldFile: `${slug(spec.label)}/${VIEWPORT.name}-fold.png`,
          bytes: statSync(file).size,
          state: spec.label,
        });
        console.log(`  ✓ ${spec.path} [${VIEWPORT.name}] -> ${spec.label}`);
      } catch (err) {
        console.log(`  ! ${spec.path} [${VIEWPORT.name}] — ${(err as Error).message}`);
        failed.push({ route: spec.route, viewport: VIEWPORT.name, error: (err as Error).message });
      } finally {
        await page.close();
        await ctx.close();
      }
    }
  } finally {
    await browser?.close();
    vite.kill('SIGTERM');
    await fixture.close();
  }

  writeFileSync(
    MANIFEST_FILE,
    JSON.stringify(
      {
        run: RUN,
        capturedAt: new Date().toISOString(),
        revision: revision(),
        baseUrl: BASE_URL,
        authenticated: false,
        coverage: 'anonymous, fixture-backed — not a real account; the session/dataset here are canned data from muse-fixtures.ts',
        fixture: true,
        viewport: VIEWPORT,
        routes: new Set(SPECS.map((s) => s.route)).size,
        failed,
        shots,
      },
      null,
      2,
    ),
  );

  console.log(`\nrun "${RUN}" — ${shots.length} shots, ${failed.length} failed`);
  console.log(`  shots:    ${SHOTS_DIR}`);
  console.log(`  manifest: ${MANIFEST_FILE}`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
