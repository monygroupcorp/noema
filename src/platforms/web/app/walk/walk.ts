// walk/walk.ts — the walker. Playwright chromium over every route in the census: a desktop +
// mobile screenshot, and an axe-core accessibility scan. Advisory only in this item — it exits
// 0 even with axe findings; the JSON report is the input for a future gated promotion.
//
// `npm run walk -- --list`            → static self-check: enumerates planned shots, no target.
// `npm run walk`                      → walk against WALK_BASE_URL, into the `latest` run.
// `npm run walk -- --run baseline`    → walk into a NAMED run.
//
// Runs are named because the point of capturing every route is comparing two of them. A run
// writes a manifest recording the commit, the target and every shot's dimensions, so a set of
// pictures stays attributable to the build that produced it — a baseline nobody can trace back
// to a revision is a folder of screenshots, not evidence.

import { chromium, type Browser } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { census, type RouteRow } from './routes.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function runName(): string {
  const i = process.argv.indexOf('--run');
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v && !/^[a-z0-9][a-z0-9._-]*$/i.test(v)) {
    throw new Error(`--run "${v}" is not a usable directory name`);
  }
  return v ?? 'latest';
}

const RUN = runName();
const SHOTS_DIR = resolve(HERE, 'shots', RUN);
const REPORT_DIR = resolve(HERE, 'report', RUN);
const REPORT_FILE = resolve(REPORT_DIR, 'axe.json');
const MANIFEST_FILE = resolve(REPORT_DIR, 'manifest.json');

/** The revision the run captured, so a baseline is attributable. Unknown is recorded as such
 *  rather than omitted — a manifest that quietly drops the field looks complete and is not. */
