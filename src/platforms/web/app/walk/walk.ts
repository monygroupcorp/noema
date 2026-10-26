// walk/walk.ts — the walker. Playwright chromium over every route in the census: a desktop +
// mobile screenshot, and an axe-core accessibility scan. Advisory only in this item — it exits
// 0 even with axe findings; the JSON report is the input for a future gated promotion.
//
// `npm run walk -- --list`            → static self-check: enumerates planned shots, no target.
// `npm run walk`                      → walk against WALK_BASE_URL, into the `latest` run.
// `npm run walk -- --run baseline`    → walk into a NAMED run.
// `npm run walk -- --only /a,/b`      → a subset of routes, while tuning the walker itself.
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
  // A loader is static DOM: "Loading canvas…" sits still for the quiet window while the reads
  // behind it are in flight, and the walk photographed it on every run and the critic filed the
  // screen as never loading. A screen that is busy says so with aria-busy; the walk waits for
  // that to clear, up to the same cap, then lets the DOM it produced settle.
  const busy = await page.locator('[aria-busy="true"]').count().catch(() => 0);
  if (busy > 0) {
    await page.waitForSelector('[aria-busy="true"]', { state: 'detached', timeout: SETTLE_CAP_MS }).catch(() => {});
    await page.evaluate(SETTLE_JS).catch(() => {});
  }
}

/** The app does not scroll the document. `.app` is `height:100vh` and `.page` is the scroll area
 *  (`overflow:auto; min-height:0`), so Playwright's `fullPage` — which grows the viewport until
 *  the DOCUMENT has no more to show — finds nothing to grow and photographs one viewport-height
 *  of a screen that may run to five. The first critique run read every app route from its first
 *  fold and called a screen's lower sections missing; only the marketing and doc pages, which
 *  scroll the body, came out tall.
 *
 *  So before the shot the walk measures the tallest scrolling element and grows the viewport by
 *  the height it hides. `.app` follows the viewport, `.page` follows `.app`, and the whole screen
 *  is in the picture. The rail is skipped — it is viewport-bound by design and never the content.
 *  Capped so an endless feed cannot ask for a window Chromium will not draw; a capped shot says
 *  so in the manifest. Source, not a closure, for the same reason as SETTLE_JS. */
const GROW_CAP_PX = 12_000;
const SCROLLER_JS = `(function () {
  let best = null;
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.closest('.rail')) continue;
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    const hidden = el.scrollHeight - el.clientHeight;
    if (hidden <= 1) continue;
    if (!best || hidden > best.hidden) {
      best = { hidden: hidden, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
               selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') };
    }
  }
  return best;
})()`;

type Scroller = { hidden: number; scrollHeight: number; clientHeight: number; selector: string } | null;

/** Grow the viewport until the tallest inner scroller has nothing left to hide, or the cap is
 *  reached. Growing can reflow and lazy-load more (a feed fills as it gets room), so it measures
 *  again after each step and stops when a step reveals nothing new — two steps cover every screen
 *  seen so far; the loop is bounded regardless. Returns what the manifest records. */
async function growToContent(page: import('playwright').Page, vp: { width: number; height: number }) {
  let height = vp.height;
  let scroller: Scroller = null;
  for (let step = 0; step < 4; step++) {
    const found = await page.evaluate(SCROLLER_JS).catch(() => null) as Scroller;
    if (!found) break;
    scroller = found;
    const want = Math.min(height + found.hidden, GROW_CAP_PX);
    if (want <= height) break;
    height = want;
    await page.setViewportSize({ width: vp.width, height });
    await settle(page);
  }
  return {
    // What scrolled, and what the viewport became to show it. `document` means the page scrolled
    // the body and fullPage alone was enough — the marketing and doc screens.
    scrollContainer: scroller ? scroller.selector : 'document',
    viewportHeightAtShot: height,
    grown: height > vp.height,
    capped: height >= GROW_CAP_PX,
  };
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

async function probeWebgl(browser: Browser): Promise<boolean> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate("(function(){try{var c=document.createElement('canvas');return !!(c.getContext('webgl')||c.getContext('experimental-webgl'))}catch(e){return false}})()") as boolean;
  } catch { return false; } finally { await ctx.close(); }
}

