// walk/collection-walk.ts — the populated collection walk this goal asks for.
//
// `walk.ts` (not touched here — the live review seat is using it) walks the whole app's route
// census against a real backend named by `WALK_BASE_URL`/`API_ORIGIN`; the one fixture id each
// parameterized route carries in `walk.config.ts` resolves to whatever that backend happens to
// hold (usually nothing, since `API_ORIGIN` defaults to staging). Nobody has ever pointed it at
// a collection that is actually mid-run, so no review round has seen the editio spine in any
// state but empty or 404 — and the hosting/gallery export, the one path that actually produces
// ERC-721-ready tokenURIs, has never rendered at all.
//
// This walker is narrower and sharper: just the 7 collection screens, against a fixture server
// (`collection-fixture-server.ts`) that answers the client's own `/v1/collectiones` etc. shapes
// from canned data (`collection-fixtures.ts`) — draft, in-flight and finished collections — with
// NO database, no staging, no production, nothing further than 127.0.0.1. "Export" is captured
// as the transition the export screen itself makes once published, by actually driving the two
// publish buttons, rather than inventing a fourth pre-published fixture no screen would ever
// produce on its own.
//
// Own ports throughout (COLLECTION_WALK_VITE_PORT / COLLECTION_FIXTURE_PORT, both overridable),
// distinct from vite.config.ts's own default (5174) and from walk.ts's own base URL convention —
// so this can run alongside another seat's live walk.ts session without either clobbering the
// other's dev server or fixture state.
//
//   npx tsx walk/collection-walk.ts                  capture into shots/<run=collection>/…
//   npx tsx walk/collection-walk.ts --run baseline    capture into a NAMED run
//
// Afterwards, reuse the existing instruments unmodified:
//   npm run walk:review -- <run>                      contact sheet
//   npm run walk:critique -- <run>                     the CRIT pack

import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startFixtureServer } from './collection-fixture-server.ts';
import { DRAFT_ID, INFLIGHT_ID, FINISHED_ID } from './collection-fixtures.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const FIXTURE_PORT = Number(process.env.COLLECTION_FIXTURE_PORT ?? '4185');
const VITE_PORT = Number(process.env.COLLECTION_WALK_VITE_PORT ?? '5185');
const BASE_URL = `http://127.0.0.1:${VITE_PORT}`;

function runName(): string {
  const i = process.argv.indexOf('--run');
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v && !/^[a-z0-9][a-z0-9._-]*$/i.test(v)) throw new Error(`--run "${v}" is not a usable directory name`);
  return v ?? 'collection';
}
const RUN = runName();
const SHOTS_DIR = resolve(HERE, 'shots', RUN);
const REPORT_DIR = resolve(HERE, 'report', RUN);
const MANIFEST_FILE = resolve(REPORT_DIR, 'manifest.json');

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