function revision(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
const STATE_FILE = resolve(HERE, '.storage-state.json'); // gitignored — cached login session

const BASE_URL = process.env.WALK_BASE_URL ?? 'http://localhost:5173';
const EMAIL = process.env.WALK_EMAIL;       // the app's username field — no email auth exists
const PASSWORD = process.env.WALK_PASSWORD;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Wait until the page stops changing, or give up.
 *
 *  A fixed pause is not enough for a data-backed screen and is wasted on a static one, and the
 *  difference matters more than it sounds: two runs that each caught a different moment of the
 *  same fetch produce a diff that measures loading, not the change under review. The first
 *  comparison this harness ever produced was doing exactly that — a page counted as 26% changed
 *  because one run photographed an empty grid and the other a full one.
 *
 *  So the walk watches the DOM instead and shoots when it has been still for QUIET_MS. The cap
 *  keeps a screen that never settles — an animation, a poll — from stalling the walk; it just
 *  captures whatever is there at the cap, which is the honest outcome for a page that is never
 *  the same twice. */
const QUIET_MS = 700;
const SETTLE_CAP_MS = 12_000;

/** Source, not a closure: the loader that runs this file rewrites function values with a
 *  `__name` helper that does not exist in a browser, so a closure handed to `evaluate` arrives
 *  referencing something undefined. The constants are interpolated in for the same reason. */
const SETTLE_JS = `new Promise(function (resolve) {
  let timer;
  const done = function () { observer.disconnect(); clearTimeout(hard); resolve(); };
  const observer = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(done, ${QUIET_MS}); });
  const hard = setTimeout(done, ${SETTLE_CAP_MS});
  timer = setTimeout(done, ${QUIET_MS});
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
})`;

async function settle(page: import('playwright').Page): Promise<void> {
  await page.evaluate(SETTLE_JS).catch(() => {});
}

function slug(path: string): string {
  return path === '/' ? 'root' : path.replace(/^\//, '').replace(/[/:]/g, '-');
}

function listOnly(rows: RouteRow[]): void {
  const total = rows.length * VIEWPORTS.length;
  console.log(`walk --list: ${rows.length} routes x ${VIEWPORTS.length} viewports = ${total} planned shots (no target contacted)\n`);
  for (const r of rows) {
    for (const vp of VIEWPORTS) {
      console.log(`  shots/${RUN}/${slug(r.path)}/${vp.name}.png  <- ${r.resolvedPath}`);
    }
  }
}

// Best-effort sign-in via Door A (the username/password rail — see src/screens/Onboard.tsx).
// Skips gracefully with no credentials: the walk still runs, just as an anonymous session, which
// is a legitimate state to capture (many screens work anon; auth-gated ones will show whatever
// the anon/redirect state renders — a real observation, not a failure).
async function login(browser: Browser): Promise<boolean> {
  if (!EMAIL || !PASSWORD) {
    console.log('WALK_EMAIL/WALK_PASSWORD not set — walking without a session (anonymous).');
    return false;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/onboard`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue with a username' }).click();
    await page.getByLabel('username').fill(EMAIL);
    await page.getByLabel('password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/app/, { timeout: 15_000 }).catch(() => {
      console.log('Sign-in did not reach /app within 15s — continuing with whatever session resulted.');
    });
    // Verify rather than assume. `storageState` writes a file whether or not a session was
    // minted, and a stale file from a previous run would make an anonymous walk claim to be
    // authenticated — which is the one thing a manifest must never do.
    const signedIn = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('noema-sessions');
        if (!raw) return false;
        const store = JSON.parse(raw) as { accounts?: Record<string, unknown> };
        return Object.keys(store.accounts ?? {}).length > 0;
      } catch { return false; }
    });
    if (signedIn) await context.storageState({ path: STATE_FILE });
    console.log(signedIn ? 'signed in — walking with a session.' : 'sign-in produced no session — walking anonymously.');
    return signedIn;
  } catch (err) {
    // A changed affordance on the sign-in door must not take the whole walk down with it.
    console.log(`sign-in failed (${(err as Error).message.split('\n')[0]}) — walking anonymously.`);
    return false;
  } finally {
    await context.close();
  }
}

async function walkAll(rows: RouteRow[]): Promise<void> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const browser: Browser = await chromium.launch();
  const authenticated = await login(browser);

  const report: { route: string; viewport: string; violations: unknown[] }[] = [];
  const counts: Record<string, number> = {};
  const shots: { route: string; viewport: string; file: string; bytes: number }[] = [];
  const failed: { route: string; error: string }[] = [];

  for (const row of rows) {
    const ctx = authenticated && existsSync(STATE_FILE)
      ? await browser.newContext({ storageState: STATE_FILE })
      : await browser.newContext();
    const page = await ctx.newPage();
    try {
      // `networkidle` never fires on a screen holding a live connection — the heavy lazy routes
      // (Canvas, Space, Vault) time out waiting for a quiet network that a streaming app does not
      // have. Wait for the document, then for the page to stop changing.
      await page.goto(`${BASE_URL}${row.resolvedPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('load').catch(() => {});
      await settle(page);

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const dir = resolve(SHOTS_DIR, slug(row.path));
        mkdirSync(dir, { recursive: true });
        const file = resolve(dir, `${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        shots.push({
          route: row.path,
          viewport: vp.name,
          file: `${slug(row.path)}/${vp.name}.png`,
          bytes: statSync(file).size,
        });
      }

      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
        .analyze();
      report.push({ route: row.path, viewport: 'desktop', violations: axeResults.violations });
      counts[row.path] = axeResults.violations.length;
    } catch (err) {
      console.log(`  ! ${row.path} — ${(err as Error).message}`);
      counts[row.path] = -1; // -1 = walk failed to reach the route, distinct from 0 violations
      failed.push({ route: row.path, error: (err as Error).message });
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  await browser.close();
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  writeFileSync(
    MANIFEST_FILE,
    JSON.stringify(
      {
        run: RUN,
        capturedAt: new Date().toISOString(),
        revision: revision(),
        baseUrl: BASE_URL,
        authenticated,
        viewports: VIEWPORTS,
        routes: rows.length,
        failed,
        shots,
      },
      null,
      2,
    ),
  );

  console.log('\nper-route axe violation count (-1 = route unreachable):');
  for (const [path, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(3)}  ${path}`);
  console.log(`\nrun "${RUN}" — ${shots.length} shots`);
  console.log(`  shots:    ${SHOTS_DIR}`);
  console.log(`  report:   ${REPORT_FILE}`);
  console.log(`  manifest: ${MANIFEST_FILE}`);
  console.log(`\nsee them all:  npm run walk:review -- ${RUN}`);
  // Advisory: always exit 0. Gate promotion (violations==0 with a per-rule allowlist) is a
  // later one-line change, after one triaged run.
}

async function main() {
  const rows = census();
  if (process.argv.includes('--list')) {
    listOnly(rows);
    return;
  }
  await walkAll(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