async function walkAll(rows: RouteRow[]): Promise<void> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const browser: Browser = await chromium.launch();
  // Headless Chromium here draws no WebGL (no GPU, and the bundled build has no software fallback
  // that answers getContext('webgl')), so a screen that needs it shows its own "needs WebGL"
  // notice in every shot. That is a fact about the camera, not the screen, and the first critique
  // run filed it as blocking three passes out of three. Probed once per run and written to the
  // manifest, so the critic is told and a reader of the shot knows what it cannot show.
  const webgl = await probeWebgl(browser);
  if (!webgl) console.log('this browser draws no WebGL — WebGL screens will show their fallback notice (recorded in the manifest).');
  const authenticated = await login(browser);

  const report: { route: string; viewport: string; violations: unknown[] }[] = [];
  const counts: Record<string, number> = {};
  const shots: {
    route: string; viewport: string; file: string; bytes: number;
    scrollContainer: string; viewportHeightAtShot: number; grown: boolean; capped: boolean;
  }[] = [];
  const failed: { route: string; viewport: string; error: string }[] = [];

  for (const row of rows) {
    // One context per VIEWPORT, not one per route. Sizing a page down after it has rendered wide
    // captures a resized desktop, not a phone: anything the app decides once at the width it first
    // saw keeps the wide decision. The concierge dock is the case that proved it — its own
    // `matchMedia('(max-width:760px)')` guard is read when the panel opens, so a page opened at
    // 1280 and then narrowed to 390 shows a panel a phone-first visitor never gets, over every
    // shot. A fresh context also clears the per-path localStorage that suppresses first-visit
    // behaviour, so each shot is a first visit AT ITS OWN WIDTH — the state to photograph.
    for (const vp of VIEWPORTS) {
      const ctx = authenticated && existsSync(STATE_FILE)
        ? await browser.newContext({ storageState: STATE_FILE, viewport: { width: vp.width, height: vp.height } })
        : await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      try {
        // `networkidle` never fires on a screen holding a live connection — the heavy lazy routes
        // (Canvas, Space, Vault) time out waiting for a quiet network that a streaming app does not
        // have. Wait for the document, then for the page to stop changing.
        await page.goto(`${BASE_URL}${row.resolvedPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('load').catch(() => {});
        await settle(page);

        const dir = resolve(SHOTS_DIR, slug(row.path));
        mkdirSync(dir, { recursive: true });
        const file = resolve(dir, `${vp.name}.png`);
        // Grow the window to the app's inner scroller (see growToContent), shoot, then put the
        // window back so axe scans the viewport a visitor actually has.
        const capture = await growToContent(page, vp);
        await page.screenshot({ path: file, fullPage: true });
        if (capture.grown) await page.setViewportSize({ width: vp.width, height: vp.height });
        shots.push({
          route: row.path,
          viewport: vp.name,
          file: `${slug(row.path)}/${vp.name}.png`,
          bytes: statSync(file).size,
          ...capture,
        });

        // Scanned at the width that was photographed, and recorded under that width. A contrast or
        // target-size finding is a statement about a viewport; one filed under the wrong width
        // sends the next reader to a screenshot that does not show it.
        const axeResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
          .analyze();
        report.push({ route: row.path, viewport: vp.name, violations: axeResults.violations });
        counts[`${row.path} [${vp.name}]`] = axeResults.violations.length;
      } catch (err) {
        console.log(`  ! ${row.path} [${vp.name}] — ${(err as Error).message}`);
        counts[`${row.path} [${vp.name}]`] = -1; // -1 = unreachable, distinct from 0 violations
        failed.push({ route: row.path, viewport: vp.name, error: (err as Error).message });
      } finally {
        await page.close();
        await ctx.close();
      }
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
        // Says in words what `authenticated: false` says in a boolean. A run captured without
        // credentials covers the logged-out half of the app and nothing else — every auth-gated
        // screen in it is a sign-in gate or an anonymous render, never the screen a member sees.
        // A reader who mistakes one for the other reads a whole baseline wrong, so the manifest
        // states the coverage rather than leaving it to be inferred from a flag.
        coverage: authenticated
          ? 'signed in — auth-gated screens show member state'
          : 'logged-out only — no WALK_EMAIL/WALK_PASSWORD, so the signed-in half of every '
            + 'auth-gated route is NOT captured; those shots are the anonymous render or the sign-in gate',
        // Each shot is a first visit at its own width: one browser context per (route, viewport).
        perViewportContext: true,
        // A shot of an app route is the whole screen, not its first fold: the viewport is grown to
        // the inner scroller's height before the shot (each shot says what it scrolled and how
        // tall the window became). Runs before this flag photographed app routes at one viewport.
        fullScreenCapture: true,
        // Whether the capturing browser could draw WebGL. False means a WebGL screen's shot shows
        // its fallback notice, which is the camera's limit and not a finding about the screen.
        webgl,
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

/** `--only /catalog,/run` restricts the walk to those census paths (the pattern, not the
 *  resolved fixture path). A subset run is for checking the walker, not for a baseline: its
 *  manifest says `routes: <n>` so nobody mistakes it for a full census. */
function onlyRoutes(rows: RouteRow[]): RouteRow[] {
  const i = process.argv.indexOf('--only');
  if (i < 0) return rows;
  const want = new Set((process.argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const kept = rows.filter((r) => want.has(r.path));
  const missing = [...want].filter((w) => !rows.some((r) => r.path === w));
  if (missing.length) throw new Error(`--only names routes not in the census: ${missing.join(', ')}`);
  return kept;
}

async function main() {
  const rows = onlyRoutes(census());
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
