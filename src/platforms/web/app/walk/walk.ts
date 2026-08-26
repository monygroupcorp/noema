// walk/walk.ts — the walker. Playwright chromium over every route in the census: a desktop +
// mobile screenshot, and an axe-core accessibility scan. Advisory only in this item — it exits
// 0 even with axe findings; the JSON report is the input for a future gated promotion.
//
// `npm run walk -- --list`  → static self-check: enumerates planned shots, no browser, no target.
// `npm run walk`            → the real walk against WALK_BASE_URL.

import { chromium, type Browser } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { census, type RouteRow } from './routes.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(HERE, 'shots');
const REPORT_DIR = resolve(HERE, 'report');
const REPORT_FILE = resolve(REPORT_DIR, 'axe.json');
const STATE_FILE = resolve(HERE, '.storage-state.json'); // gitignored — cached login session

const BASE_URL = process.env.WALK_BASE_URL ?? 'http://localhost:5173';
const EMAIL = process.env.WALK_EMAIL;       // the app's username field — no email auth exists
const PASSWORD = process.env.WALK_PASSWORD;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

function slug(path: string): string {
  return path === '/' ? 'root' : path.replace(/^\//, '').replace(/[/:]/g, '-');
}

function listOnly(rows: RouteRow[]): void {
  const total = rows.length * VIEWPORTS.length;
  console.log(`walk --list: ${rows.length} routes x ${VIEWPORTS.length} viewports = ${total} planned shots (no target contacted)\n`);
  for (const r of rows) {
    for (const vp of VIEWPORTS) {
      console.log(`  shots/${slug(r.path)}/${vp.name}.png  <- ${r.resolvedPath}`);
    }
  }
}

// Best-effort sign-in via Door A (the username/password rail — see src/screens/Onboard.tsx).
// Skips gracefully with no credentials: the walk still runs, just as an anonymous session, which
// is a legitimate state to capture (many screens work anon; auth-gated ones will show whatever
// the anon/redirect state renders — a real observation, not a failure).
async function login(browser: Browser): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    console.log('WALK_EMAIL/WALK_PASSWORD not set — walking without a session (anonymous).');
    return;
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
    await context.storageState({ path: STATE_FILE });
  } finally {
    await context.close();
  }
}

async function walkAll(rows: RouteRow[]): Promise<void> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const browser: Browser = await chromium.launch();
  await login(browser);

  const report: { route: string; viewport: string; violations: unknown[] }[] = [];
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const ctx = existsSync(STATE_FILE)
      ? await browser.newContext({ storageState: STATE_FILE })
      : await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE_URL}${row.resolvedPath}`, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForTimeout(300); // let lazy-loaded screens (Canvas/Space/Vault) settle

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const dir = resolve(SHOTS_DIR, slug(row.path));
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: resolve(dir, `${vp.name}.png`), fullPage: true });
      }

      const axeResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
        .analyze();
      report.push({ route: row.path, viewport: 'desktop', violations: axeResults.violations });
      counts[row.path] = axeResults.violations.length;
    } catch (err) {
      console.log(`  ! ${row.path} — ${(err as Error).message}`);
      counts[row.path] = -1; // -1 = walk failed to reach the route, distinct from 0 violations
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  await browser.close();
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log('\nper-route axe violation count (-1 = route unreachable):');
  for (const [path, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(3)}  ${path}`);
  console.log(`\nreport: ${REPORT_FILE}`);
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