function revision(): string {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function slug(label: string): string {
  return label.replace(/^\//, '').replace(/[/:]/g, '-');
}

// --- a trimmed settle, independent of walk.ts (see file header: that one is not rewritten) ----
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
  const busy = await page.locator('[aria-busy="true"]').count().catch(() => 0);
  if (busy > 0) {
    await page.waitForSelector('[aria-busy="true"]', { state: 'detached', timeout: SETTLE_CAP_MS }).catch(() => {});
    await page.evaluate(SETTLE_JS).catch(() => {});
  }
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

// --- the shot plan ------------------------------------------------------------------------------
// `route` is the literal App.tsx template — matched verbatim against REFERENCES.md's REF-26..31
// rows by walk/critique.ts, so every state of a screen still cites the right reference even
// though several states share one template. `label` only distinguishes the file on disk.
interface ShotSpec {
  route: string;
  label: string;
  path: string;
  /** Run right after navigation+settle, before the shot — the two export-screen publishes. */
  act?: (page: Page) => Promise<void>;
}

const SPECS: ShotSpec[] = [
  { route: '/collections', label: 'list-all-states', path: '/collections' },
  { route: '/collections/:id', label: 'hub-draft', path: `/collections/${DRAFT_ID}` },
  { route: '/collections/:id', label: 'hub-inflight', path: `/collections/${INFLIGHT_ID}` },
  { route: '/collections/:id', label: 'hub-finished', path: `/collections/${FINISHED_ID}` },
  { route: '/collections/:id/garden', label: 'garden-draft', path: `/collections/${DRAFT_ID}/garden` },
  { route: '/collections/:id/rules', label: 'rules-draft', path: `/collections/${DRAFT_ID}/rules` },
  { route: '/collections/:id/run', label: 'run-inflight', path: `/collections/${INFLIGHT_ID}/run` },
  { route: '/collections/:id/run', label: 'run-finished', path: `/collections/${FINISHED_ID}/run` },
  { route: '/collections/:id/curation', label: 'curation-inflight', path: `/collections/${INFLIGHT_ID}/curation` },
  { route: '/collections/:id/export', label: 'export-finished', path: `/collections/${FINISHED_ID}/export` },
  {
    route: '/collections/:id/export', label: 'export-downloaded', path: `/collections/${FINISHED_ID}/export`,
    // "Export to you" — the private-archive half of the export moment.
    act: async (page) => {
      await page.getByRole('button', { name: 'Prepare download ↓' }).click();
      await page.getByText('your ZIP is ready').waitFor({ timeout: 10_000 }).catch(() => {});
    },
  },
  {
    route: '/collections/:id/export', label: 'export-hosted-nft', path: `/collections/${FINISHED_ID}/export`,
    // "Publish to hosting" — the ERC-721-tokenURI path NOESIS mints against. This is the
    // screen the goal says no review round has ever seen populated. The fixture server's
    // publish state is shared across every shot in this run, so the desktop pass (run first)
    // actually publishes and the mobile pass finds it already hosted — both are real states
    // of this screen, so either way this only switches to the "hosting" destination and waits
    // for the ready panel, publishing itself only when nothing has published yet.
    act: async (page) => {
      await page.getByRole('button', { name: /Publish to hosting/ }).click();
      const ready = page.getByText(/set your contract.s/);
      if (await ready.count() === 0) {
        await page.getByLabel(/public, temporary bridge/).check();
        await page.getByRole('button', { name: /Publish to hosting →/ }).click();
      }
      await ready.waitFor({ timeout: 10_000 });
    },
  },
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
    route: string; viewport: string; file: string; bytes: number; blank: boolean; state: string;
  }[] = [];
  const failed: { route: string; viewport: string; error: string }[] = [];

  try {
    await waitForServer(BASE_URL, 30_000);
    browser = await chromium.launch();

    for (const spec of SPECS) {
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await ctx.newPage();
        try {
          await page.goto(`${BASE_URL}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('load').catch(() => {});
          await settle(page);
          if (spec.act) { await spec.act(page); await settle(page); }

          const dir = resolve(SHOTS_DIR, slug(spec.label));
          mkdirSync(dir, { recursive: true });
          const file = resolve(dir, `${vp.name}.png`);
          await growToContent(page, vp);
          const blank = ((await page.evaluate(
            "(document.body && document.body.innerText || '').trim().length === 0",
          ).catch(() => false)) as boolean);
          await page.screenshot({ path: file, fullPage: true });
          shots.push({
            route: spec.route, viewport: vp.name,
            file: `${slug(spec.label)}/${vp.name}.png`,
            bytes: statSync(file).size,
            blank, state: spec.label,
          });
          console.log(`  ✓ ${spec.path} [${vp.name}] -> ${spec.label}`);
        } catch (err) {
          console.log(`  ! ${spec.path} [${vp.name}] — ${(err as Error).message}`);
          failed.push({ route: spec.route, viewport: vp.name, error: (err as Error).message });
        } finally {
          await page.close();
          await ctx.close();
        }
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
        coverage: 'anonymous, fixture-backed — not a real account; every collection here is canned data from collection-fixtures.ts',
        fixture: true,
        viewports: VIEWPORTS,
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
  console.log(`\ncontact sheet:  npm run walk:review -- ${RUN}`);
  console.log(`CRIT pack:      npm run walk:critique -- ${RUN}`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
